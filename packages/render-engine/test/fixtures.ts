import {
  AssetSchema,
  CatalogSchema,
  LookDraftSchema,
  MASTER_FRAME,
  MuseSchema,
  type Asset,
  type AssetPart,
  type Catalog,
  type LookDraft,
} from "@editorial-doll/domain";
import { createHash } from "node:crypto";

import { TARGET_CONTRACT } from "../src/core/constants.js";
import type {
  RenderResourceRequest,
  RenderResourceResolver,
  SceneResourceResult,
} from "../src/core/resources.js";

export type SyntheticSourceSetContract = Readonly<{
  schemaVersion: "1.0.0";
  assetReleaseId: string;
  sourceReportSha256: string;
  muse: Readonly<{
    id: string;
    version: string;
    resourceSetId: string;
    runtimeSha256: string;
    masterSha256: string;
  }>;
}>;

export const canonicalizeSyntheticSourceSetContract = (
  value: SyntheticSourceSetContract,
): string =>
  `${JSON.stringify(
    {
      schemaVersion: value.schemaVersion,
      assetReleaseId: value.assetReleaseId,
      sourceReportSha256: value.sourceReportSha256,
      muse: {
        id: value.muse.id,
        version: value.muse.version,
        resourceSetId: value.muse.resourceSetId,
        runtimeSha256: value.muse.runtimeSha256,
        masterSha256: value.muse.masterSha256,
      },
    },
    undefined,
    2,
  )}\n`;

export const hashSyntheticSourceSetContract = (
  value: SyntheticSourceSetContract,
): string =>
  createHash("sha256")
    .update(canonicalizeSyntheticSourceSetContract(value))
    .digest("hex");

// This is a test vector for a future host contract, not an approved Muse or
// production resource declaration. Every hash inside this envelope is an
// obvious fake value; this vector fixes serialization only.
export const SYNTHETIC_FUTURE_SOURCE_SET_CONTRACT = Object.freeze({
  schemaVersion: "1.0.0",
  assetReleaseId: "b".repeat(64),
  sourceReportSha256: "c".repeat(64),
  muse: Object.freeze({
    id: "muse-synthetic-future-contract-001",
    version: "1.0.0",
    resourceSetId: "d".repeat(64),
    runtimeSha256: "e".repeat(64),
    masterSha256: "f".repeat(64),
  }),
});

export const SYNTHETIC_FUTURE_SOURCE_SET_CANONICAL =
  canonicalizeSyntheticSourceSetContract(
    SYNTHETIC_FUTURE_SOURCE_SET_CONTRACT,
  );

export const SYNTHETIC_FUTURE_SOURCE_SET_SHA256 =
  "c9c67f01a21590e740285d3466548f17f31c95d48d18b1272f4e774465898db2";

export const SYNTHETIC_FUTURE_ALTERNATE_SOURCE_SET_SHA256 =
  "5b8dc52b16da2aeb834e9e2e2460a4892d4ae18ccebc5122d4543445e917a919";

export const SYNTHETIC_REFERENCES = Object.freeze({
  muse: { id: "muse-synthetic-001", version: "1.0.0" },
  background: { id: "background-synthetic-001", version: "1.0.0" },
  hair: { id: "hair-synthetic-001", version: "1.0.0" },
  makeup: { id: "makeup-synthetic-001", version: "1.0.0" },
  top: { id: "top-synthetic-001", version: "1.0.0" },
  topRevision: { id: "top-synthetic-001", version: "1.1.0" },
  bottom: { id: "bottom-synthetic-001", version: "1.0.0" },
  dress: { id: "dress-synthetic-001", version: "1.0.0" },
  outerwear: { id: "outerwear-synthetic-001", version: "1.0.0" },
  shoes: { id: "shoes-synthetic-001", version: "1.0.0" },
  accessory: { id: "accessory-synthetic-001", version: "1.0.0" },
} as const);

const part = (
  id: string,
  role: AssetPart["role"],
): AssetPart => ({ id, role, sourcePath: `${role}.png` });

