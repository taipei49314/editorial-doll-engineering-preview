import { describe, expect, it } from "vitest";

import {
  AssetReferenceSchema,
  AssetSchema,
  BrandProfileSchema,
  CatalogSchema,
  CollectionSchema,
  LAYER_ROLE_ORDER,
  LookCommandSchema,
  LookDraftSchema,
  LookSchema,
  MASTER_FRAME,
  MuseSchema,
  SemanticVersionSchema,
} from "../src/index.js";

const validMuseInput = {
  id: "muse-editorial-001",
  version: "1.0.0",
  displayName: "Fixture Muse",
  frame: MASTER_FRAME,
  bodyPart: {
    id: "muse-editorial-001-body",
    role: "muse-body",
    sourcePath: "muse-editorial-001/1.0.0/muse-body.png",
  },
} as const;

const validTopInput = {
  id: "top-tailored-001",
  version: "1.0.0",
  slot: "top",
  displayName: "Tailored Top",
  frame: MASTER_FRAME,
  tags: ["tailored"],
  parts: [
    {
      id: "top-tailored-001-main",
      role: "top",
      sourcePath: "top/top-tailored-001/1.0.0/top.png",
    },
  ],
  compatibility: {
    compatibleMuses: [{ id: "muse-editorial-001", version: "1.0.0" }],
    requiresActiveTags: [],
    excludesActiveTags: [],
    incompatibleAssets: [],
  },
} as const;

const validDraftInput = {
  id: "look-draft-001",
  revision: 0,
  muse: { id: "muse-editorial-001", version: "1.0.0" },
  garmentMode: "separates",
  selections: {
    top: { id: "top-tailored-001", version: "1.0.0" },
  },
} as const;

