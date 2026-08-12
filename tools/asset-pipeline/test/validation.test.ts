import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../src/report.js";
import { inspectManifest, validateSourceTree } from "../src/validation.js";
import {
  makeAssetEnvelope,
  makeTechnicalPng,
  pngChunk,
  writeAssetFixture,
} from "./helpers.js";

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "editorial-doll-validation-"),
  );
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

describe("source-tree validation", () => {
  it("validates and hashes a complete technical fixture", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    const png = makeTechnicalPng();
    await writeAssetFixture(sourceRoot, { pngs: { "top.png": png } });

    const report = await validateSourceTree(sourceRoot);
    expect(report).toMatchObject({
      schemaVersion: "2.0.0",
      ok: true,
      summary: { manifests: 1, assets: 1, parts: 1, errors: 0 },
      diagnostics: [],
    });
    expect(report.assets[0]).toMatchObject({
      reference: { id: "top-fixture-001", version: "1.0.0" },
      manifest: {
        path: "muse-editorial-001/top/top-fixture-001/1.0.0/manifest.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      parts: [
        {
          role: "top",
          sourcePath:
            "muse-editorial-001/top/top-fixture-001/1.0.0/top.png",
          width: 2048,
          height: 3072,
          bitDepth: 8,
          colorType: 6,
          byteSize: png.byteLength,
          sha256: createHash("sha256").update(png).digest("hex"),
          colour: {
            srgbDeclaration: "png-srgb",
            srgbRenderingIntent: 0,
            profileSha256: null,
          },
          alpha: {
            transparentPixels: 2048 * 3072,
            translucentPixels: 0,
            opaquePixels: 0,
            nonZeroBounds: null,
            edgeGuardViolations: 0,
            edgeGuardExceptedPixels: 0,
          },
        },
      ],
    });
    expect(canonicalJson(report)).not.toContain(sourceRoot);
    expect(canonicalJson(report)).not.toMatch(/\\/u);
  });

  it("emits byte-identical canonical reports on repeated runs", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    await writeAssetFixture(sourceRoot, {
      slot: "top",
      id: "top-zeta-001",
    });
    await writeAssetFixture(sourceRoot, {
      slot: "bottom",
      id: "bottom-alpha-001",
    });

    const first = canonicalJson(await validateSourceTree(sourceRoot));
    const second = canonicalJson(await validateSourceTree(sourceRoot));
    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(first).not.toMatch(/timestamp|generatedAt|[A-Z]:\\/u);
  });

  it.each([
    ["bottom", "top-fixture-001", "1.0.0", "MANIFEST_SLOT_MISMATCH"],
    ["top", "top-other-001", "1.0.0", "MANIFEST_ID_MISMATCH"],
    ["top", "top-fixture-001", "2.0.0", "MANIFEST_VERSION_MISMATCH"],
  ])(
    "rejects directory disagreement with %s/%s/%s",
    async (directorySlot, directoryId, directoryVersion, code) => {
      const sourceRoot = await makeTemporaryDirectory();
      const envelope = makeAssetEnvelope();
      await writeAssetFixture(sourceRoot, {
        slot: directorySlot,
        id: directoryId,
        version: directoryVersion,
        envelope,
        pngs: { "top.png": makeTechnicalPng() },
      });

      const report = await validateSourceTree(sourceRoot);
      expect(report.ok).toBe(false);
      expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        code,
      );
    },
  );

  it("rejects malformed, global non-background, and incompatible Muse scopes", async () => {
    const malformedRoot = await makeTemporaryDirectory();
    await writeFile(
      path.join(malformedRoot, "manifest.json"),
      `${JSON.stringify(makeAssetEnvelope())}\n`,
    );
    await writeFile(path.join(malformedRoot, "top.png"), makeTechnicalPng());
    expect(
      (await validateSourceTree(malformedRoot)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("MANIFEST_LAYOUT_INVALID");

    const globalRoot = await makeTemporaryDirectory();
    await writeAssetFixture(globalRoot, {
      scope: "global",
      envelope: makeAssetEnvelope({ museId: "global" }),
    });
    expect(
      (await validateSourceTree(globalRoot)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("MANIFEST_SCOPE_MISMATCH");

    const museRoot = await makeTemporaryDirectory();
    await writeAssetFixture(museRoot, {
      scope: "muse-other-001",
      envelope: makeAssetEnvelope({ museId: "muse-editorial-001" }),
    });
    expect(
      (await validateSourceTree(museRoot)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("MANIFEST_MUSE_MISMATCH");
  });

  it("rejects duplicate id@version manifests", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    await writeAssetFixture(sourceRoot, { scope: "muse-alpha-001" });
    await writeAssetFixture(sourceRoot, { scope: "muse-beta-001" });

    const report = await validateSourceTree(sourceRoot);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ASSET_IDENTITY_DUPLICATE" }),
      ]),
    );
  });

  it("reports missing, role-mismatched, and undeclared source files", async () => {
    const missingRoot = await makeTemporaryDirectory();
    await writeAssetFixture(missingRoot, { pngs: {} });
    expect(
      (await validateSourceTree(missingRoot)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("SOURCE_FILE_NOT_FOUND");

    const mismatchRoot = await makeTemporaryDirectory();
    const envelope = makeAssetEnvelope({
      parts: [
        {
          id: "top-fixture-001-main",
          role: "top",
          sourcePath: "wrong.png",
        },
      ],
    });
    const fixture = await writeAssetFixture(mismatchRoot, {
      envelope,
      pngs: {
        "wrong.png": makeTechnicalPng(),
        "extra.png": makeTechnicalPng(),
      },
    });
    const report = await validateSourceTree(mismatchRoot);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "SOURCE_FILENAME_ROLE_MISMATCH",
        "SOURCE_FILE_UNDECLARED",
      ]),
    );
    expect(report.diagnostics.map((diagnostic) => diagnostic.path)).toContain(
      path
        .relative(mismatchRoot, path.join(fixture.directory, "extra.png"))
        .split(path.sep)
        .join("/"),
    );
  });

  it.each([
    ["/absolute.png", "SOURCE_PATH_ABSOLUTE"],
    ["C:/absolute.png", "SOURCE_PATH_DRIVE_QUALIFIED"],
    ["C:drive.png", "SOURCE_PATH_DRIVE_QUALIFIED"],
    ["\\\\server\\share\\top.png", "SOURCE_PATH_UNC"],
    ["folder\\top.png", "SOURCE_PATH_BACKSLASH"],
    ["folder//top.png", "SOURCE_PATH_EMPTY_SEGMENT"],
    ["folder/./top.png", "SOURCE_PATH_DOT_SEGMENT"],
    ["folder/../top.png", "SOURCE_PATH_TRAVERSAL"],
  ])("preserves the stable path diagnostic for %s", async (sourcePath, code) => {
    const sourceRoot = await makeTemporaryDirectory();
    const envelope = makeAssetEnvelope({
      parts: [
        {
          id: "top-fixture-001-main",
          role: "top",
          sourcePath,
        },
      ],
    });
    await writeAssetFixture(sourceRoot, { envelope, pngs: {} });

    const report = await validateSourceTree(sourceRoot);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      code,
    );
  });

  it("maps PNG structural failures into stable report diagnostics", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    await writeAssetFixture(sourceRoot, {
      pngs: {
        "top.png": makeTechnicalPng({
          extraChunks: [pngChunk("acTL")],
        }),
      },
    });

    const report = await validateSourceTree(sourceRoot);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PNG_APNG_FORBIDDEN" }),
      ]),
    );

    const zlibRoot = await makeTemporaryDirectory();
    await writeAssetFixture(zlibRoot, {
      pngs: {
        "top.png": makeTechnicalPng({ idatData: Uint8Array.of(0) }),
      },
    });
    expect(
      (await validateSourceTree(zlibRoot)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("PNG_IMAGE_DATA_INVALID");
  });

  it("maps decoded colour metadata failures into stable diagnostics", async () => {
    const missingSrgbRoot = await makeTemporaryDirectory();
    await writeAssetFixture(missingSrgbRoot, {
      pngs: { "top.png": makeTechnicalPng({ includeSrgb: false }) },
    });
    expect(
      (await validateSourceTree(missingSrgbRoot)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("PNG_SRGB_MISSING");

    const metadataRoot = await makeTemporaryDirectory();
    await writeAssetFixture(metadataRoot, {
      pngs: {
        "top.png": makeTechnicalPng({
          extraChunks: [pngChunk("tEXt", Buffer.from("author=private"))],
        }),
      },
    });
    expect(
      (await validateSourceTree(metadataRoot)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("PNG_ANCILLARY_FORBIDDEN");
  });

  it("rejects mixed source precision within one asset version", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    const envelope = makeAssetEnvelope({
      slot: "hair",
      parts: [
        {
          id: "hair-fixture-001-back",
          role: "hair-back",
          sourcePath: "hair-back.png",
        },
        {
          id: "hair-fixture-001-front",
          role: "hair-front",
          sourcePath: "hair-front.png",
        },
      ],
    });
    await writeAssetFixture(sourceRoot, {
      slot: "hair",
      envelope,
      pngs: {
        "hair-back.png": makeTechnicalPng({ bitDepth: 8 }),
        "hair-front.png": makeTechnicalPng({ bitDepth: 16 }),
      },
    });
    expect(
      (await validateSourceTree(sourceRoot)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("ASSET_SOURCE_BIT_DEPTH_MIXED");
  });

  it("includes exact raw manifest bytes in the source fingerprint", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    const fixture = await writeAssetFixture(sourceRoot);
    const first = await validateSourceTree(sourceRoot);
    const firstAsset = first.assets[0];
    expect(firstAsset).toBeDefined();
    const manifest = await readFile(fixture.manifestPath, "utf8");
    await writeFile(fixture.manifestPath, `${manifest}\n`);
    const second = await validateSourceTree(sourceRoot);
    const secondAsset = second.assets[0];
    expect(secondAsset).toBeDefined();
    expect(secondAsset?.asset).toEqual(firstAsset?.asset);
    expect(secondAsset?.manifest.sha256).not.toBe(firstAsset?.manifest.sha256);
    expect(secondAsset?.sourceFingerprint).not.toBe(
      firstAsset?.sourceFingerprint,
    );
  });

  it("rejects a source part above the 25 MiB budget without decoding it", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    const fixture = await writeAssetFixture(sourceRoot);
    const sourcePath = path.join(fixture.directory, "top.png");
    const handle = await open(sourcePath, "r+");
    try {
      await handle.truncate(25 * 1_048_576 + 1);
    } finally {
      await handle.close();
    }

    const report = await validateSourceTree(sourceRoot);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SOURCE_FILE_SIZE_EXCEEDED" }),
      ]),
    );
  });

  it("rejects an asset above the 50 MiB aggregate source budget", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    const envelope = makeAssetEnvelope({
      slot: "hair",
      parts: [
        {
          id: "hair-fixture-001-back",
          role: "hair-back",
          sourcePath: "hair-back.png",
        },
        {
          id: "hair-fixture-001-front",
          role: "hair-front",
          sourcePath: "hair-front.png",
        },
      ],
    });
    const fixture = await writeAssetFixture(sourceRoot, {
      slot: "hair",
      id: "top-fixture-001",
      envelope,
      pngs: {
        "hair-back.png": makeTechnicalPng(),
        "hair-front.png": makeTechnicalPng(),
      },
    });

    for (const filename of ["hair-back.png", "hair-front.png"]) {
      const handle = await open(path.join(fixture.directory, filename), "r+");
      try {
        await handle.truncate(25 * 1_048_576 + 1);
      } finally {
        await handle.close();
      }
    }

    const report = await validateSourceTree(sourceRoot);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "ASSET_SOURCE_SIZE_EXCEEDED",
    );
  });

  it("rejects duplicate JSON keys through the public manifest inspection path", async () => {
    const sourceRoot = await makeTemporaryDirectory();
    const fixture = await writeAssetFixture(sourceRoot);
    await writeFile(
      fixture.manifestPath,
      '{"schemaVersion":"1.0.0","schemaVersion":"1.0.0"}',
    );

    const report = await inspectManifest(fixture.manifestPath);
    expect(report).toMatchObject({ ok: false, summary: { manifests: 1 } });
    expect(report.diagnostics[0]).toMatchObject({ code: "JSON_DUPLICATE_KEY" });
  });

  it("bounds manifest bytes and requires valid UTF-8", async () => {
    const oversizedRoot = await makeTemporaryDirectory();
    const oversizedFixture = await writeAssetFixture(oversizedRoot);
    const oversizedHandle = await open(oversizedFixture.manifestPath, "r+");
    try {
      await oversizedHandle.truncate(1_048_577);
    } finally {
      await oversizedHandle.close();
    }
    expect(
      (await inspectManifest(oversizedFixture.manifestPath)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("MANIFEST_SIZE_EXCEEDED");

    const utf8Root = await makeTemporaryDirectory();
    const utf8Fixture = await writeAssetFixture(utf8Root);
    await writeFile(utf8Fixture.manifestPath, Uint8Array.of(0xc3, 0x28));
    expect(
      (await inspectManifest(utf8Fixture.manifestPath)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("MANIFEST_UTF8_INVALID");
  });

  it("rejects source-file and manifest symlinks", async (context) => {
    const sourceRoot = await makeTemporaryDirectory();
    const fixture = await writeAssetFixture(sourceRoot, { pngs: {} });
    const internalTarget = path.join(fixture.directory, "internal.png");
    await writeFile(internalTarget, makeTechnicalPng());
    try {
      await symlink(internalTarget, path.join(fixture.directory, "top.png"), "file");
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
    expect(
      (await validateSourceTree(sourceRoot)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("SOURCE_FILE_SYMLINK_FORBIDDEN");

    const manifestTarget = path.join(sourceRoot, "external-manifest.json");
    await writeFile(manifestTarget, `${JSON.stringify(makeAssetEnvelope())}\n`);
    await rm(fixture.manifestPath);
    await symlink(manifestTarget, fixture.manifestPath, "file");
    expect(
      (await validateSourceTree(sourceRoot)).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("MANIFEST_SYMLINK_FORBIDDEN");
  });

  it("accepts a source root reached through a directory link", async (context) => {
    const workspace = await makeTemporaryDirectory();
    const realRoot = path.join(workspace, "real-source");
    const linkedRoot = path.join(workspace, "linked-source");
    await mkdir(realRoot, { recursive: true });
    await writeAssetFixture(realRoot);
    try {
      await symlink(
        realRoot,
        linkedRoot,
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

    expect(await validateSourceTree(linkedRoot)).toMatchObject({ ok: true });
  });
});
