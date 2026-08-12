import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GenerationFileError,
  acquirePublicationLock,
  assertGenerationPathsSeparated,
  atomicallyReplaceRegularFile,
  atomicallyReplaceSafeRegularFile,
  cleanupOwnedStage,
  createOwnedStage,
  hashBytes,
  verifyExactReleaseTree,
  writeOwnedStageFile,
} from "../src/generation-fs.js";

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "editorial-generation-fs-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("generated filesystem safety", () => {
  it("rejects lexical root and report overlap", async () => {
    const workspace = await makeTemporaryDirectory();
    const source = path.join(workspace, "source");
    const generated = path.join(workspace, "generated");
    await mkdir(source);

    await expect(
      assertGenerationPathsSeparated(source, path.join(source, "output")),
    ).rejects.toMatchObject({ code: "SOURCE_OUTPUT_OVERLAP" });
    await expect(
      assertGenerationPathsSeparated(
        source,
        generated,
        path.join(generated, "report.json"),
      ),
    ).rejects.toMatchObject({ code: "REPORT_PATH_OVERLAP" });
    await expect(
      assertGenerationPathsSeparated(
        source,
        generated,
        path.join(workspace, "report.json"),
      ),
    ).resolves.toBeUndefined();
  });

  it("serializes publishers with one exclusive lock", async () => {
    const workspace = await makeTemporaryDirectory();
    const generated = path.join(workspace, "generated");
    const first = await acquirePublicationLock(generated);
    await expect(acquirePublicationLock(generated)).rejects.toMatchObject({
      code: "GENERATION_LOCK_UNAVAILABLE",
    });
    await first.release();
    const second = await acquirePublicationLock(generated);
    await second.release();
  });

  it("cleans only its intact owned staging tree", async () => {
    const workspace = await makeTemporaryDirectory();
    const stage = await createOwnedStage(path.join(workspace, "generated"));
    await writeOwnedStageFile(
      stage,
      "asset/runtime/top.png",
      Uint8Array.of(1, 2, 3),
    );

    await cleanupOwnedStage(stage);
    await expect(lstat(stage.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a cleanup-time directory-link swap and preserves its target", async (context) => {
    const workspace = await makeTemporaryDirectory();
    const external = path.join(workspace, "external");
    const sentinel = path.join(external, "sentinel.txt");
    await mkdir(external);
    await writeFile(sentinel, "safe", "utf8");
    const stage = await createOwnedStage(path.join(workspace, "generated"));
    await rm(stage.releasePath, { recursive: true });
    try {
      await symlink(
        external,
        stage.releasePath,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "EPERM" || code === "EACCES") {
        context.skip("Host does not permit directory-link creation.");
        return;
      }
      throw error;
    }

    await expect(cleanupOwnedStage(stage)).rejects.toBeInstanceOf(
      GenerationFileError,
    );
    expect(await readFile(sentinel, "utf8")).toBe("safe");
    await unlink(stage.releasePath);
  });

  it("refuses a cleanup-time file link and preserves its target", async (context) => {
    const workspace = await makeTemporaryDirectory();
    const external = path.join(workspace, "external-file.txt");
    await writeFile(external, "safe", "utf8");
    const stage = await createOwnedStage(path.join(workspace, "generated"));
    const hostile = path.join(stage.releasePath, "hostile.png");
    try {
      await symlink(external, hostile, "file");
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "EPERM" || code === "EACCES") {
        context.skip("Host does not permit file-link creation.");
        return;
      }
      throw error;
    }

    await expect(cleanupOwnedStage(stage)).rejects.toMatchObject({
      code: "GENERATION_STAGE_CLEANUP_REFUSED",
    });
    expect(await readFile(external, "utf8")).toBe("safe");
    await unlink(hostile);
  });

  it("refuses a foreign ordinary directory replacement during cleanup", async () => {
    const workspace = await makeTemporaryDirectory();
    const stage = await createOwnedStage(path.join(workspace, "generated"));
    await writeOwnedStageFile(stage, "asset/runtime/top.png", Uint8Array.of(1));
    const runtime = path.join(stage.releasePath, "asset", "runtime");
    await rm(runtime, { recursive: true });
    await mkdir(runtime);
    const sentinel = path.join(runtime, "foreign.txt");
    await writeFile(sentinel, "safe", "utf8");

    await expect(cleanupOwnedStage(stage)).rejects.toMatchObject({
      code: "GENERATION_STAGE_CLEANUP_REFUSED",
    });
    expect(await readFile(sentinel, "utf8")).toBe("safe");
  });

  it("preserves a replacement lock when release identity changes", async (context) => {
    const workspace = await makeTemporaryDirectory();
    const generated = path.join(workspace, "generated");
    const lockPath = path.join(generated, ".publication.lock");
    const displaced = path.join(generated, ".publication.lock.displaced");
    let swapCompleted = false;
    const lock = await acquirePublicationLock(generated, {
      beforeReleaseQuarantine: async () => {
        await rename(lockPath, displaced);
        await writeFile(lockPath, "foreign-owner", "utf8");
        swapCompleted = true;
      },
    });

    await expect(lock.release()).rejects.toMatchObject({
      code: "GENERATION_LOCK_RELEASE_REFUSED",
    });
    if (!swapCompleted) {
      context.skip("Host does not permit replacing an open lock path.");
      return;
    }
    expect(await readFile(lockPath, "utf8")).toBe("foreign-owner");
  });

  it("verifies the exact expected release tree without accepting extras", async () => {
    const workspace = await makeTemporaryDirectory();
    const release = path.join(workspace, "release");
    await mkdir(release);
    const catalog = Buffer.from("catalog\n", "utf8");
    await writeFile(path.join(release, "catalog.json"), catalog);
    const expected = new Map([["catalog.json", hashBytes(catalog)]]);
    await expect(verifyExactReleaseTree(release, expected)).resolves.toBeUndefined();

    await writeFile(path.join(release, "extra.txt"), "foreign", "utf8");
    await expect(verifyExactReleaseTree(release, expected)).rejects.toMatchObject({
      code: "GENERATED_RELEASE_CONTENT_MISMATCH",
    });
  });

  it("atomically creates and replaces a regular root catalog", async () => {
    const workspace = await makeTemporaryDirectory();
    const generated = path.join(workspace, "generated");
    const catalog = path.join(generated, "catalog.json");
    await atomicallyReplaceRegularFile(generated, catalog, Buffer.from("one\n"));
    await atomicallyReplaceRegularFile(generated, catalog, Buffer.from("two\n"));
    expect(await readFile(catalog, "utf8")).toBe("two\n");
  });

  it("rejects a report parent junction swap before opening the temporary file", async (context) => {
    const workspace = await makeTemporaryDirectory();
    const parent = path.join(workspace, "reports");
    const displaced = path.join(workspace, "reports-owned");
    const external = path.join(workspace, "external");
    await mkdir(parent);
    await mkdir(external);
    try {
      await atomicallyReplaceSafeRegularFile(
        path.join(parent, "report.json"),
        Buffer.from("{}\n"),
        {
          beforeTemporaryWrite: async () => {
            await rename(parent, displaced);
            await symlink(
              external,
              parent,
              process.platform === "win32" ? "junction" : "dir",
            );
          },
        },
      );
      throw new Error("Expected hostile report parent to be rejected.");
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "EPERM" || code === "EACCES") {
        context.skip("Host does not permit directory-link creation.");
        return;
      }
      expect(error).toBeInstanceOf(GenerationFileError);
    }
    await expect(readFile(path.join(external, "report.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
