import type {
  RenderImageLeaseMetadata,
  RenderResourceDescriptor,
} from "./resources.js";
import type { RenderTargetFrame, SceneNode } from "./scene-schema.js";
import { z } from "zod";

/**
 * Expected port failures deliberately expose no host error message, stack, path,
 * or URL. The renderer maps `failed` to the operation-specific stable code;
 * `readback-unavailable` is valid only for browser commit.
 */
export const PortFailureKindSchema = z.enum([
  "failed",
  "readback-unavailable",
]);

export const PortValueFailureSchema = z
  .object({
    ok: z.literal(false),
    kind: PortFailureKindSchema,
  })
  .strict()
  .readonly();

export const createPortValueSuccessSchema = <TValue>() =>
  z
    .object({
      ok: z.literal(true),
      // The host-owned value is transferred without recursive validation or
      // freezing; only this M3-owned control-plane wrapper is strict.
      value: z.custom<TValue>(),
    })
    .strict()
    .readonly();

export const createPortValueResultSchema = <TValue>() =>
  z.discriminatedUnion("ok", [
    createPortValueSuccessSchema<TValue>(),
    PortValueFailureSchema,
  ]);

export const PortValueResultSchema = createPortValueResultSchema<unknown>();

export const PortOperationSuccessSchema = z
  .object({ ok: z.literal(true) })
  .strict()
  .readonly();

export const PortOperationFailureSchema = z
  .object({
    ok: z.literal(false),
    // readback-unavailable belongs only to the value-returning commit port.
    kind: z.literal("failed"),
  })
  .strict()
  .readonly();

export const PortOperationResultSchema = z.discriminatedUnion("ok", [
  PortOperationSuccessSchema,
  PortOperationFailureSchema,
]);

export type PortFailureKind = z.infer<typeof PortFailureKindSchema>;
export type PortValueResult<TValue> = z.infer<
  ReturnType<typeof createPortValueResultSchema<TValue>>
>;
export type PortOperationResult = z.infer<
  typeof PortOperationResultSchema
>;

export const isPortValueSuccess = <TValue>(
  result: PortValueResult<TValue>,
): result is Readonly<{ readonly ok: true; readonly value: TValue }> =>
  result.ok;

export const isPortOperationSuccess = (
  result: PortOperationResult,
): result is Readonly<{ readonly ok: true }> => result.ok;

export interface RenderCancellation {
  isCancelled(): boolean;
}

export interface RenderImageLease<TImage> {
  readonly metadata: RenderImageLeaseMetadata;
  readonly image: TImage;
  release(): Promise<PortOperationResult>;
}

export interface RenderImageLoader<TImage> {
  load(
    resource: RenderResourceDescriptor,
  ): Promise<PortValueResult<RenderImageLease<TImage>>>;
}

export interface TransactionalRenderDriver<TImage, TStaging, TCommitted> {
  begin(target: RenderTargetFrame): Promise<PortValueResult<TStaging>>;
  draw(
    staging: TStaging,
    image: TImage,
    node: SceneNode,
  ): Promise<PortOperationResult>;
  commit(staging: TStaging): Promise<PortValueResult<TCommitted>>;
  discard(staging: TStaging): Promise<PortOperationResult>;
}

export interface RenderPorts<TImage, TStaging, TCommitted> {
  readonly cancellation: RenderCancellation;
  readonly imageLoader: RenderImageLoader<TImage>;
  readonly driver: TransactionalRenderDriver<TImage, TStaging, TCommitted>;
}