const makeAsset = (input: Omit<Asset, "frame" | "compatibility">): Asset =>
  AssetSchema.parse({
    ...input,
    frame: MASTER_FRAME,
    compatibility: {
      compatibleMuses: [SYNTHETIC_REFERENCES.muse],
      requiresActiveTags: [],
      excludesActiveTags: [],
      incompatibleAssets: [],
    },
  });

export const syntheticMuse = MuseSchema.parse({
  ...SYNTHETIC_REFERENCES.muse,
  displayName: "Synthetic Test Muse",
  frame: MASTER_FRAME,
  bodyPart: part("muse-synthetic-body", "muse-body"),
});

export const syntheticAssets = Object.freeze([
  makeAsset({
    ...SYNTHETIC_REFERENCES.hair,
    slot: "hair",
    displayName: "Synthetic Split Hair",
    tags: ["synthetic-hair"],
    parts: [
      part("hair-synthetic-back", "hair-back"),
      part("hair-synthetic-front", "hair-front"),
    ],
  }),
  makeAsset({
    ...SYNTHETIC_REFERENCES.top,
    slot: "top",
    displayName: "Synthetic Top",
    tags: ["synthetic-top"],
    parts: [part("top-synthetic-main", "top")],
  }),
  makeAsset({
    ...SYNTHETIC_REFERENCES.topRevision,
    slot: "top",
    displayName: "Synthetic Top Revision",
    tags: ["synthetic-top"],
    parts: [part("top-synthetic-main", "top")],
  }),
  makeAsset({
    ...SYNTHETIC_REFERENCES.bottom,
    slot: "bottom",
    displayName: "Synthetic Bottom",
    tags: ["synthetic-bottom"],
    parts: [part("bottom-synthetic-main", "bottom")],
  }),
  makeAsset({
    ...SYNTHETIC_REFERENCES.dress,
    slot: "dress",
    displayName: "Synthetic Dress",
    tags: ["synthetic-dress"],
    parts: [part("dress-synthetic-main", "dress")],
  }),
  makeAsset({
    ...SYNTHETIC_REFERENCES.background,
    slot: "background",
    displayName: "Synthetic Background",
    tags: ["synthetic-background"],
    parts: [part("background-synthetic-main", "background")],
  }),
  makeAsset({
    ...SYNTHETIC_REFERENCES.makeup,
    slot: "makeup",
    displayName: "Synthetic Makeup",
    tags: ["synthetic-makeup"],
    parts: [part("makeup-synthetic-main", "makeup")],
  }),
  makeAsset({
    ...SYNTHETIC_REFERENCES.outerwear,
    slot: "outerwear",
    displayName: "Synthetic Split Outerwear",
    tags: ["synthetic-outerwear"],
    parts: [
      part("outerwear-synthetic-back", "outerwear-back"),
      part("outerwear-synthetic-front", "outerwear-front"),
    ],
  }),
  makeAsset({
    ...SYNTHETIC_REFERENCES.shoes,
    slot: "shoes",
    displayName: "Synthetic Shoes",
    tags: ["synthetic-shoes"],
    parts: [part("shoes-synthetic-main", "shoes")],
  }),
  makeAsset({
    ...SYNTHETIC_REFERENCES.accessory,
    slot: "accessory",
    displayName: "Synthetic Split Accessory",
    tags: ["synthetic-accessory"],
    parts: [
      part("accessory-synthetic-back", "accessory-back"),
      part("accessory-synthetic-front", "accessory-front"),
    ],
  }),
] as const);

type SyntheticResourceFacts = Readonly<{
  resourceId: string;
  encodedSha256: string;
  encodedBytes: number;
  encodedBitDepth: 8;
  width: number;
  height: number;
}>;

type SyntheticPartDescriptor = Readonly<{
  id: string;
  role: AssetPart["role"];
  runtime: SyntheticResourceFacts;
  master: SyntheticResourceFacts;
}>;

