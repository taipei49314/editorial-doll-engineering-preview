import { z } from "zod";

import { AssetSlotSchema, type Asset, type AssetSlot } from "./assets.js";
import {
  findAsset,
  findMuse,
  hasAssetId,
  type Catalog,
} from "./catalog.js";
import {
  AssetReferenceSchema,
  referenceKey,
  sameReference,
  type AssetReference,
} from "./identity.js";
import type { LookDraft } from "./looks.js";

export const CompatibilityWarningCodeSchema = z.enum([
  "ASSET_NOT_FOUND",
  "ASSET_VERSION_UNAVAILABLE",
  "MUSE_NOT_FOUND",
  "MUSE_INCOMPATIBLE",
  "REQUIRES_ACTIVE_TAG",
  "EXCLUDED_ACTIVE_TAG",
  "ASSET_CONFLICT",
  "DRESS_REQUIRED",
]);

export const CompatibilityWarningSchema = z
  .object({
    code: CompatibilityWarningCodeSchema,
    severity: z.enum(["warning", "error"]),
    subject: AssetReferenceSchema.optional(),
    relatedAssets: z.array(AssetReferenceSchema).readonly(),
    message: z.string().min(1),
  })
  .strict()
  .readonly();

export const CompatibilityResultSchema = z
  .object({
    allowed: z.boolean(),
    warnings: z.array(CompatibilityWarningSchema).readonly(),
  })
  .strict()
  .readonly();

export type CompatibilityWarningCode = z.infer<
  typeof CompatibilityWarningCodeSchema
>;
export type CompatibilityWarning = z.infer<
  typeof CompatibilityWarningSchema
>;
export type CompatibilityResult = z.infer<typeof CompatibilityResultSchema>;

export const ALL_SELECTION_SLOTS = Object.freeze([
  "background",
  "hair",
  "makeup",
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "accessory",
] as const satisfies readonly AssetSlot[]);

const SHARED_ACTIVE_SLOTS = Object.freeze([
  "background",
  "hair",
  "makeup",
] as const satisfies readonly AssetSlot[]);

const TRAILING_ACTIVE_SLOTS = Object.freeze([
  "outerwear",
  "shoes",
  "accessory",
] as const satisfies readonly AssetSlot[]);

export const activeSlots = (draft: LookDraft): readonly AssetSlot[] =>
  draft.garmentMode === "dress"
    ? [...SHARED_ACTIVE_SLOTS, "dress", ...TRAILING_ACTIVE_SLOTS]
    : [...SHARED_ACTIVE_SLOTS, "top", "bottom", ...TRAILING_ACTIVE_SLOTS];

export const activeAssetReferences = (
  draft: LookDraft,
): readonly AssetReference[] =>
  activeSlots(draft).flatMap((slot) => {
    const reference = draft.selections[slot];
    return reference === undefined ? [] : [reference];
  });

const assetLookupWarning = (
  catalog: Catalog,
  reference: AssetReference,
): CompatibilityWarning =>
  hasAssetId(catalog, reference.id)
    ? {
        code: "ASSET_VERSION_UNAVAILABLE",
        severity: "error",
        subject: reference,
        relatedAssets: [reference],
        message: `Asset version ${reference.id}@${reference.version} is unavailable.`,
      }
    : {
        code: "ASSET_NOT_FOUND",
        severity: "error",
        subject: reference,
        relatedAssets: [reference],
        message: `Asset ${reference.id}@${reference.version} was not found.`,
      };

const resolveReferences = (
  references: readonly AssetReference[],
  catalog: Catalog,
): {
  readonly assets: readonly Asset[];
  readonly warnings: readonly CompatibilityWarning[];
} => {
  const assets: Asset[] = [];
  const warnings: CompatibilityWarning[] = [];

  for (const reference of references) {
    const asset = findAsset(catalog, reference);
    if (asset === undefined) {
      warnings.push(assetLookupWarning(catalog, reference));
    } else {
      assets.push(asset);
    }
  }

  return { assets, warnings };
};

const referenceFor = (asset: Asset): AssetReference => ({
  id: asset.id,
  version: asset.version,
});

