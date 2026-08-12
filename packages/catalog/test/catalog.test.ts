import { describe, expect, it } from "vitest";

import {
  CatalogSchema,
  type Asset,
} from "@editorial-doll/domain";

import {
  FIXTURE_REFERENCES,
  createCatalog,
  fixtureCatalog,
  lookupAsset,
  lookupMuse,
} from "../src/index.js";

describe("fixture catalog", () => {
  it("is valid production-schema data with the planned neutral inventory", () => {
    expect(CatalogSchema.safeParse(fixtureCatalog).success).toBe(true);
    expect(fixtureCatalog.muses).toHaveLength(1);

    const idsBySlot = (slot: Asset["slot"]): Set<string> =>
      new Set(
        fixtureCatalog.assets
          .filter((asset) => asset.slot === slot)
          .map((asset) => asset.id),
      );

    expect(idsBySlot("top").size).toBeGreaterThanOrEqual(3);
    expect(idsBySlot("bottom").size).toBe(3);
    expect(idsBySlot("dress").size).toBe(1);
    expect(idsBySlot("outerwear").size).toBe(1);
    expect(idsBySlot("shoes").size).toBe(2);
    expect(idsBySlot("hair").size).toBe(2);
    expect(idsBySlot("makeup").size).toBe(2);
    expect(idsBySlot("background").size).toBe(1);
  });

  it("looks up exact asset versions and allows multiple versions", () => {
    expect(
      lookupAsset(fixtureCatalog, FIXTURE_REFERENCES.topTailored)?.displayName,
    ).toBe("Tailored Top");
    expect(
      lookupAsset(
        fixtureCatalog,
        FIXTURE_REFERENCES.topTailoredRevision,
      )?.displayName,
    ).toBe("Tailored Top Revision");
  });

  it("never falls back when an exact asset version is unavailable", () => {
    expect(
      lookupAsset(fixtureCatalog, {
        id: FIXTURE_REFERENCES.topTailored.id,
        version: "9.9.9",
      }),
    ).toBeUndefined();
  });

  it("looks up a Muse by the complete reference", () => {
    expect(
      lookupMuse(fixtureCatalog, FIXTURE_REFERENCES.muse)?.displayName,
    ).toBe("Neutral Editorial Muse");
    expect(
      lookupMuse(fixtureCatalog, {
        id: FIXTURE_REFERENCES.muse.id,
        version: "2.0.0",
      }),
    ).toBeUndefined();
  });

  it("rejects duplicate asset and Muse composite keys", () => {
    expect(() =>
      createCatalog({
        muses: [fixtureCatalog.muses[0], fixtureCatalog.muses[0]],
        assets: fixtureCatalog.assets,
      }),
    ).toThrow(/Duplicate catalog identity/u);

    const asset = fixtureCatalog.assets[0];
    expect(asset).toBeDefined();
    expect(() =>
      createCatalog({
        muses: fixtureCatalog.muses,
        assets: [asset, asset],
      }),
    ).toThrow(/Duplicate catalog identity/u);
  });

  it("keeps fixture metadata immutable at its schema boundaries", () => {
    expect(Object.isFrozen(fixtureCatalog)).toBe(true);
    expect(Object.isFrozen(fixtureCatalog.assets)).toBe(true);
    expect(Object.isFrozen(fixtureCatalog.assets[0])).toBe(true);
  });
});
