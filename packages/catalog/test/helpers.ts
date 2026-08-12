import {
  LookCommandSchema,
  LookDraftSchema,
  reduceLookCommand,
  type AssetReference,
  type Catalog,
  type LookDraft,
  type ReducerResult,
} from "@editorial-doll/domain";

import { FIXTURE_REFERENCES, fixtureCatalog } from "../src/index.js";

export const createDraft = (
  overrides: Partial<LookDraft> = {},
): LookDraft =>
  LookDraftSchema.parse({
    id: "look-draft-001",
    revision: 0,
    muse: FIXTURE_REFERENCES.muse,
    garmentMode: "separates",
    selections: {},
    ...overrides,
  });

export const selectAsset = (
  draft: LookDraft,
  reference: AssetReference,
  catalog: Catalog = fixtureCatalog,
): ReducerResult =>
  reduceLookCommand(
    draft,
    LookCommandSchema.parse({ type: "select-asset", reference }),
    catalog,
  );

export const setGarmentMode = (
  draft: LookDraft,
  mode: "separates" | "dress",
  catalog: Catalog = fixtureCatalog,
): ReducerResult =>
  reduceLookCommand(
    draft,
    LookCommandSchema.parse({ type: "set-garment-mode", mode }),
    catalog,
  );

export const clearSlot = (
  draft: LookDraft,
  slot: "background" | "hair" | "makeup" | "top" | "bottom" | "dress" | "outerwear" | "shoes" | "accessory",
  catalog: Catalog = fixtureCatalog,
): ReducerResult =>
  reduceLookCommand(
    draft,
    LookCommandSchema.parse({ type: "clear-slot", slot }),
    catalog,
  );

export const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
};