export type SyntheticSourceSetDescriptor = Readonly<{
  schemaVersion: "1.0.0";
  muse: Readonly<{
    id: string;
    version: string;
    bodyPart: SyntheticPartDescriptor;
  }>;
  assets: readonly Readonly<{
    id: string;
    version: string;
    slot: Asset["slot"];
    parts: readonly SyntheticPartDescriptor[];
  }>[];
}>;

const resourceCharacterFor = (
  version: string,
  role: AssetPart["role"],
): string => {
  if (version === "1.1.0") {
    return "b";
  }
  const characters: Readonly<Record<string, string>> = {
    "hair-back": "c",
    "hair-front": "d",
    "muse-body": "e",
    top: "f",
    bottom: "1",
    dress: "2",
    background: "3",
    makeup: "5",
    "outerwear-back": "6",
    "outerwear-front": "7",
    shoes: "8",
    "accessory-back": "9",
    "accessory-front": "0",
  };
  return characters[role] ?? "a";
};

const resourceFacts = (
  version: string,
  role: AssetPart["role"],
  target: "runtime" | "export",
): SyntheticResourceFacts => {
  const contract = TARGET_CONTRACT[target];
  return Object.freeze({
    resourceId: resourceCharacterFor(version, role).repeat(64),
    encodedSha256: "4".repeat(64),
    encodedBytes: 1024,
    encodedBitDepth: 8,
    width: contract.width,
    height: contract.height,
  });
};

const partDescriptor = (
  version: string,
  assetPart: AssetPart,
): SyntheticPartDescriptor =>
  Object.freeze({
    id: assetPart.id,
    role: assetPart.role,
    runtime: resourceFacts(version, assetPart.role, "runtime"),
    master: resourceFacts(version, assetPart.role, "export"),
  });

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const orderedPartDescriptor = (
  value: SyntheticPartDescriptor,
): SyntheticPartDescriptor => ({
  id: value.id,
  role: value.role,
  runtime: {
    resourceId: value.runtime.resourceId,
    encodedSha256: value.runtime.encodedSha256,
    encodedBytes: value.runtime.encodedBytes,
    encodedBitDepth: value.runtime.encodedBitDepth,
    width: value.runtime.width,
    height: value.runtime.height,
  },
  master: {
    resourceId: value.master.resourceId,
    encodedSha256: value.master.encodedSha256,
    encodedBytes: value.master.encodedBytes,
    encodedBitDepth: value.master.encodedBitDepth,
    width: value.master.width,
    height: value.master.height,
  },
});

const orderedSyntheticSourceSetDescriptor = (
  value: SyntheticSourceSetDescriptor,
): SyntheticSourceSetDescriptor => {
  const ordered: SyntheticSourceSetDescriptor = {
    schemaVersion: value.schemaVersion,
    muse: {
      id: value.muse.id,
      version: value.muse.version,
      bodyPart: orderedPartDescriptor(value.muse.bodyPart),
    },
    assets: [...value.assets]
      .sort((left, right) =>
        compareAscii(
          `${left.id}@${left.version}`,
          `${right.id}@${right.version}`,
        ),
      )
      .map((asset) => ({
        id: asset.id,
        version: asset.version,
        slot: asset.slot,
        parts: [...asset.parts]
          .sort((left, right) =>
            compareAscii(
              `${left.role}:${left.id}`,
              `${right.role}:${right.id}`,
            ),
          )
          .map(orderedPartDescriptor),
      })),
  };
  return ordered;
};

const hashCanonicalSyntheticValue = (value: unknown): string =>
  createHash("sha256")
    .update(`${JSON.stringify(value, undefined, 2)}\n`)
    .digest("hex");

/**
 * Derives the test-only host envelope using the same fixed shape as the future
 * production contract. Each opaque component hash is domain-separated and is
 * derived from the complete canonically ordered descriptor it represents.
 */
