import { createHash } from "node:crypto";

import {
  AssetSchema,
  LayerRoleSchema,
  type Asset,
} from "@editorial-doll/domain";
import { z } from "zod";

import { type AssetTechnical, AssetTechnicalSchema } from "./manifest.js";
import { compareCodePoint } from "./paths.js";

export const GENERATED_CATALOG_SCHEMA_VERSION = "1.0.0" as const;
export const DECODED_REPORT_SCHEMA_VERSION = "2.0.0" as const;

const MASTER_WIDTH = 2048;
const MASTER_HEIGHT = 3072;
const RUNTIME_WIDTH = 1024;
const RUNTIME_HEIGHT = 1536;
const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 480;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const portablePath = (value: string): boolean => {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\")
  ) {
    return false;
  }
  return value.split("/").every((segment) =>
    segment !== "" && segment !== "." && segment !== "..",
  );
};

const PortableRelativePathSchema = z
  .string()
  .refine(portablePath, "Expected a portable relative POSIX path.");
const Sha256Schema = z
  .string()
  .regex(SHA256_PATTERN, "Expected a lowercase SHA-256 hash.");
const NonNegativeIntegerSchema = z.number().int().nonnegative();

export const GeneratorFingerprintSchema = z
  .object({
    transformContractVersion: z.string().min(1),
    node: z.string().min(1),
    platform: z.string().min(1),
    arch: z.string().min(1),
    sharp: z.string().min(1),
    libvips: z.string().min(1),
  })
  .strict()
  .readonly();

export type GeneratorFingerprint = z.infer<typeof GeneratorFingerprintSchema>;

export const SourceReportSchema = z
  .object({
    schemaVersion: z.literal(DECODED_REPORT_SCHEMA_VERSION),
    sha256: Sha256Schema,
  })
  .strict()
  .readonly();

export type SourceReport = z.infer<typeof SourceReportSchema>;

const createNonZeroBoundsSchema = (width: number, height: number) =>
  z
    .object({
      minX: NonNegativeIntegerSchema.max(width - 1),
      minY: NonNegativeIntegerSchema.max(height - 1),
      maxX: NonNegativeIntegerSchema.max(width - 1),
      maxY: NonNegativeIntegerSchema.max(height - 1),
    })
    .strict()
    .superRefine((bounds, context) => {
      if (bounds.minX > bounds.maxX) {
        context.addIssue({
          code: "custom",
          path: ["minX"],
          message: "minX must not exceed maxX.",
        });
      }
      if (bounds.minY > bounds.maxY) {
        context.addIssue({
          code: "custom",
          path: ["minY"],
          message: "minY must not exceed maxY.",
        });
      }
    })
    .readonly();

const NonZeroBoundsSchema = createNonZeroBoundsSchema(MASTER_WIDTH, MASTER_HEIGHT);

export type NonZeroBounds = z.infer<typeof NonZeroBoundsSchema>;

const createDerivativeAlphaEvidenceSchema = (width: number, height: number) =>
  z
    .object({
      transparentPixels: NonNegativeIntegerSchema,
      translucentPixels: NonNegativeIntegerSchema,
      opaquePixels: NonNegativeIntegerSchema,
      nonZeroBounds: createNonZeroBoundsSchema(width, height).nullable(),
    })
    .strict()
    .superRefine((alpha, context) => {
      const pixelCount =
        alpha.transparentPixels + alpha.translucentPixels + alpha.opaquePixels;
      if (pixelCount !== width * height) {
        context.addIssue({
          code: "custom",
          message: "Alpha counts must equal the representation pixel count.",
        });
      }
      const visiblePixels = alpha.translucentPixels + alpha.opaquePixels;
      if (visiblePixels === 0 && alpha.nonZeroBounds !== null) {
        context.addIssue({
          code: "custom",
          path: ["nonZeroBounds"],
          message: "Fully transparent images must have null nonZeroBounds.",
        });
      }
      if (visiblePixels > 0 && alpha.nonZeroBounds === null) {
        context.addIssue({
          code: "custom",
          path: ["nonZeroBounds"],
          message: "Visible images must report nonZeroBounds.",
        });
      }
    })
    .readonly();

const RuntimeAlphaEvidenceSchema = createDerivativeAlphaEvidenceSchema(
  RUNTIME_WIDTH,
  RUNTIME_HEIGHT,
);
const ThumbnailAlphaEvidenceSchema = createDerivativeAlphaEvidenceSchema(
  THUMBNAIL_WIDTH,
  THUMBNAIL_HEIGHT,
);

