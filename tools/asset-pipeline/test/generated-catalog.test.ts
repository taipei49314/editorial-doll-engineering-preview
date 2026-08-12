import { describe, expect, it } from "vitest";

import {
  GeneratedCatalogSchema,
  canonicalReleaseIdentity,
  createGeneratedCatalog,
  createReleaseIdentityDescriptor,
  deriveVisualQaRequired,
} from "../src/generated-catalog.js";

const hash = (character: string): string => character.repeat(64);

const sourceAlpha = {
  transparentPixels: 2048 * 3072 - 2,
  translucentPixels: 1,
  opaquePixels: 1,
  nonZeroBounds: { minX: 100, minY: 200, maxX: 101, maxY: 200 },
  edgeGuardViolations: 0,
  edgeGuardExceptedPixels: 0,
};

const runtimeAlpha = {
  transparentPixels: 1024 * 1536 - 2,
  translucentPixels: 1,
  opaquePixels: 1,
  nonZeroBounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
};

const thumbnailAlpha = {
  transparentPixels: 320 * 480 - 2,
  translucentPixels: 1,
  opaquePixels: 1,
  nonZeroBounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
};

const generator = {
  transformContractVersion: "1.0.0",
  node: "24.16.0",
  platform: "win32",
  arch: "x64",
  sharp: "0.35.3",
  libvips: "8.17.1",
} as const;

const assetInput = {
  manifest: { path: "muse-editorial-001/top/top-fixture-001/1.0.0/manifest.json", sha256: hash("a") },
  sourceFingerprint: hash("b"),
  asset: {
    id: "top-fixture-001",
    version: "1.0.0",
    slot: "top",
    displayName: "Technical fixture",
    frame: { width: 2048, height: 3072, origin: "top-left" },
    tags: ["fixture"],
    parts: [{ id: "top-fixture-001-main", role: "top", sourcePath: "top.png" }],
    compatibility: {
      compatibleMuses: [{ id: "muse-editorial-001", version: "1.0.0" }],
      requiresActiveTags: [],
      excludesActiveTags: [],
      incompatibleAssets: [],
    },
  },
  technical: { edgeGuardExceptions: [] },
  parts: [{
    role: "top",
    source: {
      path: "muse-editorial-001/top/top-fixture-001/1.0.0/top.png",
      width: 2048,
      height: 3072,
      bitDepth: 8,
      colourType: 6,
      bytes: 100,
      sha256: hash("c"),
      colour: { kind: "png-srgb", srgbRenderingIntent: 0, profileSha256: null },
      density: null,
      alpha: sourceAlpha,
    },
    runtime: {
      path: "muse-editorial-001/top/top-fixture-001/1.0.0/runtime/top.png",
      width: 1024,
      height: 1536,
      bitDepth: 8,
      colourType: 6,
      bytes: 100,
      sha256: hash("d"),
      colour: { kind: "icc-srgb", srgbRenderingIntent: null, profileSha256: hash("e") },
      density: { xPixelsPerMeter: 1000, yPixelsPerMeter: 1000, unit: "metre" },
      alpha: runtimeAlpha,
    },
    thumbnail: {
      path: "muse-editorial-001/top/top-fixture-001/1.0.0/thumbnail/top.png",
      width: 320,
      height: 480,
      bitDepth: 8,
      colourType: 6,
      bytes: 100,
      sha256: hash("f"),
      colour: { kind: "icc-srgb", srgbRenderingIntent: null, profileSha256: hash("e") },
      density: { xPixelsPerMeter: 1000, yPixelsPerMeter: 1000, unit: "metre" },
      alpha: thumbnailAlpha,
    },
  }],
} as const;

const makeCatalog = () =>
  createGeneratedCatalog({
    generator,
    sourceReport: { schemaVersion: "2.0.0", sha256: hash("0") },
    assets: [assetInput],
  });

