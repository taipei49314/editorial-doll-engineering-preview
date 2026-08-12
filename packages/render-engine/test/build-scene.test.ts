import { describe, expect, it } from "vitest";

import { AssetSchema, CatalogSchema, MASTER_FRAME } from "@editorial-doll/domain";

import { buildScene } from "../src/core/build-scene.js";
import {
  SYNTHETIC_REFERENCES,
  SYNTHETIC_ALTERNATE_SOURCE_SET_DESCRIPTOR,
  SYNTHETIC_ALTERNATE_SOURCE_SET_ID,
  SYNTHETIC_FUTURE_ALTERNATE_SOURCE_SET_SHA256,
  SYNTHETIC_FUTURE_SOURCE_SET_CANONICAL,
  SYNTHETIC_FUTURE_SOURCE_SET_CONTRACT,
  SYNTHETIC_FUTURE_SOURCE_SET_SHA256,
  SYNTHETIC_SHARED_SELECTIONS,
  SYNTHETIC_SOURCE_SET_CANONICAL,
  SYNTHETIC_SOURCE_SET_CONTRACT,
  SYNTHETIC_SOURCE_SET_DESCRIPTOR,
  SYNTHETIC_SOURCE_SET_ID,
  canonicalizeSyntheticSourceSetDescriptor,
  createSyntheticDraft,
  createSyntheticResolver,
  deriveSyntheticSourceSetContract,
  hashSyntheticSourceSetDescriptor,
  hashSyntheticSourceSetContract,
  syntheticAssets,
  syntheticCatalog,
  syntheticMuse,
} from "./fixtures.js";

const expectFailureCode = (
  result: ReturnType<typeof buildScene>,
  code: string,
): void => {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  expect("scene" in result).toBe(false);
};