describe("runtime schemas", () => {
  it("parses every required primary domain shape", () => {
    const muse = MuseSchema.parse(validMuseInput);
    const asset = AssetSchema.parse(validTopInput);
    const draft = LookDraftSchema.parse(validDraftInput);

    expect(
      CatalogSchema.parse({ muses: [muse], assets: [asset] }),
    ).toMatchObject({ muses: [muse], assets: [asset] });
    expect(
      LookSchema.parse({
        id: "look-editorial-001",
        title: "First Look",
        revision: 1,
        createdAt: "2026-08-01T12:00:00.000Z",
        sourceDraftId: draft.id,
        snapshot: draft,
      }),
    ).toMatchObject({ sourceDraftId: draft.id, snapshot: draft });
    expect(
      CollectionSchema.parse({
        id: "collection-editorial-001",
        title: "First Collection",
        lookReferences: [{ id: "look-editorial-001", revision: 1 }],
      }),
    ).toMatchObject({ id: "collection-editorial-001" });
    expect(
      BrandProfileSchema.parse({
        id: "brand-editorial-001",
        version: "1.0.0",
        displayName: "Editorial Fixture",
        defaultMuse: { id: muse.id, version: muse.version },
        supportedMuses: [{ id: muse.id, version: muse.version }],
      }),
    ).toMatchObject({ defaultMuse: { id: muse.id } });
  });

  it("requires both ID and version in every asset reference", () => {
    expect(
      AssetReferenceSchema.parse({ id: "top-tailored-001", version: "1.0.0" }),
    ).toEqual({ id: "top-tailored-001", version: "1.0.0" });
    expect(
      AssetReferenceSchema.safeParse({ id: "top-tailored-001" }).success,
    ).toBe(false);
    expect(
      AssetReferenceSchema.safeParse({ version: "1.0.0" }).success,
    ).toBe(false);
  });

  it.each(["1", "1.0", "01.0.0", "1.0.0-beta", "latest"])(
    "rejects non-exact version %s",
    (version) => {
      expect(SemanticVersionSchema.safeParse(version).success).toBe(false);
    },
  );

  it("rejects localized, uppercase, ambiguous, and traversal identity data", () => {
    expect(
      AssetReferenceSchema.safeParse({ id: "上衣1", version: "1.0.0" }).success,
    ).toBe(false);
    expect(
      AssetReferenceSchema.safeParse({ id: "Top-001", version: "1.0.0" })
        .success,
    ).toBe(false);
    expect(
      AssetSchema.safeParse({
        ...validTopInput,
        parts: [
          {
            ...validTopInput.parts[0],
            sourcePath: "../outside.png",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each(["C:/absolute.png", "C:drive-relative.png", "asset/./part.png"])(
    "rejects non-portable source path %s",
    (sourcePath) => {
      expect(
        AssetSchema.safeParse({
          ...validTopInput,
          parts: [{ ...validTopInput.parts[0], sourcePath }],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects unknown keys on strict domain objects", () => {
    expect(
      AssetSchema.safeParse({ ...validTopInput, unexpected: true }).success,
    ).toBe(false);
    expect(
      LookDraftSchema.safeParse({ ...validDraftInput, temporary: true }).success,
    ).toBe(false);
  });

  it("rejects dress mode without a retained dress", () => {
    expect(
      LookDraftSchema.safeParse({
        ...validDraftInput,
        garmentMode: "dress",
        selections: {},
      }).success,
    ).toBe(false);
  });

  it("enforces Muse body role and the fixed frame", () => {
    expect(
      MuseSchema.safeParse({
        ...validMuseInput,
        bodyPart: { ...validMuseInput.bodyPart, role: "top" },
      }).success,
    ).toBe(false);
    expect(
      MuseSchema.safeParse({
        ...validMuseInput,
        frame: { ...MASTER_FRAME, width: 1024 },
      }).success,
    ).toBe(false);
  });

  it("enforces slot-specific layer roles and split assets", () => {
    expect(
      AssetSchema.safeParse({ ...validTopInput, parts: [] }).success,
    ).toBe(false);
    expect(
      AssetSchema.safeParse({
        ...validTopInput,
        parts: [
          { ...validTopInput.parts[0], role: "dress" },
        ],
      }).success,
    ).toBe(false);
    expect(
      AssetSchema.safeParse({
        ...validTopInput,
        id: "hair-bob-001",
        slot: "hair",
        parts: [
          {
            id: "hair-bob-001-back",
            role: "hair-back",
            sourcePath: "hair/hair-bob-001/1.0.0/hair-back.png",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate part IDs, roles, tags, and catalog keys", () => {
    const duplicateParts = [
      validTopInput.parts[0],
      { ...validTopInput.parts[0] },
    ];
    expect(
      AssetSchema.safeParse({ ...validTopInput, parts: duplicateParts }).success,
    ).toBe(false);
    expect(
      AssetSchema.safeParse({
        ...validTopInput,
        tags: ["tailored", "tailored"],
      }).success,
    ).toBe(false);

    const muse = MuseSchema.parse(validMuseInput);
    const asset = AssetSchema.parse(validTopInput);
    expect(
      CatalogSchema.safeParse({ muses: [muse], assets: [asset, asset] }).success,
    ).toBe(false);
  });

  it("rejects self-conflict and invalid Brand or Collection references", () => {
    expect(
      AssetSchema.safeParse({
        ...validTopInput,
        compatibility: {
          ...validTopInput.compatibility,
          incompatibleAssets: [
            { id: validTopInput.id, version: validTopInput.version },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      BrandProfileSchema.safeParse({
        id: "brand-editorial-001",
        version: "1.0.0",
        displayName: "Editorial Fixture",
        defaultMuse: { id: "muse-editorial-001", version: "1.0.0" },
        supportedMuses: [{ id: "muse-other-001", version: "1.0.0" }],
      }).success,
    ).toBe(false);
    expect(
      BrandProfileSchema.safeParse({
        id: "brand-editorial-001",
        version: "1.0.0",
        displayName: "Editorial Fixture",
        defaultMuse: { id: "muse-editorial-001", version: "1.0.0" },
        supportedMuses: [
          { id: "muse-editorial-001", version: "1.0.0" },
          { id: "muse-editorial-001", version: "1.0.0" },
        ],
      }).success,
    ).toBe(false);
    expect(
      CollectionSchema.safeParse({
        id: "collection-editorial-001",
        title: "Duplicates",
        lookReferences: [
          { id: "look-editorial-001", revision: 1 },
          { id: "look-editorial-001", revision: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it("validates commands and rejects unknown command shapes", () => {
    expect(
      LookCommandSchema.parse({
        type: "select-asset",
        reference: { id: "top-tailored-001", version: "1.0.0" },
      }),
    ).toMatchObject({ type: "select-asset" });
    expect(
      LookCommandSchema.safeParse({
        type: "select-asset",
        reference: { id: "top-tailored-001" },
      }).success,
    ).toBe(false);
    expect(
      LookCommandSchema.safeParse({ type: "teleport-look" }).success,
    ).toBe(false);
  });

  it("defines a unique canonical order for every layer role", () => {
    const values = Object.values(LAYER_ROLE_ORDER);
    expect(new Set(values).size).toBe(values.length);
    expect(LAYER_ROLE_ORDER["hair-back"]).toBeLessThan(
      LAYER_ROLE_ORDER["hair-front"],
    );
    expect(LAYER_ROLE_ORDER["outerwear-back"]).toBeLessThan(
      LAYER_ROLE_ORDER["outerwear-front"],
    );
  });
});