describe("generated catalog", () => {
  it("derives the exact stable visual-QA code set", () => {
    expect(deriveVisualQaRequired(assetInput.asset)).toEqual([
      "MATTE_CONTAMINATION",
      "SEMANTIC_CROP",
      "STRAIGHT_ALPHA_PROVENANCE",
    ]);
    expect(deriveVisualQaRequired({
      slot: "background",
      parts: [{}, {}],
    } as never)).toEqual([
      "BACKGROUND_OPACITY_INTENT",
      "MATTE_CONTAMINATION",
      "SEMANTIC_CROP",
      "SPLIT_LAYER_SEAMS",
      "STRAIGHT_ALPHA_PROVENANCE",
    ]);
  });

  it("creates a strict release-relative catalog from a non-self-referential identity", () => {
    const catalog = makeCatalog();
    expect(catalog.releasePath).toBe(`releases/${catalog.releaseId}`);
    expect(catalog.assets[0]?.visualQaRequired).toEqual(
      deriveVisualQaRequired(assetInput.asset),
    );

    const descriptor = createReleaseIdentityDescriptor(catalog);
    expect(Object.keys(descriptor)).toEqual([
      "sourceReportSha256",
      "transformContractVersion",
      "generator",
      "derivatives",
    ]);
    expect(canonicalReleaseIdentity(descriptor)).not.toContain("releasePath");
    expect(canonicalReleaseIdentity(descriptor)).not.toContain(catalog.releaseId);
    expect(descriptor.derivatives.map((entry) => entry.path)).toEqual([
      assetInput.parts[0].runtime.path,
      assetInput.parts[0].thumbnail.path,
    ]);
    expect(GeneratedCatalogSchema.parse(catalog)).toEqual(catalog);
  });

  it("rejects mismatched visual QA, derivative alpha shape, and release-relative path escapes", () => {
    const catalog = makeCatalog();
    const wrongQa = {
      ...catalog,
      assets: catalog.assets.map((entry) => ({ ...entry, visualQaRequired: [] })),
    };
    expect(() => GeneratedCatalogSchema.parse(wrongQa)).toThrow();

    const derivativeWithMasterEvidence = {
      ...catalog,
      assets: catalog.assets.map((entry) => ({
        ...entry,
        parts: entry.parts.map((part) => ({
          ...part,
          runtime: {
            ...part.runtime,
            alpha: { ...part.runtime.alpha, edgeGuardViolations: 0 },
          },
        })),
      })),
    };
    expect(() => GeneratedCatalogSchema.parse(derivativeWithMasterEvidence)).toThrow();

    const wrongDerivativeCanvasCount = {
      ...catalog,
      assets: catalog.assets.map((entry) => ({
        ...entry,
        parts: entry.parts.map((part) => ({
          ...part,
          thumbnail: {
            ...part.thumbnail,
            alpha: { ...part.thumbnail.alpha, transparentPixels: 1 },
          },
        })),
      })),
    };
    expect(() => GeneratedCatalogSchema.parse(wrongDerivativeCanvasCount)).toThrow();

    const embeddedReleaseId = {
      ...catalog,
      assets: catalog.assets.map((entry) => ({
        ...entry,
        parts: entry.parts.map((part) => ({
          ...part,
          runtime: {
            ...part.runtime,
            path: `muse/${catalog.releaseId}/runtime/top.png`,
          },
        })),
      })),
    };
    expect(() => GeneratedCatalogSchema.parse(embeddedReleaseId)).toThrow();
  });

  it("changes release identity when an ordered derivative hash changes", () => {
    const first = makeCatalog();
    const alteredInput = {
      ...assetInput,
      parts: [{
        ...assetInput.parts[0],
        thumbnail: { ...assetInput.parts[0].thumbnail, sha256: hash("9") },
      }],
    };
    const second = createGeneratedCatalog({
      generator,
      sourceReport: { schemaVersion: "2.0.0", sha256: hash("0") },
      assets: [alteredInput],
    });
    expect(second.releaseId).not.toBe(first.releaseId);
  });
});
