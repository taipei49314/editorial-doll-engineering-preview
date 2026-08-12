import { describe, expect, it } from "vitest";

import {
  CatalogSchema,
  LookCommandSchema,
  MuseSchema,
  activeAssetReferences,
  reduceLookCommand,
} from "@editorial-doll/domain";

import { FIXTURE_REFERENCES, fixtureCatalog } from "../src/index.js";
import {
  clearSlot,
  createDraft,
  deepFreeze,
  selectAsset,
  setGarmentMode,
} from "./helpers.js";

describe("look command reducer", () => {
  it("selects, replaces, and clears a slot with exact revisions", () => {
    const initial = createDraft();
    const selected = selectAsset(initial, FIXTURE_REFERENCES.topTailored);

    expect(selected.changed).toBe(true);
    expect(selected.draft.revision).toBe(1);
    expect(selected.draft.selections.top).toEqual(
      FIXTURE_REFERENCES.topTailored,
    );

    const replaced = selectAsset(selected.draft, FIXTURE_REFERENCES.topKnit);
    expect(replaced.draft.revision).toBe(2);
    expect(replaced.draft.selections.top).toEqual(FIXTURE_REFERENCES.topKnit);

    const cleared = clearSlot(replaced.draft, "top");
    expect(cleared.changed).toBe(true);
    expect(cleared.draft.revision).toBe(3);
    expect(cleared.draft.selections.top).toBeUndefined();
  });

  it("returns the original draft for same-selection and missing-slot no-ops", () => {
    const selected = selectAsset(
      createDraft(),
      FIXTURE_REFERENCES.topTailored,
    ).draft;
    const sameSelection = selectAsset(
      selected,
      FIXTURE_REFERENCES.topTailored,
    );
    const missingSlot = clearSlot(selected, "hair");

    expect(sameSelection.changed).toBe(false);
    expect(sameSelection.draft).toBe(selected);
    expect(sameSelection.draft.revision).toBe(1);
    expect(missingSlot.changed).toBe(false);
    expect(missingSlot.draft).toBe(selected);
  });

  it("retains and restores top and bottom across dress mode", () => {
    const topSelected = selectAsset(
      createDraft(),
      FIXTURE_REFERENCES.topTailored,
    ).draft;
    const separates = selectAsset(
      topSelected,
      FIXTURE_REFERENCES.bottomWideLeg,
    ).draft;
    const dressResult = selectAsset(
      separates,
      FIXTURE_REFERENCES.dressColumn,
    );

    expect(dressResult.changed).toBe(true);
    expect(dressResult.draft.revision).toBe(3);
    expect(dressResult.draft.garmentMode).toBe("dress");
    expect(dressResult.draft.selections.top).toEqual(
      FIXTURE_REFERENCES.topTailored,
    );
    expect(dressResult.draft.selections.bottom).toEqual(
      FIXTURE_REFERENCES.bottomWideLeg,
    );
    expect(dressResult.draft.selections.dress).toEqual(
      FIXTURE_REFERENCES.dressColumn,
    );
    expect(activeAssetReferences(dressResult.draft)).toEqual([
      FIXTURE_REFERENCES.dressColumn,
    ]);

    const restored = setGarmentMode(dressResult.draft, "separates");
    expect(restored.changed).toBe(true);
    expect(restored.draft.revision).toBe(4);
    expect(restored.draft.garmentMode).toBe("separates");
    expect(restored.draft.selections.top).toEqual(
      FIXTURE_REFERENCES.topTailored,
    );
    expect(restored.draft.selections.bottom).toEqual(
      FIXTURE_REFERENCES.bottomWideLeg,
    );
    expect(restored.draft.selections.dress).toEqual(
      FIXTURE_REFERENCES.dressColumn,
    );
    expect(activeAssetReferences(restored.draft)).toEqual([
      FIXTURE_REFERENCES.topTailored,
      FIXTURE_REFERENCES.bottomWideLeg,
    ]);
  });

  it("activates separates when selecting a top and retains the dress", () => {
    const dressDraft = selectAsset(
      createDraft(),
      FIXTURE_REFERENCES.dressColumn,
    ).draft;
    const result = selectAsset(dressDraft, FIXTURE_REFERENCES.topKnit);

    expect(result.draft.garmentMode).toBe("separates");
    expect(result.draft.selections.top).toEqual(FIXTURE_REFERENCES.topKnit);
    expect(result.draft.selections.dress).toEqual(
      FIXTURE_REFERENCES.dressColumn,
    );
    expect(activeAssetReferences(result.draft)).toEqual([
      FIXTURE_REFERENCES.topKnit,
    ]);
  });

  it("clears an active dress and immediately restores separates", () => {
    const top = selectAsset(
      createDraft(),
      FIXTURE_REFERENCES.topTailored,
    ).draft;
    const bottom = selectAsset(top, FIXTURE_REFERENCES.bottomColumn).draft;
    const dress = selectAsset(bottom, FIXTURE_REFERENCES.dressColumn).draft;
    const result = clearSlot(dress, "dress");

    expect(result.draft.garmentMode).toBe("separates");
    expect(result.draft.selections.dress).toBeUndefined();
    expect(result.draft.selections.top).toEqual(
      FIXTURE_REFERENCES.topTailored,
    );
    expect(result.draft.selections.bottom).toEqual(
      FIXTURE_REFERENCES.bottomColumn,
    );
  });

  it("rejects dress mode without a retained dress", () => {
    const draft = createDraft();
    const result = setGarmentMode(draft, "dress");

    expect(result.changed).toBe(false);
    expect(result.draft).toBe(draft);
    expect(result.warnings).toMatchObject([
      { code: "DRESS_REQUIRED", severity: "error" },
    ]);
  });

  it("distinguishes unknown asset IDs from unavailable versions", () => {
    const draft = createDraft();
    const unknown = selectAsset(draft, {
      id: "top-unknown-001",
      version: "1.0.0",
    });
    const wrongVersion = selectAsset(draft, {
      id: FIXTURE_REFERENCES.topTailored.id,
      version: "9.9.9",
    });

    expect(unknown.draft).toBe(draft);
    expect(unknown.warnings[0]?.code).toBe("ASSET_NOT_FOUND");
    expect(wrongVersion.draft).toBe(draft);
    expect(wrongVersion.warnings[0]?.code).toBe(
      "ASSET_VERSION_UNAVAILABLE",
    );
  });

  it("rejects a candidate that does not support the selected Muse", () => {
    const draft = createDraft();
    const result = selectAsset(
      draft,
      FIXTURE_REFERENCES.incompatibleMuseTop,
    );

    expect(result.changed).toBe(false);
    expect(result.draft).toBe(draft);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "MUSE_INCOMPATIBLE",
    );
  });

  it("enforces required and excluded active tags", () => {
    const draft = createDraft();
    const missingRequirement = selectAsset(
      draft,
      FIXTURE_REFERENCES.tailoredOnlyAccessory,
    );
    expect(missingRequirement.changed).toBe(false);
    expect(missingRequirement.warnings[0]?.code).toBe("REQUIRES_ACTIVE_TAG");

    const tailored = selectAsset(
      draft,
      FIXTURE_REFERENCES.topTailored,
    ).draft;
    const requirementMet = selectAsset(
      tailored,
      FIXTURE_REFERENCES.tailoredOnlyAccessory,
    );
    expect(requirementMet.changed).toBe(true);

    const knit = selectAsset(draft, FIXTURE_REFERENCES.topKnit).draft;
    const excluded = selectAsset(knit, FIXTURE_REFERENCES.noKnitAccessory);
    expect(excluded.changed).toBe(false);
    expect(excluded.warnings[0]?.code).toBe("EXCLUDED_ACTIVE_TAG");
  });

  it("detects conflicts declared in either direction", () => {
    const sheer = selectAsset(
      createDraft(),
      FIXTURE_REFERENCES.topSheer,
    ).draft;
    const outerwearSecond = selectAsset(
      sheer,
      FIXTURE_REFERENCES.outerwearTrench,
    );
    expect(outerwearSecond.changed).toBe(false);
    expect(outerwearSecond.warnings[0]?.code).toBe("ASSET_CONFLICT");

    const outerwear = selectAsset(
      createDraft(),
      FIXTURE_REFERENCES.outerwearTrench,
    ).draft;
    const sheerSecond = selectAsset(outerwear, FIXTURE_REFERENCES.topSheer);
    expect(sheerSecond.changed).toBe(false);
    expect(sheerSecond.warnings[0]?.code).toBe("ASSET_CONFLICT");
  });

  it("evaluates conflicts against the exact selected asset version", () => {
    const baseAccessory = fixtureCatalog.assets.find(
      (asset) => asset.id === FIXTURE_REFERENCES.tailoredOnlyAccessory.id,
    );
    expect(baseAccessory).toBeDefined();
    const versionConflictAccessory = {
      ...baseAccessory,
      id: "accessory-version-test-001",
      displayName: "Version Conflict Test Accessory",
      parts: [
        {
          id: "accessory-version-test-001-front",
          role: "accessory-front" as const,
          sourcePath: "fixtures/accessory-version-test-001/1.0.0/accessory-front.png",
        },
      ],
      compatibility: {
        compatibleMuses: [FIXTURE_REFERENCES.muse],
        requiresActiveTags: [],
        excludesActiveTags: [],
        incompatibleAssets: [FIXTURE_REFERENCES.topTailored],
      },
    };
    const catalog = CatalogSchema.parse({
      muses: fixtureCatalog.muses,
      assets: [...fixtureCatalog.assets, versionConflictAccessory],
    });
    const accessoryReference = {
      id: "accessory-version-test-001",
      version: "1.0.0",
    } as const;

    const originalVersion = selectAsset(
      createDraft(),
      FIXTURE_REFERENCES.topTailored,
      catalog,
    ).draft;
    const rejected = selectAsset(
      originalVersion,
      accessoryReference,
      catalog,
    );
    expect(rejected.changed).toBe(false);
    expect(rejected.warnings[0]).toMatchObject({
      code: "ASSET_CONFLICT",
      relatedAssets: [
        accessoryReference,
        FIXTURE_REFERENCES.topTailored,
      ],
    });

    const revision = selectAsset(
      createDraft(),
      FIXTURE_REFERENCES.topTailoredRevision,
      catalog,
    ).draft;
    const allowed = selectAsset(revision, accessoryReference, catalog);
    expect(allowed.changed).toBe(true);
  });

  it("ignores retained inactive separates during dress compatibility", () => {
    const sheer = selectAsset(
      createDraft(),
      FIXTURE_REFERENCES.topSheer,
    ).draft;
    const dress = selectAsset(sheer, FIXTURE_REFERENCES.dressColumn).draft;
    const outerwear = selectAsset(
      dress,
      FIXTURE_REFERENCES.outerwearTrench,
    );

    expect(outerwear.changed).toBe(true);
    expect(outerwear.draft.garmentMode).toBe("dress");
    expect(outerwear.draft.selections.top).toEqual(
      FIXTURE_REFERENCES.topSheer,
    );

    const rejectedRestoration = setGarmentMode(
      outerwear.draft,
      "separates",
    );
    expect(rejectedRestoration.changed).toBe(false);
    expect(rejectedRestoration.warnings[0]?.code).toBe("ASSET_CONFLICT");
  });

  it("ignores a retained inactive dress during separates compatibility", () => {
    const conflictingDress = {
      ...fixtureCatalog.assets.find(
        (asset) => asset.id === FIXTURE_REFERENCES.dressColumn.id,
      ),
      id: "dress-conflict-test-001",
      displayName: "Conflict Test Dress",
      parts: [
        {
          id: "dress-conflict-test-001-main",
          role: "dress" as const,
          sourcePath: "fixtures/dress-conflict-test-001/1.0.0/dress.png",
        },
      ],
      compatibility: {
        compatibleMuses: [FIXTURE_REFERENCES.muse],
        requiresActiveTags: [],
        excludesActiveTags: [],
        incompatibleAssets: [FIXTURE_REFERENCES.outerwearTrench],
      },
    };
    const catalog = CatalogSchema.parse({
      muses: fixtureCatalog.muses,
      assets: [...fixtureCatalog.assets, conflictingDress],
    });
    const dress = selectAsset(
      createDraft(),
      { id: "dress-conflict-test-001", version: "1.0.0" },
      catalog,
    ).draft;
    const separates = selectAsset(
      dress,
      FIXTURE_REFERENCES.topTailored,
      catalog,
    ).draft;
    const result = selectAsset(
      separates,
      FIXTURE_REFERENCES.outerwearTrench,
      catalog,
    );

    expect(result.changed).toBe(true);
    expect(result.draft.garmentMode).toBe("separates");
    expect(result.draft.selections.dress?.id).toBe("dress-conflict-test-001");
  });

  it("rejects a Muse change that invalidates retained selections", () => {
    const baseMuse = fixtureCatalog.muses[0];
    expect(baseMuse).toBeDefined();
    const alternateMuse = MuseSchema.parse({
      ...baseMuse,
      id: "muse-other-001",
      displayName: "Alternate Test Muse",
      bodyPart: {
        ...baseMuse?.bodyPart,
        id: "muse-other-001-body",
        sourcePath: "muse-other-001/1.0.0/muse-body.png",
      },
    });
    const catalog = CatalogSchema.parse({
      muses: [...fixtureCatalog.muses, alternateMuse],
      assets: fixtureCatalog.assets,
    });
    const selected = selectAsset(
      createDraft(),
      FIXTURE_REFERENCES.topTailored,
      catalog,
    ).draft;
    const inactiveTop = selectAsset(
      selected,
      FIXTURE_REFERENCES.dressColumn,
      catalog,
    ).draft;
    const result = reduceLookCommand(
      inactiveTop,
      LookCommandSchema.parse({
        type: "set-muse",
        reference: { id: alternateMuse.id, version: alternateMuse.version },
      }),
      catalog,
    );

    expect(result.changed).toBe(false);
    expect(result.draft).toBe(inactiveTop);
    expect(result.draft.garmentMode).toBe("dress");
    expect(result.draft.selections.top).toEqual(
      FIXTURE_REFERENCES.topTailored,
    );
    expect(result.warnings[0]?.code).toBe("MUSE_INCOMPATIBLE");
  });

  it("does not mutate deeply frozen inputs", () => {
    const draft = deepFreeze(createDraft());
    const before = structuredClone(draft);
    const catalogBefore = structuredClone(fixtureCatalog);
    deepFreeze(fixtureCatalog);

    const result = selectAsset(draft, FIXTURE_REFERENCES.topTailored);

    expect(result.changed).toBe(true);
    expect(draft).toEqual(before);
    expect(result.draft).not.toBe(draft);
    expect(result.draft.selections).not.toBe(draft.selections);
    expect(fixtureCatalog).toEqual(catalogBefore);
  });

  it("returns deeply equal output for identical input", () => {
    const draft = deepFreeze(createDraft());
    const command = LookCommandSchema.parse({
      type: "select-asset",
      reference: FIXTURE_REFERENCES.topTailored,
    });

    const first = reduceLookCommand(draft, command, fixtureCatalog);
    const second = reduceLookCommand(draft, command, fixtureCatalog);

    expect(first).toEqual(second);
  });
});