export const deriveSyntheticSourceSetContract = (
  value: SyntheticSourceSetDescriptor,
): SyntheticSourceSetContract => {
  const ordered = orderedSyntheticSourceSetDescriptor(value);
  const assetReleaseDescriptor = {
    schemaVersion: ordered.schemaVersion,
    kind: "synthetic-asset-release",
    assets: ordered.assets,
  };
  const sourceReportDescriptor = {
    schemaVersion: ordered.schemaVersion,
    kind: "synthetic-source-report",
    assets: ordered.assets,
  };
  const museResourceSetDescriptor = {
    schemaVersion: ordered.schemaVersion,
    kind: "synthetic-muse-resource-set",
    muse: ordered.muse,
  };

  return Object.freeze({
    schemaVersion: ordered.schemaVersion,
    assetReleaseId: hashCanonicalSyntheticValue(assetReleaseDescriptor),
    sourceReportSha256: hashCanonicalSyntheticValue(sourceReportDescriptor),
    muse: Object.freeze({
      id: ordered.muse.id,
      version: ordered.muse.version,
      resourceSetId: hashCanonicalSyntheticValue(museResourceSetDescriptor),
      runtimeSha256: ordered.muse.bodyPart.runtime.encodedSha256,
      masterSha256: ordered.muse.bodyPart.master.encodedSha256,
    }),
  });
};

export const canonicalizeSyntheticSourceSetDescriptor = (
  value: SyntheticSourceSetDescriptor,
): string =>
  canonicalizeSyntheticSourceSetContract(
    deriveSyntheticSourceSetContract(value),
  );

export const hashSyntheticSourceSetDescriptor = (
  value: SyntheticSourceSetDescriptor,
): string =>
  hashSyntheticSourceSetContract(deriveSyntheticSourceSetContract(value));

export const SYNTHETIC_SOURCE_SET_DESCRIPTOR: SyntheticSourceSetDescriptor =
  Object.freeze({
    schemaVersion: "1.0.0",
    muse: Object.freeze({
      id: syntheticMuse.id,
      version: syntheticMuse.version,
      bodyPart: partDescriptor(syntheticMuse.version, syntheticMuse.bodyPart),
    }),
    assets: Object.freeze(
      syntheticAssets.map((asset) =>
        Object.freeze({
          id: asset.id,
          version: asset.version,
          slot: asset.slot,
          parts: Object.freeze(
            asset.parts.map((assetPart) =>
              partDescriptor(asset.version, assetPart),
            ),
          ),
        }),
      ),
    ),
  });

export const SYNTHETIC_SOURCE_SET_CANONICAL =
  canonicalizeSyntheticSourceSetDescriptor(SYNTHETIC_SOURCE_SET_DESCRIPTOR);

export const SYNTHETIC_SOURCE_SET_CONTRACT =
  deriveSyntheticSourceSetContract(SYNTHETIC_SOURCE_SET_DESCRIPTOR);

export const SYNTHETIC_SOURCE_SET_ID = hashSyntheticSourceSetContract(
  SYNTHETIC_SOURCE_SET_CONTRACT,
);

const firstSyntheticAsset = SYNTHETIC_SOURCE_SET_DESCRIPTOR.assets[0];
const firstSyntheticPart = firstSyntheticAsset?.parts[0];
if (firstSyntheticAsset === undefined || firstSyntheticPart === undefined) {
  throw new Error("Synthetic source-set fixture requires at least one asset part.");
}

export const SYNTHETIC_ALTERNATE_SOURCE_SET_DESCRIPTOR: SyntheticSourceSetDescriptor =
  Object.freeze({
    ...SYNTHETIC_SOURCE_SET_DESCRIPTOR,
    assets: Object.freeze([
      Object.freeze({
        ...firstSyntheticAsset,
        parts: Object.freeze([
          Object.freeze({
            ...firstSyntheticPart,
            runtime: Object.freeze({
              ...firstSyntheticPart.runtime,
              encodedSha256: "5".repeat(64),
            }),
          }),
          ...firstSyntheticAsset.parts.slice(1),
        ]),
      }),
      ...SYNTHETIC_SOURCE_SET_DESCRIPTOR.assets.slice(1),
    ]),
  });

