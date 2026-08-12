import { AssetSchema } from "@editorial-doll/domain";
import { z } from "zod";

import { parseStrictJson } from "./strict-json.js";

const EdgeSchema = z.enum(["top", "right", "bottom", "left"]);

export type Edge = z.infer<typeof EdgeSchema>;

const maximumCoordinateByEdge: Readonly<Record<Edge, number>> = Object.freeze({
  top: 2047,
  right: 3071,
  bottom: 2047,
  left: 3071,
});

export const EdgeGuardExceptionSchema = z
  .object({
    edge: EdgeSchema,
    startInclusive: z.number().int().nonnegative(),
    endInclusive: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((exception, context) => {
    if (exception.startInclusive > exception.endInclusive) {
      context.addIssue({
        code: "custom",
        message: "startInclusive must not exceed endInclusive.",
        path: ["startInclusive"],
      });
    }

    const maximum = maximumCoordinateByEdge[exception.edge];
    if (exception.endInclusive > maximum) {
      context.addIssue({
        code: "custom",
        message: `The ${exception.edge} edge supports coordinates through ${maximum}.`,
        path: ["endInclusive"],
      });
    }
  })
  .readonly();

export type EdgeGuardException = z.infer<typeof EdgeGuardExceptionSchema>;

export const AssetTechnicalSchema = z
  .object({
    edgeGuardExceptions: z.array(EdgeGuardExceptionSchema).readonly(),
  })
  .strict()
  .readonly();

export type AssetTechnical = z.infer<typeof AssetTechnicalSchema>;

export const AssetSourceEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    asset: AssetSchema,
    technical: AssetTechnicalSchema,
  })
  .strict()
  .readonly();

export type AssetSourceEnvelope = z.infer<typeof AssetSourceEnvelopeSchema>;

export const parseAssetSourceEnvelope = (input: unknown): AssetSourceEnvelope =>
  AssetSourceEnvelopeSchema.parse(input);

export const parseAssetSourceEnvelopeJson = (
  source: string,
): AssetSourceEnvelope => parseAssetSourceEnvelope(parseStrictJson(source));
