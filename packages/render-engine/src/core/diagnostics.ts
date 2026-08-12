import { CompatibilityWarningSchema } from "@editorial-doll/domain";
import { z } from "zod";

import { DIAGNOSTIC_PHASE_RANK } from "./constants.js";
import { deepFreezeOwned } from "./freeze.js";

export const RenderDiagnosticCodeSchema = z.enum([
  "SCENE_INPUT_INVALID",
  "SCENE_DOMAIN_CATALOG_INVALID",
  "SCENE_GENERATED_CATALOG_FORBIDDEN",
  "SCENE_MUSE_NOT_FOUND",
  "SCENE_MUSE_VERSION_UNAVAILABLE",
  "SCENE_ASSET_NOT_FOUND",
  "SCENE_ASSET_VERSION_UNAVAILABLE",
  "SCENE_INCOMPATIBLE_LOOK",
  "SCENE_ACTIVE_SLOT_MISMATCH",
  "SCENE_RESOURCE_UNAVAILABLE",
  "SCENE_RESOURCE_INVALID",
  "SCENE_RESOURCE_SET_MISMATCH",
  "SCENE_RESOURCE_IDENTITY_MISMATCH",
  "SCENE_RESOURCE_REPRESENTATION_MISMATCH",
  "SCENE_RESOURCE_DIMENSION_MISMATCH",
  "RENDER_GRAPH_INVALID",
  "RENDER_TARGET_UNSUPPORTED",
  "RENDER_RESOURCE_LIMIT",
  "RENDER_BEGIN_FAILED",
  "RENDER_LOAD_FAILED",
  "RENDER_RESOURCE_MISMATCH",
  "RENDER_DRAW_FAILED",
  "RENDER_READBACK_UNAVAILABLE",
  "RENDER_COMMIT_FAILED",
  "RENDER_RELEASE_FAILED",
  "RENDER_DISCARD_FAILED",
  "RENDER_CANCELLED",
]);

export const DiagnosticPhaseSchema = z.enum([
  "scene-generated-catalog",
  "scene-input",
  "scene-catalog",
  "scene-lookup",
  "scene-compatibility",
  "scene-resource",
  "scene-graph",
  "render-input",
  "render-begin",
  "render-load",
  "render-draw",
  "render-commit",
  "render-cleanup",
]);

export const DiagnosticCauseSchema = z
  .object({
    kind: z.literal("domain-compatibility"),
    warning: CompatibilityWarningSchema,
  })
  .strict()
  .readonly();

const STABLE_SUBJECT_PATTERN = /^[a-z]+:[a-z0-9@.:-]+$/u;

export const RenderDiagnosticSchema = z
  .object({
    code: RenderDiagnosticCodeSchema,
    phase: DiagnosticPhaseSchema,
    subject: z.string().regex(STABLE_SUBJECT_PATTERN).optional(),
    causes: z.array(DiagnosticCauseSchema).readonly(),
  })
  .strict()
  .readonly();

export type RenderDiagnosticCode = z.infer<
  typeof RenderDiagnosticCodeSchema
>;
export type DiagnosticPhase = z.infer<typeof DiagnosticPhaseSchema>;
export type DiagnosticCause = z.infer<typeof DiagnosticCauseSchema>;
export type RenderDiagnostic = z.infer<typeof RenderDiagnosticSchema>;

export const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const compareDiagnostics = (
  left: RenderDiagnostic,
  right: RenderDiagnostic,
): number =>
  DIAGNOSTIC_PHASE_RANK[left.phase] - DIAGNOSTIC_PHASE_RANK[right.phase] ||
  compareAscii(left.code, right.code) ||
  compareAscii(left.subject ?? "", right.subject ?? "");

export const createDiagnostic = (input: {
  readonly code: RenderDiagnosticCode;
  readonly phase: DiagnosticPhase;
  readonly subject?: string;
  readonly causes?: readonly DiagnosticCause[];
}): RenderDiagnostic =>
  deepFreezeOwned(
    RenderDiagnosticSchema.parse({
      code: input.code,
      phase: input.phase,
      ...(input.subject === undefined ? {} : { subject: input.subject }),
      causes: input.causes ?? [],
    }),
  );

export const orderDiagnostics = (
  diagnostics: readonly RenderDiagnostic[],
): readonly RenderDiagnostic[] =>
  deepFreezeOwned([...diagnostics].sort(compareDiagnostics));