describe("buildScene", () => {
  it("fixes the future production source-set hashing contract without approving a Muse", () => {
    const expectedCanonical = `{
  "schemaVersion": "1.0.0",
  "assetReleaseId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "sourceReportSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "muse": {
    "id": "muse-synthetic-future-contract-001",
    "version": "1.0.0",
    "resourceSetId": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "runtimeSha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "masterSha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  }
}
`;
    expect(Object.keys(SYNTHETIC_FUTURE_SOURCE_SET_CONTRACT)).toEqual([
      "schemaVersion",
      "assetReleaseId",
      "sourceReportSha256",
      "muse",
    ]);
    expect(Object.keys(SYNTHETIC_FUTURE_SOURCE_SET_CONTRACT.muse)).toEqual([
      "id",
      "version",
      "resourceSetId",
      "runtimeSha256",
      "masterSha256",
    ]);
    expect(SYNTHETIC_FUTURE_SOURCE_SET_CANONICAL).toBe(expectedCanonical);
    expect(SYNTHETIC_FUTURE_SOURCE_SET_CANONICAL.endsWith("\n")).toBe(true);
    expect(hashSyntheticSourceSetContract(SYNTHETIC_FUTURE_SOURCE_SET_CONTRACT))
      .toBe(SYNTHETIC_FUTURE_SOURCE_SET_SHA256);
    expect(SYNTHETIC_FUTURE_SOURCE_SET_CONTRACT.muse.id).toContain(
      "synthetic-future-contract",
    );
    expect(SYNTHETIC_FUTURE_SOURCE_SET_CONTRACT.assetReleaseId).toBe(
      "b".repeat(64),
    );
  });

  it("keeps the future-envelope alternate hash as a serialization vector", () => {
    const alternate = {
      ...SYNTHETIC_FUTURE_SOURCE_SET_CONTRACT,
      assetReleaseId: "0".repeat(64),
    };
    expect(hashSyntheticSourceSetContract(alternate)).toBe(
      SYNTHETIC_FUTURE_ALTERNATE_SOURCE_SET_SHA256,
    );
  });

  it("derives the default source-set ID from every canonical synthetic descriptor", () => {
    expect(SYNTHETIC_SOURCE_SET_CANONICAL.endsWith("\n")).toBe(true);
    expect(SYNTHETIC_SOURCE_SET_CANONICAL).not.toContain("\r\n");
    expect(JSON.parse(SYNTHETIC_SOURCE_SET_CANONICAL)).toEqual(
      SYNTHETIC_SOURCE_SET_CONTRACT,
    );
    expect(Object.keys(SYNTHETIC_SOURCE_SET_CONTRACT)).toEqual([
      "schemaVersion",
      "assetReleaseId",
      "sourceReportSha256",
      "muse",
    ]);
    expect(Object.keys(SYNTHETIC_SOURCE_SET_CONTRACT.muse)).toEqual([
      "id",
      "version",
      "resourceSetId",
      "runtimeSha256",
      "masterSha256",
    ]);
    expect(SYNTHETIC_SOURCE_SET_ID).toBe(
      hashSyntheticSourceSetDescriptor(SYNTHETIC_SOURCE_SET_DESCRIPTOR),
    );
    expect(SYNTHETIC_SOURCE_SET_ID).toBe(
      hashSyntheticSourceSetContract(SYNTHETIC_SOURCE_SET_CONTRACT),
    );
    expect(SYNTHETIC_SOURCE_SET_CONTRACT).toEqual(
      deriveSyntheticSourceSetContract(SYNTHETIC_SOURCE_SET_DESCRIPTOR),
    );
    expect(SYNTHETIC_SOURCE_SET_CONTRACT.muse).toMatchObject({
      id: syntheticMuse.id,
      version: syntheticMuse.version,
      runtimeSha256:
        SYNTHETIC_SOURCE_SET_DESCRIPTOR.muse.bodyPart.runtime.encodedSha256,
      masterSha256:
        SYNTHETIC_SOURCE_SET_DESCRIPTOR.muse.bodyPart.master.encodedSha256,
    });
    for (const derivedHash of [
      SYNTHETIC_SOURCE_SET_CONTRACT.assetReleaseId,
      SYNTHETIC_SOURCE_SET_CONTRACT.sourceReportSha256,
      SYNTHETIC_SOURCE_SET_CONTRACT.muse.resourceSetId,
    ]) {
      expect(derivedHash).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(SYNTHETIC_SOURCE_SET_DESCRIPTOR.assets).toHaveLength(
      syntheticAssets.length,
    );
    expect(
      SYNTHETIC_SOURCE_SET_DESCRIPTOR.assets.map(
        (asset) => `${asset.id}@${asset.version}`,
      ),
    ).toEqual(
      expect.arrayContaining(
        syntheticAssets.map((asset) => `${asset.id}@${asset.version}`),
      ),
    );
    expect(SYNTHETIC_SOURCE_SET_DESCRIPTOR.muse).toMatchObject({
      id: syntheticMuse.id,
      version: syntheticMuse.version,
      bodyPart: {
        id: syntheticMuse.bodyPart.id,
        role: "muse-body",
        runtime: { width: 1024, height: 1536 },
        master: { width: 2048, height: 3072 },
      },
    });
  });

  it("canonicalizes descriptor permutations to the same source-set ID", () => {
    const permuted = {
      ...SYNTHETIC_SOURCE_SET_DESCRIPTOR,
      assets: [...SYNTHETIC_SOURCE_SET_DESCRIPTOR.assets]
        .reverse()
        .map((asset) => ({ ...asset, parts: [...asset.parts].reverse() })),
    };
    expect(canonicalizeSyntheticSourceSetDescriptor(permuted)).toBe(
      SYNTHETIC_SOURCE_SET_CANONICAL,
    );
    expect(hashSyntheticSourceSetDescriptor(permuted)).toBe(
      SYNTHETIC_SOURCE_SET_ID,
    );
  });

  it("changes source-set identity for asset, Muse, version, or hash changes", () => {
    const firstAsset = SYNTHETIC_SOURCE_SET_DESCRIPTOR.assets[0];
    const firstPart = firstAsset?.parts[0];
    if (firstAsset === undefined || firstPart === undefined) {
      throw new Error("Synthetic complete descriptor is empty.");
    }
    const replaceFirstAsset = (
      asset: (typeof SYNTHETIC_SOURCE_SET_DESCRIPTOR.assets)[number],
    ) => ({
      ...SYNTHETIC_SOURCE_SET_DESCRIPTOR,
      assets: [asset, ...SYNTHETIC_SOURCE_SET_DESCRIPTOR.assets.slice(1)],
    });
    const changedAssetDescriptor = replaceFirstAsset({
      ...firstAsset,
      id: `${firstAsset.id}-changed`,
    });
    const changedMuseDescriptor = {
      ...SYNTHETIC_SOURCE_SET_DESCRIPTOR,
      muse: {
        ...SYNTHETIC_SOURCE_SET_DESCRIPTOR.muse,
        id: `${SYNTHETIC_SOURCE_SET_DESCRIPTOR.muse.id}-changed`,
      },
    };
    const mutations = [
      changedAssetDescriptor,
      changedMuseDescriptor,
      replaceFirstAsset({ ...firstAsset, version: "9.9.9" }),
      replaceFirstAsset({
        ...firstAsset,
        parts: [
          {
            ...firstPart,
            runtime: { ...firstPart.runtime, encodedSha256: "6".repeat(64) },
          },
          ...firstAsset.parts.slice(1),
        ],
      }),
    ];
    for (const mutation of mutations) {
      expect(hashSyntheticSourceSetDescriptor(mutation)).not.toBe(
        SYNTHETIC_SOURCE_SET_ID,
      );
    }
    const changedAssetContract = deriveSyntheticSourceSetContract(
      changedAssetDescriptor,
    );
    expect(changedAssetContract.assetReleaseId).not.toBe(
      SYNTHETIC_SOURCE_SET_CONTRACT.assetReleaseId,
    );
    expect(changedAssetContract.sourceReportSha256).not.toBe(
      SYNTHETIC_SOURCE_SET_CONTRACT.sourceReportSha256,
    );
    expect(changedAssetContract.muse.resourceSetId).toBe(
      SYNTHETIC_SOURCE_SET_CONTRACT.muse.resourceSetId,
    );
    const changedMuseContract = deriveSyntheticSourceSetContract(
      changedMuseDescriptor,
    );
    expect(changedMuseContract.assetReleaseId).toBe(
      SYNTHETIC_SOURCE_SET_CONTRACT.assetReleaseId,
    );
    expect(changedMuseContract.sourceReportSha256).toBe(
      SYNTHETIC_SOURCE_SET_CONTRACT.sourceReportSha256,
    );
    expect(changedMuseContract.muse.resourceSetId).not.toBe(
      SYNTHETIC_SOURCE_SET_CONTRACT.muse.resourceSetId,
    );
    expect(SYNTHETIC_ALTERNATE_SOURCE_SET_ID).toBe(
      hashSyntheticSourceSetDescriptor(
        SYNTHETIC_ALTERNATE_SOURCE_SET_DESCRIPTOR,
      ),
    );
    expect(SYNTHETIC_ALTERNATE_SOURCE_SET_ID).not.toBe(
      SYNTHETIC_SOURCE_SET_ID,
    );
  });

  it("rejects mixing resource facts from two complete synthetic source sets", () => {
    const alternateHash =
      SYNTHETIC_ALTERNATE_SOURCE_SET_DESCRIPTOR.assets[0]?.parts[0]?.runtime
        .encodedSha256;
    if (alternateHash === undefined) {
      throw new Error("Synthetic alternate descriptor is empty.");
    }
    const resolver = createSyntheticResolver({
      sourceSetId: SYNTHETIC_SOURCE_SET_ID,
      transform(result) {
        return result.ok
          ? {
              ...result,
              resource: {
                ...result.resource,
                sourceSetId: SYNTHETIC_ALTERNATE_SOURCE_SET_ID,
                encodedSha256: alternateHash,
              },
            }
          : result;
      },
    });
    expectFailureCode(
      buildScene({
        draft: createSyntheticDraft(),
        catalog: syntheticCatalog,
        target: "runtime",
        resolver,
      }),
      "SCENE_RESOURCE_SET_MISMATCH",
    );
  });

  it("pins a synthetic resolver to the canonical hash of its backing descriptor", () => {
    const resolver = createSyntheticResolver({
      descriptor: SYNTHETIC_SOURCE_SET_DESCRIPTOR,
      sourceSetId: SYNTHETIC_ALTERNATE_SOURCE_SET_ID,
    });
    expectFailureCode(
      buildScene({
        draft: createSyntheticDraft(),
        catalog: syntheticCatalog,
        target: "runtime",
        resolver,
      }),
      "SCENE_RESOURCE_UNAVAILABLE",
    );
    expect(resolver.requests).toHaveLength(1);
  });

  it("requires an exact source-set ID on every synthetic resolver request", () => {
    const resolver = createSyntheticResolver();
    const built = buildScene({
      draft: createSyntheticDraft(),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver,
    });
    expect(built.ok).toBe(true);
    const request = resolver.requests[0];
    if (request === undefined) {
      throw new Error("Synthetic resolver did not capture a request.");
    }
    expect(
      resolver.resolve({
        ...request,
        sourceSetId: SYNTHETIC_ALTERNATE_SOURCE_SET_ID,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns unavailable when an exact descriptor fact is missing", () => {
    const descriptor = {
      ...SYNTHETIC_SOURCE_SET_DESCRIPTOR,
      assets: SYNTHETIC_SOURCE_SET_DESCRIPTOR.assets.map((asset) =>
        asset.id === SYNTHETIC_REFERENCES.hair.id &&
        asset.version === SYNTHETIC_REFERENCES.hair.version
          ? {
              ...asset,
              parts: asset.parts.filter((part) => part.role !== "hair-front"),
            }
          : asset,
      ),
    };
    const resolver = createSyntheticResolver({ descriptor });
    expectFailureCode(
      buildScene({
        draft: createSyntheticDraft({
          selections: { hair: SYNTHETIC_REFERENCES.hair },
        }),
        catalog: syntheticCatalog,
        target: "runtime",
        resolver,
      }),
      "SCENE_RESOURCE_UNAVAILABLE",
    );
    expect(resolver.sourceSetId).toBe(
      hashSyntheticSourceSetDescriptor(descriptor),
    );
  });

  it("resolves exact resource facts from the pinned complete descriptor", () => {
    const result = buildScene({
      draft: createSyntheticDraft({
        selections: { hair: SYNTHETIC_REFERENCES.hair },
      }),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: createSyntheticResolver(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graphHairBack = result.scene.nodes.find(
      (node) => node.role === "hair-back",
    );
    const descriptorHairBack = SYNTHETIC_SOURCE_SET_DESCRIPTOR.assets
      .find(
        (asset) =>
          asset.id === SYNTHETIC_REFERENCES.hair.id &&
          asset.version === SYNTHETIC_REFERENCES.hair.version,
      )
      ?.parts.find((part) => part.role === "hair-back");
    expect(graphHairBack?.resource).toMatchObject({
      sourceSetId: SYNTHETIC_SOURCE_SET_ID,
      resourceId: descriptorHairBack?.runtime.resourceId,
      encodedSha256: descriptorHairBack?.runtime.encodedSha256,
    });
  });

  it("documents that core trusts a host echo when no complete ledger is supplied", () => {
    const alteredHash = "6".repeat(64);
    const resolver = createSyntheticResolver({
      transform(result) {
        return result.ok
          ? {
              ...result,
              resource: { ...result.resource, encodedSha256: alteredHash },
            }
          : result;
      },
    });
    const result = buildScene({
      draft: createSyntheticDraft(),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver,
    });

    // The M3 core has no full source-set ledger. A production host must verify
    // descriptor facts before returning them; matching sourceSetId echoes alone
    // cannot prove that an encoded hash belongs to that set.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.nodes[0]?.resource).toMatchObject({
      sourceSetId: SYNTHETIC_SOURCE_SET_ID,
      encodedSha256: alteredHash,
    });
  });

  it("builds a full-frame Muse scene without resolving unselected slots", () => {
    const resolver = createSyntheticResolver();
    const result = buildScene({
      draft: createSyntheticDraft(),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.nodes.map((node) => node.role)).toEqual(["muse-body"]);
    expect(result.scene.nodes[0]?.key).toBe(
      "muse:muse-synthetic-001@1.0.0:muse-synthetic-body:muse-body",
    );
    expect(resolver.requests).toHaveLength(1);
  });

  it("uses active garment mode only and resolves sorted candidates", () => {
    const resolver = createSyntheticResolver();
    const draft = createSyntheticDraft({
      garmentMode: "dress",
      selections: {
        hair: SYNTHETIC_REFERENCES.hair,
        top: SYNTHETIC_REFERENCES.top,
        bottom: SYNTHETIC_REFERENCES.bottom,
        dress: SYNTHETIC_REFERENCES.dress,
      },
    });
    const result = buildScene({
      draft,
      catalog: syntheticCatalog,
      target: "runtime",
      resolver,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.nodes.map((node) => node.role)).toEqual([
      "hair-back",
      "muse-body",
      "dress",
      "hair-front",
    ]);
    expect(resolver.requests.map((request) => request.role)).toEqual([
      "hair-back",
      "muse-body",
      "dress",
      "hair-front",
    ]);
    expect(resolver.requests.some((request) => request.role === "top")).toBe(false);
    expect(resolver.requests.some((request) => request.role === "bottom")).toBe(false);
  });

  it("covers all canonical roles in maximum separates and dress scenes", () => {
    const separates = buildScene({
      draft: createSyntheticDraft({
        selections: {
          ...SYNTHETIC_SHARED_SELECTIONS,
          top: SYNTHETIC_REFERENCES.top,
          bottom: SYNTHETIC_REFERENCES.bottom,
          dress: SYNTHETIC_REFERENCES.dress,
        },
      }),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: createSyntheticResolver(),
    });
    const dress = buildScene({
      draft: createSyntheticDraft({
        garmentMode: "dress",
        selections: {
          ...SYNTHETIC_SHARED_SELECTIONS,
          top: SYNTHETIC_REFERENCES.top,
          bottom: SYNTHETIC_REFERENCES.bottom,
          dress: SYNTHETIC_REFERENCES.dress,
        },
      }),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: createSyntheticResolver(),
    });
    expect(separates.ok && dress.ok).toBe(true);
    if (!separates.ok || !dress.ok) return;
    expect(separates.scene.nodes).toHaveLength(12);
    expect(dress.scene.nodes).toHaveLength(11);
    expect(
      new Set([
        ...separates.scene.nodes.map((node) => node.role),
        ...dress.scene.nodes.map((node) => node.role),
      ]),
    ).toEqual(
      new Set([
        "background",
        "hair-back",
        "outerwear-back",
        "accessory-back",
        "muse-body",
        "makeup",
        "shoes",
        "bottom",
        "dress",
        "top",
        "outerwear-front",
        "hair-front",
        "accessory-front",
      ]),
    );
  });

  it("restores exact top and bottom resources after dress mode", () => {
    const selections = {
      top: SYNTHETIC_REFERENCES.topRevision,
      bottom: SYNTHETIC_REFERENCES.bottom,
      dress: SYNTHETIC_REFERENCES.dress,
    };
    const compile = (garmentMode: "separates" | "dress") =>
      buildScene({
        draft: createSyntheticDraft({ garmentMode, selections }),
        catalog: syntheticCatalog,
        target: "runtime",
        resolver: createSyntheticResolver(),
      });
    const before = compile("separates");
    const during = compile("dress");
    const after = compile("separates");
    expect(before.ok && during.ok && after.ok).toBe(true);
    if (!before.ok || !during.ok || !after.ok) return;
    const garments = (nodes: typeof before.scene.nodes) =>
      nodes
        .filter((node) => ["top", "bottom", "dress"].includes(node.role))
        .map((node) => [node.role, node.owner.reference, node.resource.resourceId]);
    expect(garments(during.scene.nodes).map((entry) => entry[0])).toEqual(["dress"]);
    expect(garments(after.scene.nodes)).toEqual(garments(before.scene.nodes));
  });

  it("uses exact runtime and export representations and dimensions", () => {
    const runtime = buildScene({
      draft: createSyntheticDraft(),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: createSyntheticResolver(),
    });
    const exported = buildScene({
      draft: createSyntheticDraft(),
      catalog: syntheticCatalog,
      target: "export",
      resolver: createSyntheticResolver(),
    });
    expect(runtime.ok && exported.ok).toBe(true);
    if (!runtime.ok || !exported.ok) return;
    expect(runtime.scene.frame).toEqual({ width: 1024, height: 1536, origin: "top-left" });
    expect(runtime.scene.nodes[0]?.resource.representation).toBe("runtime");
    expect(exported.scene.frame).toEqual({ width: 2048, height: 3072, origin: "top-left" });
    expect(exported.scene.nodes[0]?.resource.representation).toBe("master");
  });

  it("gives generated-catalog confusion precedence without leaking details", () => {
    const result = buildScene({
      draft: { invalid: true },
      catalog: {
        schemaVersion: "1.0.0",
        releaseId: "private-path-value",
        releasePath: "private-path-value",
        generator: {},
        sourceReport: {},
        assets: [],
      },
      target: "runtime",
      resolver: createSyntheticResolver(),
    } as never);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SCENE_GENERATED_CATALOG_FORBIDDEN" }],
    });
    expect(JSON.stringify(result)).not.toContain("private-path-value");

    const direct = buildScene({
      schemaVersion: "1.0.0",
      releaseId: "private-path-value",
      releasePath: "private-path-value",
      generator: {},
      sourceReport: {},
      assets: [],
    } as never);
    expect(direct).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SCENE_GENERATED_CATALOG_FORBIDDEN" }],
    });
  });

  it("rejects an invalid resolver source-set before resolving or throwing", () => {
    let called = false;
    const result = buildScene({
      draft: createSyntheticDraft(),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: {
        sourceSetId: "not-a-sha",
        resolve() {
          called = true;
          throw new Error("must not escape");
        },
      },
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SCENE_INPUT_INVALID" }],
    });
    expect(called).toBe(false);
  });

  it("normalizes a throwing source-set getter without resolving or leaking", () => {
    let getterCalls = 0;
    let resolverCalls = 0;
    const result = buildScene({
      draft: createSyntheticDraft(),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: {
        get sourceSetId(): string {
          getterCalls += 1;
          throw new Error("C:/private/source-set-secret");
        },
        resolve() {
          resolverCalls += 1;
          throw new Error("must not resolve");
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SCENE_INPUT_INVALID" }],
    });
    expect(getterCalls).toBe(1);
    expect(resolverCalls).toBe(0);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("snapshots a stateful source-set getter once and supports a prototype resolver", () => {
    const values = [
      SYNTHETIC_SOURCE_SET_ID,
      "not-a-sha",
    ];
    let getterCalls = 0;
    let resolverCalls = 0;
    const base = createSyntheticResolver();
    class StatefulResolver {
      get sourceSetId(): string {
        const value = values[getterCalls] ?? "not-a-sha";
        getterCalls += 1;
        return value;
      }

      resolve(request: Parameters<typeof base.resolve>[0]) {
        resolverCalls += 1;
        return base.resolve(request);
      }
    }
    const result = buildScene({
      draft: createSyntheticDraft(),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: new StatefulResolver(),
    });

    expect(result.ok).toBe(true);
    expect(getterCalls).toBe(1);
    expect(resolverCalls).toBe(1);
    if (!result.ok) return;
    expect(result.scene.sourceSetId).toBe(SYNTHETIC_SOURCE_SET_ID);
    expect(result.scene.nodes[0]?.resource.sourceSetId).toBe(
      SYNTHETIC_SOURCE_SET_ID,
    );
  });

  it("rejects malformed Domain catalog input with its dedicated code", () => {
    expectFailureCode(
      buildScene({
        draft: createSyntheticDraft(),
        catalog: { muses: [], assets: [], unknown: true },
        target: "runtime",
        resolver: createSyntheticResolver(),
      }),
      "SCENE_DOMAIN_CATALOG_INVALID",
    );
  });

  it("distinguishes unavailable exact versions before compatibility", () => {
    const result = buildScene({
      draft: createSyntheticDraft({
        selections: {
          top: { id: SYNTHETIC_REFERENCES.top.id, version: "9.0.0" },
        },
      }),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: createSyntheticResolver(),
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SCENE_ASSET_VERSION_UNAVAILABLE" }],
    });
  });

  it("distinguishes missing Muse and Asset IDs from unavailable versions", () => {
    const cases = [
      [
        createSyntheticDraft({ muse: { id: "muse-absent-001", version: "1.0.0" } }),
        "SCENE_MUSE_NOT_FOUND",
      ],
      [
        createSyntheticDraft({ muse: { id: SYNTHETIC_REFERENCES.muse.id, version: "9.0.0" } }),
        "SCENE_MUSE_VERSION_UNAVAILABLE",
      ],
      [
        createSyntheticDraft({ selections: { top: { id: "top-absent-001", version: "1.0.0" } } }),
        "SCENE_ASSET_NOT_FOUND",
      ],
      [
        createSyntheticDraft({ selections: { top: { id: SYNTHETIC_REFERENCES.top.id, version: "9.0.0" } } }),
        "SCENE_ASSET_VERSION_UNAVAILABLE",
      ],
    ] as const;
    for (const [draft, code] of cases) {
      expectFailureCode(
        buildScene({
          draft,
          catalog: syntheticCatalog,
          target: "runtime",
          resolver: createSyntheticResolver(),
        }),
        code,
      );
    }
  });

  it("returns ordered Domain compatibility warnings as structured causes", () => {
    const incompatibleTop = AssetSchema.parse({
      ...syntheticAssets[1],
      frame: MASTER_FRAME,
      compatibility: {
        ...syntheticAssets[1].compatibility,
        compatibleMuses: [{ id: "muse-other-001", version: "1.0.0" }],
      },
    });
    const catalog = CatalogSchema.parse({
      muses: [syntheticMuse],
      assets: syntheticAssets.map((asset, index) =>
        index === 1 ? incompatibleTop : asset,
      ),
    });
    const result = buildScene({
      draft: createSyntheticDraft({ selections: { top: SYNTHETIC_REFERENCES.top } }),
      catalog,
      target: "runtime",
      resolver: createSyntheticResolver(),
    });
    expectFailureCode(result, "SCENE_INCOMPATIBLE_LOOK");
    if (result.ok) return;
    expect(result.diagnostics[0]?.causes).toMatchObject([
      { kind: "domain-compatibility", warning: { code: "MUSE_INCOMPATIBLE" } },
    ]);
  });

  it("rejects an active slot mismatch before resolving resources", () => {
    const resolver = createSyntheticResolver();
    const result = buildScene({
      draft: createSyntheticDraft({
        selections: { top: SYNTHETIC_REFERENCES.bottom },
      }),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver,
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SCENE_ACTIVE_SLOT_MISMATCH" }],
    });
    expect(resolver.requests).toEqual([]);
  });

  it("does not fall back between two exact asset versions", () => {
    const first = buildScene({
      draft: createSyntheticDraft({
        selections: { top: SYNTHETIC_REFERENCES.top },
      }),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: createSyntheticResolver(),
    });
    const second = buildScene({
      draft: createSyntheticDraft({
        selections: { top: SYNTHETIC_REFERENCES.topRevision },
      }),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: createSyntheticResolver(),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.scene.nodes.find((node) => node.role === "top")?.resource.resourceId)
      .not.toBe(second.scene.nodes.find((node) => node.role === "top")?.resource.resourceId);
  });

  it("rejects resolver echo mismatches without returning a partial scene", () => {
    const resolver = createSyntheticResolver({
      transform(result, request) {
        return request.role === "top" && result.ok
          ? {
              ...result,
              resource: { ...result.resource, sourceSetId: "b".repeat(64) },
            }
          : result;
      },
    });
    const result = buildScene({
      draft: createSyntheticDraft({
        selections: { top: SYNTHETIC_REFERENCES.top },
      }),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver,
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SCENE_RESOURCE_SET_MISMATCH" }],
    });
    expect("scene" in result).toBe(false);
  });

  it("normalizes unavailable, thrown, and malformed resolver failures", () => {
    const resolvers = [
      {
        sourceSetId: SYNTHETIC_SOURCE_SET_ID,
        resolve: () => ({ ok: false, reason: "unavailable" } as const),
        code: "SCENE_RESOURCE_UNAVAILABLE",
      },
      {
        sourceSetId: SYNTHETIC_SOURCE_SET_ID,
        resolve: () => {
          throw new Error("C:/private/native-path.png");
        },
        code: "SCENE_RESOURCE_UNAVAILABLE",
      },
      {
        sourceSetId: SYNTHETIC_SOURCE_SET_ID,
        resolve: () => ({ ok: true, resource: { path: "C:/private" } } as never),
        code: "SCENE_RESOURCE_INVALID",
      },
    ];
    for (const resolver of resolvers) {
      const result = buildScene({
        draft: createSyntheticDraft(),
        catalog: syntheticCatalog,
        target: "runtime",
        resolver,
      });
      expectFailureCode(result, resolver.code);
      expect(JSON.stringify(result)).not.toContain("private");
    }
  });

  it("classifies every resolver echo mismatch independently", () => {
    const mutations = [
      ["SCENE_RESOURCE_SET_MISMATCH", { sourceSetId: "b".repeat(64) }],
      [
        "SCENE_RESOURCE_IDENTITY_MISMATCH",
        {
          owner: {
            kind: "muse",
            reference: { id: "muse-other-001", version: "1.0.0" },
          },
        },
      ],
      ["SCENE_RESOURCE_REPRESENTATION_MISMATCH", { representation: "master" }],
      ["SCENE_RESOURCE_DIMENSION_MISMATCH", { width: 2048 }],
    ] as const;
    for (const [code, mutation] of mutations) {
      const resolver = createSyntheticResolver({
        transform(result) {
          return result.ok
            ? { ...result, resource: { ...result.resource, ...mutation } }
            : result;
        },
      });
      expectFailureCode(
        buildScene({
          draft: createSyntheticDraft(),
          catalog: syntheticCatalog,
          target: "runtime",
          resolver,
        }),
        code,
      );
    }
  });

  it("never requests retained inactive selections in either garment mode", () => {
    const selections = {
      top: SYNTHETIC_REFERENCES.top,
      bottom: SYNTHETIC_REFERENCES.bottom,
      dress: SYNTHETIC_REFERENCES.dress,
    };
    const separatesResolver = createSyntheticResolver();
    const dressResolver = createSyntheticResolver();
    buildScene({
      draft: createSyntheticDraft({ selections }),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: separatesResolver,
    });
    buildScene({
      draft: createSyntheticDraft({ garmentMode: "dress", selections }),
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: dressResolver,
    });
    expect(separatesResolver.requests.map((request) => request.role)).not.toContain("dress");
    expect(dressResolver.requests.map((request) => request.role)).not.toContain("top");
    expect(dressResolver.requests.map((request) => request.role)).not.toContain("bottom");
  });

  it("does not mutate input, catalog, or resolver result objects", () => {
    const draft = createSyntheticDraft({ selections: { top: SYNTHETIC_REFERENCES.top } });
    const beforeDraft = JSON.stringify(draft);
    const beforeCatalog = JSON.stringify(syntheticCatalog);
    let returnedResource: Record<string, unknown> | undefined;
    const base = createSyntheticResolver();
    const resolver = {
      sourceSetId: base.sourceSetId,
      resolve(request: Parameters<typeof base.resolve>[0]) {
        const result = base.resolve(request);
        if (result.ok) returnedResource = result.resource as Record<string, unknown>;
        return result;
      },
    };
    const result = buildScene({ draft, catalog: syntheticCatalog, target: "runtime", resolver });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(draft)).toBe(beforeDraft);
    expect(JSON.stringify(syntheticCatalog)).toBe(beforeCatalog);
    expect(returnedResource).toBeDefined();
    expect(Object.isFrozen(returnedResource)).toBe(false);
  });

  it("is independent of catalog and part insertion order", () => {
    const reversedHair = {
      ...syntheticAssets[0],
      parts: [...syntheticAssets[0].parts].reverse(),
    };
    const permutedCatalog = {
      muses: [syntheticMuse],
      assets: [
        ...syntheticAssets.slice(1).reverse(),
        reversedHair,
      ],
    };
    const draft = createSyntheticDraft({
      selections: { hair: SYNTHETIC_REFERENCES.hair },
    });
    const first = buildScene({
      draft,
      catalog: syntheticCatalog,
      target: "export",
      resolver: createSyntheticResolver(),
    });
    const second = buildScene({
      draft,
      catalog: permutedCatalog,
      target: "export",
      resolver: createSyntheticResolver(),
    });
    expect(second).toEqual(first);
  });

  it("keeps lookup diagnostics deterministic across catalog permutations", () => {
    const draft = createSyntheticDraft({
      selections: {
        top: { id: "top-absent-001", version: "1.0.0" },
        bottom: { id: "bottom-absent-001", version: "1.0.0" },
      },
    });
    const first = buildScene({
      draft,
      catalog: syntheticCatalog,
      target: "runtime",
      resolver: createSyntheticResolver(),
    });
    const second = buildScene({
      draft,
      catalog: { muses: [syntheticMuse], assets: [...syntheticAssets].reverse() },
      target: "runtime",
      resolver: createSyntheticResolver(),
    });
    expect(second).toEqual(first);
    if (first.ok) return;
    expect(first.diagnostics.map((diagnostic) => diagnostic.subject)).toEqual([
      "asset:bottom:bottom-absent-001@1.0.0",
      "asset:top:top-absent-001@1.0.0",
    ]);
  });
});
