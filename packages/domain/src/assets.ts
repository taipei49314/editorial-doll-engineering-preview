import { z } from "zod";

import {
  AssetReferenceSchema,
  DomainIdSchema,
  MuseReferenceSchema,
  SemanticVersionSchema,
} from "./identity.js";

export const MASTER_FRAME = Object.freeze({
  width: 2048,
  height: 3072,
  origin: "top-left",
} as const);

export const FrameSchema = z
  .object({
    width: z.literal(MASTER_FRAME.width),
    height: z.literal(MASTER_FRAME.height),
    origin: z.literal(MASTER_FRAME.origin),
  })
  .strict()
  .readonly();

export const AssetSlotSchema = z.enum([
  "background",
  "hair",
  "makeup",
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "accessory",
]);

export const LayerRoleSchema = z.enum([
  "background",
  "hair-back",
  "muse-body",
  "makeup",
  "shoes",
  "bottom",
  "dress",
  "top",
  "outerwear-back",
  "outerwear-front",
  "hair-front",
  "accessory-back",
  "accessory-front",
]);

export type AssetSlot = z.infer<typeof AssetSlotSchema>;
export type LayerRole = z.infer<typeof LayerRoleSchema>;

export const LAYER_ROLE_ORDER = Object.freeze({
  background: 0,
  "hair-back": 100,
  "outerwear-back": 150,
  "accessory-back": 175,
  "muse-body": 200,
  makeup: 300,
  shoes: 400,
  bottom: 500,
  dress: 550,
  top: 600,
  "outerwear-front": 700,
  "hair-front": 800,
  "accessory-front": 900,
} as const satisfies Readonly<Record<LayerRole, number>>);

const isRelativePngPath = (value: string): boolean => {
  const segments = value.split("/");
  return (
    value.endsWith(".png") &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes(":") &&
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== "..",
    )
  );
};

export const AssetPartSchema = z
  .object({
    id: DomainIdSchema,
    role: LayerRoleSchema,
    sourcePath: z.string().min(5).refine(isRelativePngPath, {
      message: "Expected a relative, forward-slash PNG path without traversal.",
    }),
  })
  .strict()
  .readonly();

export type AssetPart = z.infer<typeof AssetPartSchema>;

export const MuseSchema = z
  .object({
    id: DomainIdSchema,
    version: SemanticVersionSchema,
    displayName: z.string().trim().min(1).max(120),
    frame: FrameSchema,
    bodyPart: AssetPartSchema,
  })
  .strict()
  .superRefine((muse, context) => {
    if (muse.bodyPart.role !== "muse-body") {
      context.addIssue({
        code: "custom",
        message: "A Muse body part must use the muse-body layer role.",
        path: ["bodyPart", "role"],
      });
    }
  })
  .readonly();

export type Muse = z.infer<typeof MuseSchema>;

export const AssetCompatibilitySchema = z
  .object({
    compatibleMuses: z.array(MuseReferenceSchema).min(1).readonly(),
    requiresActiveTags: z.array(DomainIdSchema).readonly(),
    excludesActiveTags: z.array(DomainIdSchema).readonly(),
    incompatibleAssets: z.array(AssetReferenceSchema).readonly(),
  })
  .strict()
  .readonly();

export type AssetCompatibility = z.infer<typeof AssetCompatibilitySchema>;

const requiredRolesBySlot = {
  background: ["background"],
  hair: ["hair-back", "hair-front"],
  makeup: ["makeup"],
  top: ["top"],
  bottom: ["bottom"],
  dress: ["dress"],
  outerwear: ["outerwear-back", "outerwear-front"],
  shoes: ["shoes"],
  accessory: [],
} as const satisfies Readonly<Record<AssetSlot, readonly LayerRole[]>>;

const allowedRolesBySlot = {
  ...requiredRolesBySlot,
  accessory: ["accessory-back", "accessory-front"],
} as const satisfies Readonly<Record<AssetSlot, readonly LayerRole[]>>;

const addDuplicateIssues = (
  values: readonly string[],
  context: z.RefinementCtx,
  path: readonly (string | number)[],
  label: string,
): void => {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate ${label}: ${value}.`,
        path: [...path, index],
      });
    }
    seen.add(value);
  }
};

export const AssetSchema = z
  .object({
    id: DomainIdSchema,
    version: SemanticVersionSchema,
    slot: AssetSlotSchema,
    displayName: z.string().trim().min(1).max(120),
    frame: FrameSchema,
    tags: z.array(DomainIdSchema).readonly(),
    parts: z.array(AssetPartSchema).min(1).readonly(),
    compatibility: AssetCompatibilitySchema,
  })
  .strict()
  .superRefine((asset, context) => {
    addDuplicateIssues(
      asset.parts.map((part) => part.id),
      context,
      ["parts"],
      "part ID",
    );
    addDuplicateIssues(
      asset.parts.map((part) => part.role),
      context,
      ["parts"],
      "layer role",
    );
    addDuplicateIssues(asset.tags, context, ["tags"], "tag");
    addDuplicateIssues(
      asset.compatibility.compatibleMuses.map(
        (reference) => `${reference.id}@${reference.version}`,
      ),
      context,
      ["compatibility", "compatibleMuses"],
      "compatible Muse reference",
    );
    addDuplicateIssues(
      asset.compatibility.requiresActiveTags,
      context,
      ["compatibility", "requiresActiveTags"],
      "required tag",
    );
    addDuplicateIssues(
      asset.compatibility.excludesActiveTags,
      context,
      ["compatibility", "excludesActiveTags"],
      "excluded tag",
    );
    addDuplicateIssues(
      asset.compatibility.incompatibleAssets.map(
        (reference) => `${reference.id}@${reference.version}`,
      ),
      context,
      ["compatibility", "incompatibleAssets"],
      "incompatible asset reference",
    );

    const allowedRoles = allowedRolesBySlot[asset.slot];
    for (const [index, part] of asset.parts.entries()) {
      if (!allowedRoles.some((allowedRole) => allowedRole === part.role)) {
        context.addIssue({
          code: "custom",
          message: `Layer role ${part.role} is not valid for slot ${asset.slot}.`,
          path: ["parts", index, "role"],
        });
      }
    }

    const presentRoles = new Set(asset.parts.map((part) => part.role));
    for (const requiredRole of requiredRolesBySlot[asset.slot]) {
      if (!presentRoles.has(requiredRole)) {
        context.addIssue({
          code: "custom",
          message: `Slot ${asset.slot} requires layer role ${requiredRole}.`,
          path: ["parts"],
        });
      }
    }

    if (asset.slot === "accessory" && asset.parts.length > 2) {
      context.addIssue({
        code: "custom",
        message: "An accessory supports at most one back and one front part.",
        path: ["parts"],
      });
    }

    if (
      asset.compatibility.incompatibleAssets.some(
        (reference) =>
          reference.id === asset.id && reference.version === asset.version,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "An asset cannot declare itself incompatible.",
        path: ["compatibility", "incompatibleAssets"],
      });
    }
  })
  .readonly();

export type Asset = z.infer<typeof AssetSchema>;

export const assetReferenceOf = (asset: Asset): z.infer<typeof AssetReferenceSchema> =>
  AssetReferenceSchema.parse({ id: asset.id, version: asset.version });
