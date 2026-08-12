import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CliIo } from "../src/cli.js";
import { writeAssetFixture } from "./helpers.js";

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "editorial-doll-cli-"));
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

const captureIo = (): {
  readonly io: CliIo;
  readonly stdout: string[];
  readonly stderr: string[];
} => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
    stdout,
    stderr,
  };
};

describe("editorial-asset CLI", () => {
  it("documents only the implemented command surface", async () => {
    const capture = captureIo();
    expect(await runCli(["--help"], capture.io, process.cwd())).toBe(0);
    expect(capture.stdout.join("")).toContain("doctor");
    expect(capture.stdout.join("")).toContain("inspect");
    expect(capture.stdout.join("")).toContain("validate");
    expect(capture.stdout.join("")).toContain("generate");
    expect(capture.stdout.join("")).not.toContain("build --out");
    expect(capture.stderr).toEqual([]);
  });

  it("accepts pnpm's leading argument separator", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    const capture = captureIo();
    expect(
      await runCli(
        ["--", "doctor", "--input", sourceRoot, "--json"],
        capture.io,
        process.cwd(),
      ),
    ).toBe(0);
    expect(JSON.parse(capture.stdout.join(""))).toMatchObject({ ok: true });
  });

  it("returns a machine-readable doctor result", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    const capture = captureIo();
    expect(
      await runCli(
        ["doctor", "--input", sourceRoot, "--json"],
        capture.io,
        path.dirname(sourceRoot),
      ),
    ).toBe(0);

    expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
      schemaVersion: "2.0.0",
      command: "doctor",
      ok: true,
      checks: [
        { code: "NODE_VERSION", ok: true },
        { code: "SOURCE_ROOT_READABLE", ok: true },
        { code: "SHARP_VERSION", ok: true, value: "0.35.3" },
        { code: "LIBVIPS_VERSION", ok: true },
      ],
    });
    expect(capture.stderr).toEqual([]);
  });

  it("validates from another cwd and atomically replaces a report", async () => {
    const workspace = await makeTemporaryDirectory();
    const sourceRoot = path.join(workspace, "source tree");
    await writeAssetFixture(sourceRoot);
    const reportPath = path.join(workspace, "reports", "asset-report.json");
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, "old", { flag: "w" });

    const capture = captureIo();
    expect(
      await runCli(
        [
          "validate",
          "--input",
          path.relative(workspace, sourceRoot),
          "--report",
          path.relative(workspace, reportPath),
          "--json",
        ],
        capture.io,
        workspace,
      ),
    ).toBe(0);

    const stdoutReport = JSON.parse(capture.stdout.join("")) as unknown;
    const fileReport = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
    expect(fileReport).toEqual(stdoutReport);
    expect(await readFile(reportPath, "utf8")).toMatch(/\n$/u);
  });

  it("inspects one manifest through a relative path", async () => {
    const workspace = await makeTemporaryDirectory();
    const fixture = await writeAssetFixture(path.join(workspace, "sources"));
    const capture = captureIo();
    expect(
      await runCli(
        ["inspect", path.relative(workspace, fixture.manifestPath), "--json"],
        capture.io,
        workspace,
      ),
    ).toBe(0);
    expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
      ok: true,
      summary: { manifests: 1, assets: 1, parts: 1, errors: 0 },
    });
  });

  it("uses exit 2 for validation failures and emits no stack trace", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    await writeAssetFixture(sourceRoot, { pngs: {} });
    const capture = captureIo();
    expect(
      await runCli(
        ["validate", "--input", sourceRoot, "--json"],
        capture.io,
        sourceRoot,
      ),
    ).toBe(2);
    const report = JSON.parse(capture.stdout.join("")) as {
      readonly diagnostics: readonly { readonly code: string }[];
    };
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SOURCE_FILE_NOT_FOUND",
    );
    expect(capture.stdout.join("")).not.toContain(" at ");
    expect(capture.stderr).toEqual([]);
  });

  it("returns one stable JSON error for invalid arguments", async () => {
    const capture = captureIo();
    expect(
      await runCli(["validate", "--json"], capture.io, process.cwd()),
    ).toBe(1);
    expect(JSON.parse(capture.stdout.join(""))).toEqual({
      schemaVersion: "2.0.0",
      ok: false,
      error: {
        code: "CLI_ARGUMENT_INVALID",
        message: "validate requires --input and accepts no positional paths.",
      },
    });
    expect(capture.stderr).toEqual([]);
  });

  it("refuses to write a report inside the source tree", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    const capture = captureIo();
    expect(
      await runCli(
        [
          "validate",
          "--input",
          sourceRoot,
          "--report",
          path.join(sourceRoot, "report.json"),
          "--json",
        ],
        capture.io,
        process.cwd(),
      ),
    ).toBe(1);
    expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
      error: { code: "REPORT_PATH_INSIDE_SOURCE_ROOT" },
    });
  });

  it("rejects a report path through a directory link", async (context) => {
    const workspace = await makeTemporaryDirectory();
    const sourceRoot = path.join(workspace, "source");
    const external = path.join(workspace, "external");
    const linkedReports = path.join(workspace, "linked-reports");
    await writeAssetFixture(sourceRoot);
    await mkdir(external);
    try {
      await symlink(
        external,
        linkedReports,
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
    const capture = captureIo();
    expect(
      await runCli(
        [
          "validate",
          "--input",
          sourceRoot,
          "--report",
          path.join(linkedReports, "report.json"),
          "--json",
        ],
        capture.io,
        workspace,
      ),
    ).toBe(1);
    expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
      error: { code: "GENERATED_PATH_LINK_FORBIDDEN" },
    });
    await expect(readFile(path.join(external, "report.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("generates and reuses a canonical empty immutable release", async () => {
    const workspace = await makeTemporaryDirectory();
    const sourceRoot = path.join(workspace, "source");
    const generatedRoot = path.join(workspace, "generated");
    await mkdir(sourceRoot);
    const firstCapture = captureIo();
    expect(
      await runCli(
        [
          "generate",
          "--input",
          sourceRoot,
          "--output",
          generatedRoot,
          "--json",
        ],
        firstCapture.io,
        workspace,
      ),
    ).toBe(0);
    const firstCatalogBytes = firstCapture.stdout.join("");
    const catalog = JSON.parse(firstCatalogBytes) as {
      readonly schemaVersion: string;
      readonly releaseId: string;
      readonly releasePath: string;
      readonly assets: readonly unknown[];
    };
    expect(catalog).toMatchObject({ schemaVersion: "1.0.0", assets: [] });
    expect(catalog.releasePath).toBe(`releases/${catalog.releaseId}`);
    expect(await readFile(path.join(generatedRoot, "catalog.json"), "utf8")).toBe(
      firstCatalogBytes,
    );
    expect(
      await readFile(
        path.join(generatedRoot, catalog.releasePath, "catalog.json"),
        "utf8",
      ),
    ).toBe(firstCatalogBytes);

    const secondCapture = captureIo();
    expect(
      await runCli(
        [
          "generate",
          "--input",
          sourceRoot,
          "--output",
          generatedRoot,
          "--json",
        ],
        secondCapture.io,
        workspace,
      ),
    ).toBe(0);
    expect(secondCapture.stdout.join("")).toBe(firstCatalogBytes);
  });

  it("rejects overlapping generation roots without writing", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    const capture = captureIo();
    expect(
      await runCli(
        [
          "generate",
          "--input",
          sourceRoot,
          "--output",
          path.join(sourceRoot, "generated"),
          "--json",
        ],
        capture.io,
        process.cwd(),
      ),
    ).toBe(1);
    expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
      error: { code: "SOURCE_OUTPUT_OVERLAP" },
    });
  });
});
