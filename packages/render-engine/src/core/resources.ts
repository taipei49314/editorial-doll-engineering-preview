import {
  AssetReferenceSchema,
  AssetSlotSchema,
  LayerRoleSchema,
  MuseReferenceSchema,
} from "@editorial-doll/domain";
import { z } from "zod";

import { SHA256_PATTERN } from "./constants.js";

export const RenderTargetSchema = z.enum(["runtime", "export"]);
export const RenderRepresentationSchema = z.enum(["runtime", "master"]);

export const RenderTargetFrameSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("runtime"),
      representation: z.literal("runtime"),
      width: z.literal(1024),
      height: z.literal(1536),
      origin: z.literal("top-left"),
    })
    .strict()
    .readonly(),
  z
    .object({
      target: z.literal("export"),
      representation: z.literal("master"),
      width: z.literal(2048),
      height: z.literal(3072),
      origin: z.literal("top-left"),
    })
    .strict()
    .readonly(),
]);

export const RenderOwnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("muse"),
      reference: MuseReferenceSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      kind: z.literal("asset"),
      slot: AssetSlotSchema,
      reference: AssetReferenceSchema,
    })
    .strict()
    .readonly(),
]);

const Sha256Schema = z.string().regex(SHA256_PATTERN);

export const RenderResourceRequestSchema = z
  .object({
    sourceSetId: Sha256Schema,
    owner: RenderOwnerSchema,
    role: LayerRoleSchema,
    representation: RenderRepresentationSchema,
  })
  .strict()
  .readonly();

const RenderResourceDescriptorBaseSchema = z
  .object({
    sourceSetId: Sha256Schema,
    resourceId: Sha256Schema,
    owner: RenderOwnerSchema,
    role: LayerRoleSchema,
    representation: RenderRepresentationSchema,
    width: z.number().int().positive().safe(),
    height: z.number().int().positive().safe(),
    encodedSha256: Sha256Schema,
    encodedBytes: z.number().int().positive().safe().max(26_214_400),
    encodedBitDepth: z.union([z.literal(8), z.literal(16)]),
  })
  .strict();

export const RenderResourceDescriptorSchema =
  RenderResourceDescriptorBaseSchema.readonly();

export const RenderImageLeaseMetadataSchema =
  RenderResourceDescriptorBaseSchema.extend({
    decodedByteLength: z.number().int().positive().safe(),
    decodedBitDepth: z.literal(8),
    pixelFormat: z.literal("rgba8"),
    colourSpace: z.literal("srgb"),
    alphaMode: z.literal("straight"),
  })
    .strict()
    .readonly();

const SceneResourceSuccessSchema = z
  .object({
    ok: z.literal(true),
    resource: RenderResourceDescriptorSchema,
  })
  .strict()
  .readonly();

const SceneResourceFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.literal("unavailable"),
  })
  .strict()
  .readonly();

export const SceneResourceResultSchema = z.discriminatedUnion("ok", [
  SceneResourceSuccessSchema,
  SceneResourceFailureSchema,
]);

export type RenderTarget = z.infer<typeof RenderTargetSchema>;
export type RenderRepresentation = z.infer<
  typeof RenderRepresentationSchema
>;
export type RenderTargetFrame = z.infer<typeof RenderTargetFrameSchema>;
export type RenderOwner = z.infer<typeof RenderOwnerSchema>;
export type RenderResourceRequest = z.infer<
  typeof RenderResourceRequestSchema
>;
export type RenderResourceDescriptor = z.infer<
  typeof RenderResourceDescriptorSchema
>;
export type RenderImageLeaseMetadata = z.infer<
  typeof RenderImageLeaseMetadataSchema
>;
export type SceneResourceResult = z.infer<typeof SceneResourceResultSchema>;

export interface RenderResourceResolver {
  readonly sourceSetId: string;
  resolve(request: RenderResourceRequest): SceneResourceResult;
}
