import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discoverSourceFiles } from "../src/discovery.js";
import {
  AssetPathError,
  assertPortableRelativePngPath,
  compareCodePoint,
  resolveContainedSourceFile,
  toSourceRootRelativePosixPath,
} from "../src/paths.js";

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "editorial-doll-paths-"));
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

describe("asset-pipeline portable paths", () => {
  it("uses locale-independent Unicode code-point ordering", () => {
    expect(["z", "A", "a", "ðŸ˜€"].sort(compareCodePoint)).toEqual([
      "A",
      "a",
      "z",
      "ðŸ˜€",
    ]);
  });

  it.each([
    ["/absolute.png", "SOURCE_PATH_ABSOLUTE"],
    ["C:/drive.png", "SOURCE_PATH_DRIVE_QUALIFIED"],
    ["C:drive.png", "SOURCE_PATH_DRIVE_QUALIFIED"],
    ["\\\\server\\share\\asset.png", "SOURCE_PATH_UNC"],
    ["//server/share/asset.png", "SOURCE_PATH_UNC"],
    ["folder\\asset.png", "SOURCE_PATH_BACKSLASH"],
    ["folder//asset.png", "SOURCE_PATH_EMPTY_SEGMENT"],
    ["folder/./asset.png", "SOURCE_PATH_DOT_SEGMENT"],
    ["folder/../asset.png", "SOURCE_PATH_TRAVERSAL"],
    ["folder?/asset.png", "SOURCE_PATH_CHARACTER_INVALID"],
    ["scheme:asset.png", "SOURCE_PATH_CHARACTER_INVALID"],
    ["folder/asset.PNG", "SOURCE_PATH_NOT_PNG"],
  ])("rejects %s with %s", (sourcePath, code) => {
    try {
      assertPortableRelativePngPath(sourcePath);
      throw new Error("Expected path validation to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(AssetPathError);
      expect((error as AssetPathError).code).toBe(code);
    }
  });

  it("normalizes a nested source path to root-relative POSIX form", async () => {
    const root = await makeTemporaryDirectory();
    const sourcePath = path.join(root, "muse-editorial-001", "top", "top.png");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "fixture");

    expect(toSourceRootRelativePosixPath(root, sourcePath)).toBe(
      "muse-editorial-001/top/top.png",
    );
    expect(() => toSourceRootRelativePosixPath(root, path.dirname(root))).toThrow(
      AssetPathError,
    );
  });

  it("discovers manifests and PNG files deterministically and skips templates", async () => {
    const root = await makeTemporaryDirectory();
    const paths = [
      path.join(root, "z", "manifest.json"),
      path.join(root, "a", "nested", "manifest.json"),
      path.join(root, "a", "nested", "layer.PNG"),
      path.join(root, "z", "layer.png"),
      path.join(root, "_templates", "manifest.json"),
      path.join(root, "_templates", "template.png"),
    ];
    for (const filePath of paths) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, "fixture");
    }

    const discovery = await discoverSourceFiles(root);
    expect(discovery.manifestPaths.map((item) => toSourceRootRelativePosixPath(root, item))).toEqual([
      "a/nested/manifest.json",
      "z/manifest.json",
    ]);
    expect(discovery.pngPaths.map((item) => toSourceRootRelativePosixPath(root, item))).toEqual([
      "a/nested/layer.PNG",
      "z/layer.png",
    ]);
  });

  it("resolves a declared source part inside its manifest directory", async () => {
    const root = await makeTemporaryDirectory();
    const manifestDirectory = path.join(root, "asset", "1.0.0");
    const sourcePath = path.join(manifestDirectory, "top.png");
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(sourcePath, "fixture");

    const resolved = await resolveContainedSourceFile(manifestDirectory, "top.png");
    expect(resolved.absolutePath).toBe(await realpath(sourcePath));
    expect(resolved.manifestRelativePath).toBe("top.png");
  });

  it("rejects a declared file symlink that resolves outside its manifest directory", async (context) => {
    const root = await makeTemporaryDirectory();
    const manifestDirectory = path.join(root, "asset", "1.0.0");
    const outsidePath = path.join(root, "outside.png");
    const linkedPath = path.join(manifestDirectory, "top.png");
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(outsidePath, "fixture");

    try {
      await symlink(outsidePath, linkedPath, "file");
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "EPERM" || code === "EACCES") {
        context.skip("Host does not permit symbolic-link creation.");
        return;
      }
      throw error;
    }

    await expect(resolveContainedSourceFile(manifestDirectory, "top.png")).rejects.toMatchObject({
      code: "SOURCE_FILE_OUTSIDE_MANIFEST",
    });
  });

  it("does not follow directory symlinks during discovery", async (context) => {
    const root = await makeTemporaryDirectory();
    const targetDirectory = path.join(root, "real-assets");
    const linkedDirectory = path.join(root, "linked-assets");
    const manifestPath = path.join(targetDirectory, "manifest.json");
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(manifestPath, "fixture");

    try {
      await symlink(
        targetDirectory,
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "EPERM" || code === "EACCES") {
        context.skip("Host does not permit symbolic-link creation.");
        return;
      }
      throw error;
    }

    const discovery = await discoverSourceFiles(root);
    expect(discovery.manifestPaths.map((item) => toSourceRootRelativePosixPath(root, item))).toEqual([
      "real-assets/manifest.json",
    ]);
  });
});
