import { describe, expect, it } from "vitest";

import {
  CatalogSchema,
  CompatibilityResultSchema,
  LookDraftSchema,
  activeSlots,
  evaluateLookCompatibility,
} from "@editorial-doll/domain";

import { FIXTURE_REFERENCES, fixtureCatalog } from "../src/index.js";
import { createDraft } from "./helpers.js";

describe("compatibility engine", () => {
  it("accepts a valid empty neutral draft", () => {
    const result = evaluateLookCompatibility(createDraft(), fixtureCatalog);

    expect(result).toEqual({ allowed: true, warnings: [] });
    expect(CompatibilityResultSchema.safeParse(result).success).toBe(true);
  });

  it("derives active slots from garment mode in canonical order", () => {
    expect(activeSlots(createDraft())).toEqual([
      "background",
      "hair",
      "makeup",
      "top",
      "bottom",
      "outerwear",
      "shoes",
      "accessory",
    ]);
    expect(
      activeSlots(
        createDraft({
          garmentMode: "dress",
          selections: { dress: FIXTURE_REFERENCES.dressColumn },
        }),
      ),
    ).toEqual([
      "background",
      "hair",
      "makeup",
      "dress",
      "outerwear",
      "shoes",
      "accessory",
    ]);
  });

  it("reports unavailable versions without substitution", () => {
    const draft = LookDraftSchema.parse({
      ...createDraft(),
      selections: {
        top: {
          id: FIXTURE_REFERENCES.topTailored.id,
          version: "9.9.9",
        },
      },
    });
    const result = evaluateLookCompatibility(draft, fixtureCatalog);

    expect(result.allowed).toBe(false);
    expect(result.warnings).toMatchObject([
      {
        code: "ASSET_VERSION_UNAVAILABLE",
        subject: {
          id: FIXTURE_REFERENCES.topTailored.id,
          version: "9.9.9",
        },
      },
    ]);
  });

  it("reports a missing Muse explicitly", () => {
    const draft = createDraft({
      muse: { id: "muse-missing-001", version: "1.0.0" },
    });
    const result = evaluateLookCompatibility(draft, fixtureCatalog);

    expect(result.allowed).toBe(false);
    expect(result.warnings[0]?.code).toBe("MUSE_NOT_FOUND");
  });

  it("orders requirement warnings deterministically", () => {
    const baseAccessory = fixtureCatalog.assets.find(
      (asset) => asset.id === FIXTURE_REFERENCES.tailoredOnlyAccessory.id,
    );
    expect(baseAccessory).toBeDefined();
    const orderedRequirementAsset = {
      ...baseAccessory,
      id: "accessory-order-test-001",
      displayName: "Order Test Accessory",
      parts: [
        {
          id: "accessory-order-test-001-front",
          role: "accessory-front" as const,
          sourcePath: "fixtures/accessory-order-test-001/1.0.0/accessory-front.png",
        },
      ],
      compatibility: {
        compatibleMuses: [FIXTURE_REFERENCES.muse],
        requiresActiveTags: ["zeta-tag", "alpha-tag"],
        excludesActiveTags: [],
        incompatibleAssets: [],
      },
    };
    const catalog = CatalogSchema.parse({
      muses: fixtureCatalog.muses,
      assets: [...fixtureCatalog.assets, orderedRequirementAsset],
    });
    const draft = createDraft({
      selections: {
        accessory: { id: "accessory-order-test-001", version: "1.0.0" },
      },
    });

    const first = evaluateLookCompatibility(draft, catalog);
    const second = evaluateLookCompatibility(draft, catalog);

    expect(first).toEqual(second);
    expect(first.warnings.map((warning) => warning.message)).toEqual([
      "Asset accessory-order-test-001@1.0.0 requires active tag alpha-tag.",
      "Asset accessory-order-test-001@1.0.0 requires active tag zeta-tag.",
    ]);
  });
});
