import { z } from "zod";

export const DomainIdSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u,
    "Expected a lowercase, hyphen-delimited stable ID.",
  );

export const SemanticVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u,
    "Expected an exact major.minor.patch version.",
  );

export const AssetReferenceSchema = z
  .object({
    id: DomainIdSchema,
    version: SemanticVersionSchema,
  })
  .strict()
  .readonly();

export const VersionedAssetReferenceSchema = AssetReferenceSchema;
export const MuseReferenceSchema = AssetReferenceSchema;

export type AssetReference = z.infer<typeof AssetReferenceSchema>;
export type VersionedAssetReference = z.infer<
  typeof VersionedAssetReferenceSchema
>;
export type MuseReference = z.infer<typeof MuseReferenceSchema>;

export const referenceKey = (reference: AssetReference): string =>
  `${reference.id}@${reference.version}`;

export const sameReference = (
  left: AssetReference | undefined,
  right: AssetReference | undefined,
): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.id === right.id &&
    left.version === right.version);
