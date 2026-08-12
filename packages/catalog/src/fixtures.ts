import {
  AssetSchema,
  MASTER_FRAME,
  MuseSchema,
  type Asset,
  type AssetCompatibility,
  type AssetPart,
} from "@editorial-doll/domain";

import { createCatalog } from "./catalog.js";

const MUSE_ID = "muse-editorial-001";

const neutralCompatibility = (
  overrides: Partial<AssetCompatibility> = {},
): AssetCompatibility => ({
  compatibleMuses: [{ id: MUSE_ID, version: "1.0.0" }],
  requiresActiveTags: [],
  excludesActiveTags: [],
  incompatibleAssets: [],
  ...overrides,
});

const part = (
  id: string,
  role: AssetPart["role"],
  sourcePath: string,
): AssetPart => ({ id, role, sourcePath });

const makeAsset = (
  input: Omit<Asset, "frame">,
): Asset => AssetSchema.parse({ ...input, frame: MASTER_FRAME });

const muse = MuseSchema.parse({
  id: MUSE_ID,
  version: "1.0.0",
  displayName: "Neutral Editorial Muse",
  frame: MASTER_FRAME,
  bodyPart: part(
    "muse-editorial-001-body",
    "muse-body",
    "muse-editorial-001/1.0.0/muse-body.png",
  ),
});

