import { z } from "zod";

import {
  AssetReferenceSchema,
  DomainIdSchema,
  MuseReferenceSchema,
  SemanticVersionSchema,
  referenceKey,
  sameReference,
} from "./identity.js";

export const GarmentModeSchema = z.enum(["separates", "dress"]);
export type GarmentMode = z.infer<typeof GarmentModeSchema>;

export const SelectionMapSchema = z
  .object({
    background: AssetReferenceSchema.optional(),
    hair: AssetReferenceSchema.optional(),
    makeup: AssetReferenceSchema.optional(),
    top: AssetReferenceSchema.optional(),
    bottom: AssetReferenceSchema.optional(),
    dress: AssetReferenceSchema.optional(),
    outerwear: AssetReferenceSchema.optional(),
    shoes: AssetReferenceSchema.optional(),
    accessory: AssetReferenceSchema.optional(),
  })
  .strict()
  .readonly();

export type SelectionMap = z.infer<typeof SelectionMapSchema>;

export const LookDraftSchema = z
  .object({
    id: DomainIdSchema,
    revision: z.number().int().nonnegative(),
    muse: MuseReferenceSchema,
    garmentMode: GarmentModeSchema,
    selections: SelectionMapSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.garmentMode === "dress" && draft.selections.dress === undefined) {
      context.addIssue({
        code: "custom",
        message: "Dress mode requires a retained dress selection.",
        path: ["selections", "dress"],
      });
    }
  })
  .readonly();

export type LookDraft = z.infer<typeof LookDraftSchema>;

export const LookSchema = z
  .object({
    id: DomainIdSchema,
    title: z.string().trim().min(1).max(120),
    revision: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
    sourceDraftId: DomainIdSchema,
    snapshot: LookDraftSchema,
  })
  .strict()
  .readonly();

export type Look = z.infer<typeof LookSchema>;

export const LookReferenceSchema = z
  .object({
    id: DomainIdSchema,
    revision: z.number().int().positive(),
  })
  .strict()
  .readonly();

export type LookReference = z.infer<typeof LookReferenceSchema>;

export const CollectionSchema = z
  .object({
    id: DomainIdSchema,
    title: z.string().trim().min(1).max(120),
    lookReferences: z.array(LookReferenceSchema).readonly(),
  })
  .strict()
  .superRefine((collection, context) => {
    const keys = new Set<string>();
    for (const [index, reference] of collection.lookReferences.entries()) {
      const key = `${reference.id}@${reference.revision}`;
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate look reference: ${key}.`,
          path: ["lookReferences", index],
        });
      }
      keys.add(key);
    }
  })
  .readonly();

export type Collection = z.infer<typeof CollectionSchema>;

export const BrandProfileSchema = z
  .object({
    id: DomainIdSchema,
    version: SemanticVersionSchema,
    displayName: z.string().trim().min(1).max(120),
    defaultMuse: MuseReferenceSchema,
    supportedMuses: z.array(MuseReferenceSchema).min(1).readonly(),
  })
  .strict()
  .superRefine((profile, context) => {
    if (
      !profile.supportedMuses.some((reference) =>
        sameReference(reference, profile.defaultMuse),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "The default Muse must be included in supportedMuses.",
        path: ["defaultMuse"],
      });
    }

    const keys = new Set<string>();
    for (const [index, reference] of profile.supportedMuses.entries()) {
      const key = referenceKey(reference);
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate supported Muse reference: ${key}.`,
          path: ["supportedMuses", index],
        });
      }
      keys.add(key);
    }
  })
  .readonly();

export type BrandProfile = z.infer<typeof BrandProfileSchema>;
