import { z } from "zod";

import { AssetSlotSchema } from "./assets.js";
import {
  evaluateLookCompatibility,
  evaluateMuseSelection,
  CompatibilityWarningSchema,
  type CompatibilityWarning,
} from "./compatibility.js";
import {
  findAsset,
  hasAssetId,
  type Catalog,
} from "./catalog.js";
import {
  AssetReferenceSchema,
  MuseReferenceSchema,
  sameReference,
} from "./identity.js";
import {
  GarmentModeSchema,
  LookDraftSchema,
  type LookDraft,
  type SelectionMap,
} from "./looks.js";

export const LookCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("select-asset"),
      reference: AssetReferenceSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      type: z.literal("clear-slot"),
      slot: AssetSlotSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      type: z.literal("set-garment-mode"),
      mode: GarmentModeSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      type: z.literal("set-muse"),
      reference: MuseReferenceSchema,
    })
    .strict()
    .readonly(),
]);

export const ReducerResultSchema = z
  .object({
    draft: LookDraftSchema,
    changed: z.boolean(),
    warnings: z.array(CompatibilityWarningSchema).readonly(),
  })
  .strict()
  .readonly();

export type LookCommand = z.infer<typeof LookCommandSchema>;
export type ReducerResult = z.infer<typeof ReducerResultSchema>;

export const CONFLICT_POLICY = Object.freeze({
  sameSlot: "replace",
  dressVsSeparates: "suspend-without-delete",
  hardCompatibilityConflict: "reject-candidate",
  missingDressForDressMode: "reject-mode-change",
} as const);

const unchanged = (
  draft: LookDraft,
  warnings: readonly CompatibilityWarning[] = [],
): ReducerResult => ({ draft, changed: false, warnings });

const changed = (
  draft: LookDraft,
  updates: Omit<LookDraft, "revision">,
): ReducerResult => ({
  draft: {
    ...updates,
    revision: draft.revision + 1,
  },
  changed: true,
  warnings: [],
});

const missingAssetWarning = (
  catalog: Catalog,
  reference: z.infer<typeof AssetReferenceSchema>,
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

const reduceSelectAsset = (
  draft: LookDraft,
  command: Extract<LookCommand, { readonly type: "select-asset" }>,
  catalog: Catalog,
): ReducerResult => {
  const asset = findAsset(catalog, command.reference);
  if (asset === undefined) {
    return unchanged(draft, [missingAssetWarning(catalog, command.reference)]);
  }

  const garmentMode =
    asset.slot === "dress"
      ? "dress"
      : asset.slot === "top" || asset.slot === "bottom"
        ? "separates"
        : draft.garmentMode;

  if (
    sameReference(draft.selections[asset.slot], command.reference) &&
    garmentMode === draft.garmentMode
  ) {
    return unchanged(draft);
  }

  const selections: SelectionMap = {
    ...draft.selections,
    [asset.slot]: command.reference,
  };
  const candidate: LookDraft = {
    ...draft,
    garmentMode,
    selections,
  };
  const compatibility = evaluateLookCompatibility(candidate, catalog);

  if (!compatibility.allowed) {
    return unchanged(draft, compatibility.warnings);
  }

  return changed(draft, {
    id: draft.id,
    muse: draft.muse,
    garmentMode,
    selections,
  });
};

const reduceClearSlot = (
  draft: LookDraft,
  command: Extract<LookCommand, { readonly type: "clear-slot" }>,
  catalog: Catalog,
): ReducerResult => {
  const {
    [command.slot]: removedSelection,
    ...selections
  } = draft.selections;
  if (removedSelection === undefined) {
    return unchanged(draft);
  }

  const garmentMode =
    command.slot === "dress" && draft.garmentMode === "dress"
      ? "separates"
      : draft.garmentMode;
  const candidate: LookDraft = {
    ...draft,
    garmentMode,
    selections,
  };
  const compatibility = evaluateLookCompatibility(candidate, catalog);

  if (!compatibility.allowed) {
    return unchanged(draft, compatibility.warnings);
  }

  return changed(draft, {
    id: draft.id,
    muse: draft.muse,
    garmentMode,
    selections,
  });
};

const reduceSetGarmentMode = (
  draft: LookDraft,
  command: Extract<LookCommand, { readonly type: "set-garment-mode" }>,
  catalog: Catalog,
): ReducerResult => {
  if (command.mode === draft.garmentMode) {
    return unchanged(draft);
  }

  if (command.mode === "dress" && draft.selections.dress === undefined) {
    return unchanged(draft, [
      {
        code: "DRESS_REQUIRED",
        severity: "error",
        relatedAssets: [],
        message: "Dress mode requires a selected dress.",
      },
    ]);
  }

  const candidate: LookDraft = {
    ...draft,
    garmentMode: command.mode,
  };
  const compatibility = evaluateLookCompatibility(candidate, catalog);

  if (!compatibility.allowed) {
    return unchanged(draft, compatibility.warnings);
  }

  return changed(draft, {
    id: draft.id,
    muse: draft.muse,
    garmentMode: command.mode,
    selections: draft.selections,
  });
};

const reduceSetMuse = (
  draft: LookDraft,
  command: Extract<LookCommand, { readonly type: "set-muse" }>,
  catalog: Catalog,
): ReducerResult => {
  if (sameReference(draft.muse, command.reference)) {
    return unchanged(draft);
  }

  const compatibility = evaluateMuseSelection(
    draft,
    command.reference,
    catalog,
  );
  if (!compatibility.allowed) {
    return unchanged(draft, compatibility.warnings);
  }

  return changed(draft, {
    id: draft.id,
    muse: command.reference,
    garmentMode: draft.garmentMode,
    selections: draft.selections,
  });
};

export const reduceLookCommand = (
  draft: LookDraft,
  command: LookCommand,
  catalog: Catalog,
): ReducerResult => {
  switch (command.type) {
    case "select-asset":
      return reduceSelectAsset(draft, command, catalog);
    case "clear-slot":
      return reduceClearSlot(draft, command, catalog);
    case "set-garment-mode":
      return reduceSetGarmentMode(draft, command, catalog);
    case "set-muse":
      return reduceSetMuse(draft, command, catalog);
  }
};