const compatibilityWarningsForAssets = (
  draft: LookDraft,
  assets: readonly Asset[],
  catalog: Catalog,
): readonly CompatibilityWarning[] => {
  const warnings: CompatibilityWarning[] = [];
  const muse = findMuse(catalog, draft.muse);

  if (muse === undefined) {
    warnings.push({
      code: "MUSE_NOT_FOUND",
      severity: "error",
      subject: draft.muse,
      relatedAssets: [],
      message: `Muse ${draft.muse.id}@${draft.muse.version} was not found.`,
    });
    return warnings;
  }

  for (const asset of assets) {
    if (
      !asset.compatibility.compatibleMuses.some((reference) =>
        sameReference(reference, muse),
      )
    ) {
      const assetReference = referenceFor(asset);
      warnings.push({
        code: "MUSE_INCOMPATIBLE",
        severity: "error",
        subject: assetReference,
        relatedAssets: [assetReference],
        message: `Asset ${asset.id}@${asset.version} is incompatible with Muse ${muse.id}@${muse.version}.`,
      });
    }
  }

  const activeTags = new Set(assets.flatMap((asset) => asset.tags));
  for (const asset of assets) {
    for (const tag of [...asset.compatibility.requiresActiveTags].sort()) {
      if (!activeTags.has(tag)) {
        warnings.push({
          code: "REQUIRES_ACTIVE_TAG",
          severity: "error",
          subject: referenceFor(asset),
          relatedAssets: [referenceFor(asset)],
          message: `Asset ${asset.id}@${asset.version} requires active tag ${tag}.`,
        });
      }
    }

    for (const tag of [...asset.compatibility.excludesActiveTags].sort()) {
      if (activeTags.has(tag)) {
        warnings.push({
          code: "EXCLUDED_ACTIVE_TAG",
          severity: "error",
          subject: referenceFor(asset),
          relatedAssets: [referenceFor(asset)],
          message: `Asset ${asset.id}@${asset.version} excludes active tag ${tag}.`,
        });
      }
    }
  }

  for (let leftIndex = 0; leftIndex < assets.length; leftIndex += 1) {
    const left = assets[leftIndex];
    if (left === undefined) {
      continue;
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < assets.length;
      rightIndex += 1
    ) {
      const right = assets[rightIndex];
      if (right === undefined) {
        continue;
      }

      const leftReference = referenceFor(left);
      const rightReference = referenceFor(right);
      const isConflict =
        left.compatibility.incompatibleAssets.some((reference) =>
          sameReference(reference, rightReference),
        ) ||
        right.compatibility.incompatibleAssets.some((reference) =>
          sameReference(reference, leftReference),
        );
      if (isConflict) {
        const relatedAssets = [leftReference, rightReference].sort((a, b) => {
          const leftKey = referenceKey(a);
          const rightKey = referenceKey(b);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        });
        warnings.push({
          code: "ASSET_CONFLICT",
          severity: "error",
          subject: leftReference,
          relatedAssets,
          message: `Assets ${referenceKey(relatedAssets[0] ?? leftReference)} and ${referenceKey(relatedAssets[1] ?? rightReference)} are incompatible.`,
        });
      }
    }
  }

  return warnings;
};

export const evaluateLookCompatibility = (
  draft: LookDraft,
  catalog: Catalog,
): CompatibilityResult => {
  const resolved = resolveReferences(activeAssetReferences(draft), catalog);
  const warnings = [
    ...resolved.warnings,
    ...compatibilityWarningsForAssets(draft, resolved.assets, catalog),
  ];

  return {
    allowed: warnings.length === 0,
    warnings,
  };
};

export const evaluateMuseSelection = (
  draft: LookDraft,
  museReference: AssetReference,
  catalog: Catalog,
): CompatibilityResult => {
  const muse = findMuse(catalog, museReference);
  if (muse === undefined) {
    return {
      allowed: false,
      warnings: [
        {
          code: "MUSE_NOT_FOUND",
          severity: "error",
          subject: museReference,
          relatedAssets: [],
          message: `Muse ${museReference.id}@${museReference.version} was not found.`,
        },
      ],
    };
  }

  const references = ALL_SELECTION_SLOTS.flatMap((slot) => {
    const reference = draft.selections[slot];
    return reference === undefined ? [] : [reference];
  });
  const resolved = resolveReferences(references, catalog);
  const warnings = [...resolved.warnings];

  for (const asset of resolved.assets) {
    if (
      !asset.compatibility.compatibleMuses.some((reference) =>
        sameReference(reference, muse),
      )
    ) {
      const assetReference = referenceFor(asset);
      warnings.push({
        code: "MUSE_INCOMPATIBLE",
        severity: "error",
        subject: assetReference,
        relatedAssets: [assetReference],
        message: `Asset ${asset.id}@${asset.version} is incompatible with Muse ${muse.id}@${muse.version}.`,
      });
    }
  }

  return {
    allowed: warnings.length === 0,
    warnings,
  };
};

export const parseAssetSlot = (value: unknown): AssetSlot =>
  AssetSlotSchema.parse(value);