export type CatalogDerivativeAlphaEvidence = z.infer<
  typeof RuntimeAlphaEvidenceSchema | typeof ThumbnailAlphaEvidenceSchema
>;

const SourceAlphaEvidenceSchema = z
  .object({
    transparentPixels: NonNegativeIntegerSchema,
    translucentPixels: NonNegativeIntegerSchema,
    opaquePixels: NonNegativeIntegerSchema,
    nonZeroBounds: NonZeroBoundsSchema.nullable(),
    edgeGuardViolations: NonNegativeIntegerSchema,
    edgeGuardExceptedPixels: NonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((alpha, context) => {
    const pixelCount =
      alpha.transparentPixels + alpha.translucentPixels + alpha.opaquePixels;
    if (pixelCount !== MASTER_WIDTH * MASTER_HEIGHT) {
      context.addIssue({
        code: "custom",
        message: "Source alpha counts must equal the master pixel count.",
      });
    }
    const visiblePixels = alpha.translucentPixels + alpha.opaquePixels;
    if (visiblePixels === 0 && alpha.nonZeroBounds !== null) {
      context.addIssue({
        code: "custom",
        path: ["nonZeroBounds"],
        message: "Fully transparent images must have null nonZeroBounds.",
      });
    }
    if (visiblePixels > 0 && alpha.nonZeroBounds === null) {
      context.addIssue({
        code: "custom",
        path: ["nonZeroBounds"],
        message: "Visible images must report nonZeroBounds.",
      });
    }
  })
  .readonly();

export type SourceAlphaEvidence = z.infer<typeof SourceAlphaEvidenceSchema>;

const SourceColourSchema = z
  .object({
    kind: z.literal("png-srgb"),
    srgbRenderingIntent: z.number().int().min(0).max(3),
    profileSha256: z.null(),
  })
  .strict()
  .readonly();

const DerivativeColourSchema = z
  .object({
    kind: z.literal("icc-srgb"),
    srgbRenderingIntent: z.null(),
    profileSha256: Sha256Schema,
  })
  .strict()
  .readonly();

const DerivativeDensitySchema = z
  .object({
    xPixelsPerMeter: z.literal(1000),
    yPixelsPerMeter: z.literal(1000),
    unit: z.literal("metre"),
  })
  .strict()
  .readonly();

const SourceRepresentationSchema = z
  .object({
    path: PortableRelativePathSchema,
    width: z.literal(MASTER_WIDTH),
    height: z.literal(MASTER_HEIGHT),
    bitDepth: z.union([z.literal(8), z.literal(16)]),
    colourType: z.literal(6),
    bytes: NonNegativeIntegerSchema,
    sha256: Sha256Schema,
    colour: SourceColourSchema,
    density: z.null(),
    alpha: SourceAlphaEvidenceSchema,
  })
  .strict()
  .readonly();

const RuntimeRepresentationSchema = z
  .object({
    path: PortableRelativePathSchema,
    width: z.literal(RUNTIME_WIDTH),
    height: z.literal(RUNTIME_HEIGHT),
    bitDepth: z.literal(8),
    colourType: z.literal(6),
    bytes: NonNegativeIntegerSchema.max(4 * 1_048_576),
    sha256: Sha256Schema,
    colour: DerivativeColourSchema,
    density: DerivativeDensitySchema,
    alpha: RuntimeAlphaEvidenceSchema,
  })
  .strict()
  .readonly();

const ThumbnailRepresentationSchema = z
  .object({
    path: PortableRelativePathSchema,
    width: z.literal(THUMBNAIL_WIDTH),
    height: z.literal(THUMBNAIL_HEIGHT),
    bitDepth: z.literal(8),
    colourType: z.literal(6),
    bytes: NonNegativeIntegerSchema.max(600 * 1024),
    sha256: Sha256Schema,
    colour: DerivativeColourSchema,
    density: DerivativeDensitySchema,
    alpha: ThumbnailAlphaEvidenceSchema,
  })
  .strict()
  .readonly();

const GeneratedPartSchema = z
  .object({
    role: LayerRoleSchema,
    source: SourceRepresentationSchema,
    runtime: RuntimeRepresentationSchema,
    thumbnail: ThumbnailRepresentationSchema,
  })
  .strict()
  .readonly();

export type GeneratedPart = z.infer<typeof GeneratedPartSchema>;

const ManifestEvidenceSchema = z
  .object({
    path: PortableRelativePathSchema.refine(
      (value) => value.endsWith("manifest.json"),
      "Expected a manifest.json path.",
    ),
    sha256: Sha256Schema,
  })
  .strict()
  .readonly();

export const VisualQaRequirementSchema = z.enum([
  "BACKGROUND_OPACITY_INTENT",
  "MATTE_CONTAMINATION",
  "SEMANTIC_CROP",
  "SPLIT_LAYER_SEAMS",
  "STRAIGHT_ALPHA_PROVENANCE",
]);

export type VisualQaRequirement = z.infer<typeof VisualQaRequirementSchema>;

const VisualQaRequirementsSchema = z
  .array(VisualQaRequirementSchema)
  .readonly();

const GeneratedCatalogAssetInputBaseSchema = z
  .object({
    manifest: ManifestEvidenceSchema,
    sourceFingerprint: Sha256Schema,
    asset: AssetSchema,
    technical: AssetTechnicalSchema,
    parts: z.array(GeneratedPartSchema).min(1).readonly(),
  })
  .strict();

export const GeneratedCatalogAssetInputSchema =
  GeneratedCatalogAssetInputBaseSchema.readonly();

export type GeneratedCatalogAssetInput = z.infer<
  typeof GeneratedCatalogAssetInputSchema
>;

const GeneratedCatalogAssetSchema = GeneratedCatalogAssetInputBaseSchema.extend({
  visualQaRequired: VisualQaRequirementsSchema,
})
  .strict()
  .readonly();

export type GeneratedCatalogAsset = z.infer<typeof GeneratedCatalogAssetSchema>;

const compareAssetIdentity = (
  left: Pick<GeneratedCatalogAsset, "asset">,
  right: Pick<GeneratedCatalogAsset, "asset">,
): number =>
  compareCodePoint(left.asset.id, right.asset.id) ||
  compareCodePoint(left.asset.version, right.asset.version);

const compareGeneratedParts = (
  left: Pick<GeneratedPart, "role">,
  right: Pick<GeneratedPart, "role">,
): number => compareCodePoint(left.role, right.role);

const sameStringArray = (
  left: readonly string[],
  right: readonly string[],
): boolean => left.length === right.length && left.every((item, index) => item === right[index]);

/** Returns the complete, ordered set of visual checks that pixels cannot prove. */
export const deriveVisualQaRequired = (
  asset: Pick<Asset, "slot" | "parts">,
): readonly VisualQaRequirement[] => {
  const requirements = new Set<VisualQaRequirement>([
    "STRAIGHT_ALPHA_PROVENANCE",
    "MATTE_CONTAMINATION",
    "SEMANTIC_CROP",
  ]);
  if (asset.parts.length > 1) {
    requirements.add("SPLIT_LAYER_SEAMS");
  }
  if (asset.slot === "background") {
    requirements.add("BACKGROUND_OPACITY_INTENT");
  }
  return Object.freeze([...requirements].sort(compareCodePoint));
};

export interface ReleaseIdentityDerivative {
  readonly path: string;
  readonly sha256: string;
}

export interface ReleaseIdentityDescriptor {
  readonly sourceReportSha256: string;
  readonly transformContractVersion: string;
  readonly generator: GeneratorFingerprint;
  readonly derivatives: readonly ReleaseIdentityDerivative[];
}

const orderedDerivativeFacts = (
  assets: readonly GeneratedCatalogAsset[],
): readonly ReleaseIdentityDerivative[] =>
  Object.freeze(
    assets.flatMap((asset) =>
      asset.parts.flatMap((part) => [
        { path: part.runtime.path, sha256: part.runtime.sha256 },
        { path: part.thumbnail.path, sha256: part.thumbnail.sha256 },
      ]),
    ),
  );

/**
 * Creates the release-id input. It deliberately has no releaseId or
 * releasePath field, avoiding a self-referential release identity.
 */
export const createReleaseIdentityDescriptor = (input: {
  readonly sourceReport: SourceReport;
  readonly generator: GeneratorFingerprint;
  readonly assets: readonly GeneratedCatalogAsset[];
}): ReleaseIdentityDescriptor =>
  Object.freeze({
    sourceReportSha256: input.sourceReport.sha256,
    transformContractVersion: input.generator.transformContractVersion,
    generator: input.generator,
    derivatives: orderedDerivativeFacts(input.assets),
  });

export const canonicalReleaseIdentity = (
  descriptor: ReleaseIdentityDescriptor,
): string => `${JSON.stringify(descriptor, undefined, 2)}\n`;

export const createReleaseId = (input: {
  readonly sourceReport: SourceReport;
  readonly generator: GeneratorFingerprint;
  readonly assets: readonly GeneratedCatalogAsset[];
}): string =>
  createHash("sha256")
    .update(canonicalReleaseIdentity(createReleaseIdentityDescriptor(input)))
    .digest("hex");

export const GeneratedCatalogSchema = z
  .object({
    schemaVersion: z.literal(GENERATED_CATALOG_SCHEMA_VERSION),
    releaseId: Sha256Schema,
    releasePath: PortableRelativePathSchema,
    generator: GeneratorFingerprintSchema,
    sourceReport: SourceReportSchema,
    assets: z.array(GeneratedCatalogAssetSchema).readonly(),
  })
  .strict()
  .superRefine((catalog, context) => {
    const expectedReleasePath = `releases/${catalog.releaseId}`;
    if (catalog.releasePath !== expectedReleasePath) {
      context.addIssue({
        code: "custom",
        path: ["releasePath"],
        message: "releasePath must equal releases/<releaseId>.",
      });
    }

    const orderedAssets = [...catalog.assets].sort(compareAssetIdentity);
    if (!sameStringArray(
      catalog.assets.map((asset) => `${asset.asset.id}@${asset.asset.version}`),
      orderedAssets.map((asset) => `${asset.asset.id}@${asset.asset.version}`),
    )) {
      context.addIssue({
        code: "custom",
        path: ["assets"],
        message: "Assets must use code-point identity ordering.",
      });
    }

    for (const [assetIndex, entry] of catalog.assets.entries()) {
      const expectedQa = deriveVisualQaRequired(entry.asset);
      if (!sameStringArray(entry.visualQaRequired, expectedQa)) {
        context.addIssue({
          code: "custom",
          path: ["assets", assetIndex, "visualQaRequired"],
          message: "visualQaRequired must equal the deterministic rule-derived set.",
        });
      }

      const orderedParts = [...entry.parts].sort(compareGeneratedParts);
      if (!sameStringArray(
        entry.parts.map((part) => part.role),
        orderedParts.map((part) => part.role),
      )) {
        context.addIssue({
          code: "custom",
          path: ["assets", assetIndex, "parts"],
          message: "Parts must use code-point role ordering.",
        });
      }

      const assetRoles = [...entry.asset.parts]
        .map((part) => part.role)
        .sort(compareCodePoint);
      const generatedRoles = orderedParts.map((part) => part.role);
      if (!sameStringArray(assetRoles, generatedRoles)) {
        context.addIssue({
          code: "custom",
          path: ["assets", assetIndex, "parts"],
          message: "Generated parts must exactly match the asset layer roles.",
        });
      }

      for (const [partIndex, part] of entry.parts.entries()) {
        for (const [kind, representation] of [
          ["runtime", part.runtime],
          ["thumbnail", part.thumbnail],
        ] as const) {
          if (
            representation.path.startsWith("releases/") ||
            representation.path.includes(catalog.releaseId)
          ) {
            context.addIssue({
              code: "custom",
              path: ["assets", assetIndex, "parts", partIndex, kind, "path"],
              message: "Derivative paths must be release-relative and cannot contain releaseId.",
            });
          }
        }
      }
    }

    const expectedReleaseId = createReleaseId(catalog);
    if (catalog.releaseId !== expectedReleaseId) {
      context.addIssue({
        code: "custom",
        path: ["releaseId"],
        message: "releaseId must hash the canonical non-self-referential descriptor.",
      });
    }
  })
  .readonly();

export type GeneratedCatalog = z.infer<typeof GeneratedCatalogSchema>;

export const createGeneratedCatalog = (input: {
  readonly generator: GeneratorFingerprint;
  readonly sourceReport: SourceReport;
  readonly assets: readonly GeneratedCatalogAssetInput[];
}): GeneratedCatalog => {
  const assets = input.assets
    .map((asset) => ({
      ...asset,
      parts: [...asset.parts].sort(compareGeneratedParts),
      visualQaRequired: deriveVisualQaRequired(asset.asset),
    }))
    .sort(compareAssetIdentity);
  const releaseId = createReleaseId({
    sourceReport: input.sourceReport,
    generator: input.generator,
    assets,
  });

  return GeneratedCatalogSchema.parse({
    schemaVersion: GENERATED_CATALOG_SCHEMA_VERSION,
    releaseId,
    releasePath: `releases/${releaseId}`,
    generator: input.generator,
    sourceReport: input.sourceReport,
    assets,
  });
};

export type GeneratedCatalogTechnical = AssetTechnical;