const assets: readonly Asset[] = [
  makeAsset({
    id: "background-studio-001",
    version: "1.0.0",
    slot: "background",
    displayName: "Neutral Studio",
    tags: ["studio"],
    parts: [
      part(
        "background-studio-001-main",
        "background",
        "background/background-studio-001/1.0.0/background.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "hair-bob-001",
    version: "1.0.0",
    slot: "hair",
    displayName: "Neutral Bob",
    tags: ["bob"],
    parts: [
      part(
        "hair-bob-001-back",
        "hair-back",
        "muse-editorial-001/hair/hair-bob-001/1.0.0/hair-back.png",
      ),
      part(
        "hair-bob-001-front",
        "hair-front",
        "muse-editorial-001/hair/hair-bob-001/1.0.0/hair-front.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "hair-wave-001",
    version: "1.0.0",
    slot: "hair",
    displayName: "Neutral Wave",
    tags: ["wave"],
    parts: [
      part(
        "hair-wave-001-back",
        "hair-back",
        "muse-editorial-001/hair/hair-wave-001/1.0.0/hair-back.png",
      ),
      part(
        "hair-wave-001-front",
        "hair-front",
        "muse-editorial-001/hair/hair-wave-001/1.0.0/hair-front.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "makeup-soft-001",
    version: "1.0.0",
    slot: "makeup",
    displayName: "Soft Makeup",
    tags: ["soft-makeup"],
    parts: [
      part(
        "makeup-soft-001-main",
        "makeup",
        "muse-editorial-001/makeup/makeup-soft-001/1.0.0/makeup.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "makeup-graphic-001",
    version: "1.0.0",
    slot: "makeup",
    displayName: "Graphic Makeup",
    tags: ["graphic-makeup"],
    parts: [
      part(
        "makeup-graphic-001-main",
        "makeup",
        "muse-editorial-001/makeup/makeup-graphic-001/1.0.0/makeup.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "top-tailored-001",
    version: "1.0.0",
    slot: "top",
    displayName: "Tailored Top",
    tags: ["tailored"],
    parts: [
      part(
        "top-tailored-001-main",
        "top",
        "muse-editorial-001/top/top-tailored-001/1.0.0/top.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "top-tailored-001",
    version: "1.1.0",
    slot: "top",
    displayName: "Tailored Top Revision",
    tags: ["tailored"],
    parts: [
      part(
        "top-tailored-001-main",
        "top",
        "muse-editorial-001/top/top-tailored-001/1.1.0/top.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "top-knit-001",
    version: "1.0.0",
    slot: "top",
    displayName: "Knit Top",
    tags: ["knit"],
    parts: [
      part(
        "top-knit-001-main",
        "top",
        "muse-editorial-001/top/top-knit-001/1.0.0/top.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "top-sheer-001",
    version: "1.0.0",
    slot: "top",
    displayName: "Sheer Top",
    tags: ["sheer"],
    parts: [
      part(
        "top-sheer-001-main",
        "top",
        "muse-editorial-001/top/top-sheer-001/1.0.0/top.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "bottom-wide-leg-001",
    version: "1.0.0",
    slot: "bottom",
    displayName: "Wide Leg Bottom",
    tags: ["wide-leg"],
    parts: [
      part(
        "bottom-wide-leg-001-main",
        "bottom",
        "muse-editorial-001/bottom/bottom-wide-leg-001/1.0.0/bottom.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "bottom-column-001",
    version: "1.0.0",
    slot: "bottom",
    displayName: "Column Bottom",
    tags: ["column"],
    parts: [
      part(
        "bottom-column-001-main",
        "bottom",
        "muse-editorial-001/bottom/bottom-column-001/1.0.0/bottom.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "bottom-mini-001",
    version: "1.0.0",
    slot: "bottom",
    displayName: "Mini Bottom",
    tags: ["mini"],
    parts: [
      part(
        "bottom-mini-001-main",
        "bottom",
        "muse-editorial-001/bottom/bottom-mini-001/1.0.0/bottom.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "dress-column-001",
    version: "1.0.0",
    slot: "dress",
    displayName: "Column Dress",
    tags: ["column-dress"],
    parts: [
      part(
        "dress-column-001-main",
        "dress",
        "muse-editorial-001/dress/dress-column-001/1.0.0/dress.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "outerwear-trench-001",
    version: "1.0.0",
    slot: "outerwear",
    displayName: "Split Trench",
    tags: ["outerwear"],
    parts: [
      part(
        "outerwear-trench-001-back",
        "outerwear-back",
        "muse-editorial-001/outerwear/outerwear-trench-001/1.0.0/outerwear-back.png",
      ),
      part(
        "outerwear-trench-001-front",
        "outerwear-front",
        "muse-editorial-001/outerwear/outerwear-trench-001/1.0.0/outerwear-front.png",
      ),
    ],
    compatibility: neutralCompatibility({
      incompatibleAssets: [{ id: "top-sheer-001", version: "1.0.0" }],
    }),
  }),
  makeAsset({
    id: "shoes-slingback-001",
    version: "1.0.0",
    slot: "shoes",
    displayName: "Slingback Shoes",
    tags: ["slingback"],
    parts: [
      part(
        "shoes-slingback-001-main",
        "shoes",
        "muse-editorial-001/shoes/shoes-slingback-001/1.0.0/shoes.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "shoes-boot-001",
    version: "1.0.0",
    slot: "shoes",
    displayName: "Boots",
    tags: ["boot"],
    parts: [
      part(
        "shoes-boot-001-main",
        "shoes",
        "muse-editorial-001/shoes/shoes-boot-001/1.0.0/shoes.png",
      ),
    ],
    compatibility: neutralCompatibility(),
  }),
  makeAsset({
    id: "top-incompatible-muse-001",
    version: "1.0.0",
    slot: "top",
    displayName: "Incompatible Muse Test Top",
    tags: ["test-incompatible"],
    parts: [
      part(
        "top-incompatible-muse-001-main",
        "top",
        "fixtures/top-incompatible-muse-001/1.0.0/top.png",
      ),
    ],
    compatibility: neutralCompatibility({
      compatibleMuses: [{ id: "muse-other-001", version: "1.0.0" }],
    }),
  }),
  makeAsset({
    id: "accessory-tailored-only-001",
    version: "1.0.0",
    slot: "accessory",
    displayName: "Tailored Requirement Test Accessory",
    tags: ["test-requirement"],
    parts: [
      part(
        "accessory-tailored-only-001-front",
        "accessory-front",
        "fixtures/accessory-tailored-only-001/1.0.0/accessory-front.png",
      ),
    ],
    compatibility: neutralCompatibility({
      requiresActiveTags: ["tailored"],
    }),
  }),
  makeAsset({
    id: "accessory-no-knit-001",
    version: "1.0.0",
    slot: "accessory",
    displayName: "Knit Exclusion Test Accessory",
    tags: ["test-exclusion"],
    parts: [
      part(
        "accessory-no-knit-001-front",
        "accessory-front",
        "fixtures/accessory-no-knit-001/1.0.0/accessory-front.png",
      ),
    ],
    compatibility: neutralCompatibility({
      excludesActiveTags: ["knit"],
    }),
  }),
];

export const FIXTURE_REFERENCES = Object.freeze({
  muse: { id: MUSE_ID, version: "1.0.0" },
  background: { id: "background-studio-001", version: "1.0.0" },
  topTailored: { id: "top-tailored-001", version: "1.0.0" },
  topTailoredRevision: { id: "top-tailored-001", version: "1.1.0" },
  topKnit: { id: "top-knit-001", version: "1.0.0" },
  topSheer: { id: "top-sheer-001", version: "1.0.0" },
  bottomWideLeg: { id: "bottom-wide-leg-001", version: "1.0.0" },
  bottomColumn: { id: "bottom-column-001", version: "1.0.0" },
  dressColumn: { id: "dress-column-001", version: "1.0.0" },
  outerwearTrench: { id: "outerwear-trench-001", version: "1.0.0" },
  incompatibleMuseTop: {
    id: "top-incompatible-muse-001",
    version: "1.0.0",
  },
  tailoredOnlyAccessory: {
    id: "accessory-tailored-only-001",
    version: "1.0.0",
  },
  noKnitAccessory: { id: "accessory-no-knit-001", version: "1.0.0" },
} as const);

export const fixtureCatalog = createCatalog({
  muses: [muse],
  assets,
});