export const SYNTHETIC_ALTERNATE_SOURCE_SET_ID =
  hashSyntheticSourceSetDescriptor(SYNTHETIC_ALTERNATE_SOURCE_SET_DESCRIPTOR);

export const SYNTHETIC_SHARED_SELECTIONS = Object.freeze({
  background: SYNTHETIC_REFERENCES.background,
  hair: SYNTHETIC_REFERENCES.hair,
  makeup: SYNTHETIC_REFERENCES.makeup,
  outerwear: SYNTHETIC_REFERENCES.outerwear,
  shoes: SYNTHETIC_REFERENCES.shoes,
  accessory: SYNTHETIC_REFERENCES.accessory,
});

export const syntheticCatalog: Catalog = CatalogSchema.parse({
  muses: [syntheticMuse],
  assets: syntheticAssets,
});

export const createSyntheticDraft = (
  overrides: Partial<LookDraft> = {},
): LookDraft =>
  LookDraftSchema.parse({
    id: "draft-synthetic-001",
    revision: 0,
    muse: SYNTHETIC_REFERENCES.muse,
    garmentMode: "separates",
    selections: {},
    ...overrides,
  });

export interface SyntheticResolver extends RenderResourceResolver {
  readonly requests: RenderResourceRequest[];
}

const factsForRequest = (
  descriptor: SyntheticSourceSetDescriptor,
  request: RenderResourceRequest,
): SyntheticResourceFacts | undefined => {
  let partFacts: SyntheticPartDescriptor | undefined;
  const owner = request.owner;
  if (owner.kind === "muse") {
    if (
      descriptor.muse.id !== owner.reference.id ||
      descriptor.muse.version !== owner.reference.version ||
      descriptor.muse.bodyPart.role !== request.role
    ) {
      return undefined;
    }
    partFacts = descriptor.muse.bodyPart;
  } else {
    const asset = descriptor.assets.find(
      (candidate) =>
        candidate.id === owner.reference.id &&
        candidate.version === owner.reference.version &&
        candidate.slot === owner.slot,
    );
    partFacts = asset?.parts.find((candidate) => candidate.role === request.role);
  }
  if (partFacts === undefined) {
    return undefined;
  }
  return request.representation === "runtime"
    ? partFacts.runtime
    : partFacts.master;
};

export const createSyntheticResolver = (input: {
  readonly sourceSetId?: string;
  readonly descriptor?: SyntheticSourceSetDescriptor;
  readonly transform?: (
    result: SceneResourceResult,
    request: RenderResourceRequest,
  ) => unknown;
} = {}): SyntheticResolver => {
  const descriptor = input.descriptor ?? SYNTHETIC_SOURCE_SET_DESCRIPTOR;
  const descriptorSourceSetId = hashSyntheticSourceSetDescriptor(descriptor);
  const sourceSetId = input.sourceSetId ?? descriptorSourceSetId;
  const requests: RenderResourceRequest[] = [];
  return {
    sourceSetId,
    requests,
    resolve(request): SceneResourceResult {
      requests.push(request);
      const facts = factsForRequest(descriptor, request);
      if (
        sourceSetId !== descriptorSourceSetId ||
        request.sourceSetId !== sourceSetId ||
        facts === undefined
      ) {
        const unavailable = { ok: false, reason: "unavailable" } as const;
        return (input.transform?.(unavailable, request) ??
          unavailable) as SceneResourceResult;
      }
      const result: SceneResourceResult = {
        ok: true,
        resource: {
          sourceSetId,
          resourceId: facts.resourceId,
          owner: request.owner,
          role: request.role,
          representation: request.representation,
          width: facts.width,
          height: facts.height,
          encodedSha256: facts.encodedSha256,
          encodedBytes: facts.encodedBytes,
          encodedBitDepth: facts.encodedBitDepth,
        },
      };
      return (input.transform?.(result, request) ?? result) as SceneResourceResult;
    },
  };
};
