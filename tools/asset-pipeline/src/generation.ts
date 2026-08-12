import { lstat, readdir, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import sharp from "sharp";

import {
  DerivativeError,
  generateDerivatives,
  postValidateDerivative,
  type DerivativeErrorCode,
} from "./derivatives.js";
import {
  GeneratedCatalogSchema,
  createGeneratedCatalog,
  type GeneratedCatalog,
  type GeneratedCatalogAsset,
  type GeneratedCatalogAssetInput,
  type GeneratorFingerprint,
} from "./generated-catalog.js";
import {
  GenerationFileError,
  acquirePublicationLock,
  assertOwnedStageForPromotion,
  assertStagePromotionParent,
  atomicallyReplaceRegularFile,
  cleanupOwnedStage,
  createOwnedStage,
  hashBytes,
  markStageReleasePromoted,
  readStableRegularFile,
  verifyExactReleaseTree,
  writeOwnedStageFile,
  type OwnedStage,
} from "./generation-fs.js";
import { compareCodePoint, toSourceRootRelativePosixPath } from "./paths.js";
import { canonicalJson, type ValidationReport } from "./report.js";
import { parseStrictJson } from "./strict-json.js";
import { validateSourceTree } from "./validation.js";

const SOURCE_PART_MAX_BYTES = 25 * 1_048_576;
export const TRANSFORM_CONTRACT_VERSION = "1.0.0" as const;

export type GenerationErrorCode = DerivativeErrorCode
  | "GENERATED_LEDGER_INVALID"
  | "GENERATED_RELEASE_INVALID"
  | "GENERATION_PUBLICATION_FAILED"
  | "PUBLISHED_VERSION_IMMUTABLE"
  | "SOURCE_CHANGED_DURING_GENERATION";

export class GenerationError extends Error {
  public constructor(
    public readonly code: GenerationErrorCode,
    public readonly exitCode: 1 | 2,
  ) {
    super(code);
    this.name = "GenerationError";
  }
}

export type GenerationPhase =
  | "STAGE_CREATED"
  | "DERIVATIVE_WRITTEN"
  | "POST_VALIDATION_COMPLETE"
  | "SOURCE_RECHECK_START"
  | "LEDGER_RESCAN_COMPLETE"
  | "RELEASE_PROMOTION_START"
  | "RELEASE_PROMOTED"
  | "ROOT_CATALOG_REPLACE_START";

export interface GenerationHooks {
  readonly onPhase?: (phase: GenerationPhase) => void | Promise<void>;
}

export interface GenerationResult {
  readonly catalog: GeneratedCatalog;
  readonly catalogBytes: Buffer;
  readonly reusedRelease: boolean;
}

const emitPhase = async (
  hooks: GenerationHooks | undefined,
  phase: GenerationPhase,
): Promise<void> => hooks?.onPhase?.(phase);

const versionValue = (key: string): string => {
  const value = Reflect.get(sharp.versions, key) as unknown;
  return typeof value === "string" ? value : "unknown";
};

export const generatorFingerprint = (): GeneratorFingerprint => ({
  transformContractVersion: TRANSFORM_CONTRACT_VERSION,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  sharp: versionValue("sharp"),
  libvips: versionValue("vips"),
});

const representationBasePath = (manifestPath: string): string =>
  path.posix.dirname(manifestPath);

const sourcePartAbsolutePath = (
  sourceRoot: string,
  sourcePath: string,
): string => {
  const absolutePath = path.resolve(sourceRoot, ...sourcePath.split("/"));
  const roundTrip = toSourceRootRelativePosixPath(sourceRoot, absolutePath);
  if (roundTrip !== sourcePath) {
    throw new GenerationError("SOURCE_CHANGED_DURING_GENERATION", 2);
  }
  return absolutePath;
};

const makeGeneratedAsset = async (input: {
  readonly sourceRoot: string;
  readonly stage: OwnedStage;
  readonly sourceAsset: ValidationReport["assets"][number];
  readonly expectedHashes: Map<string, string>;
  readonly hooks?: GenerationHooks;
}): Promise<GeneratedCatalogAssetInput> => {
  const generatedParts: GeneratedCatalogAssetInput["parts"][number][] = [];
  const basePath = representationBasePath(input.sourceAsset.manifest.path);
  for (const part of input.sourceAsset.parts) {
    let master: Buffer;
    try {
      master = await readStableRegularFile(
        sourcePartAbsolutePath(input.sourceRoot, part.sourcePath),
        SOURCE_PART_MAX_BYTES,
      );
    } catch {
      throw new GenerationError("SOURCE_CHANGED_DURING_GENERATION", 2);
    }
    if (hashBytes(master) !== part.sha256) {
      throw new GenerationError("SOURCE_CHANGED_DURING_GENERATION", 2);
    }

    let derivatives;
    try {
      derivatives = await generateDerivatives(master);
    } catch (error) {
      throw new GenerationError(
        error instanceof DerivativeError
          ? error.code
          : "DERIVATIVE_DECODE_INVALID",
        2,
      );
    }
    const runtimePath = `${basePath}/runtime/${part.role}.png`;
    const thumbnailPath = `${basePath}/thumbnail/${part.role}.png`;
    for (const [relativePath, derivative] of [
      [runtimePath, derivatives.runtime],
      [thumbnailPath, derivatives.thumbnail],
    ] as const) {
      const reopened = await writeOwnedStageFile(
        input.stage,
        relativePath,
        derivative.data,
      );
      try {
        const staged = await postValidateDerivative(reopened, derivative.kind);
        if (staged.sha256 !== derivative.sha256) {
          throw new GenerationError("GENERATED_RELEASE_INVALID", 1);
        }
      } catch (error) {
        if (error instanceof GenerationError) {
          throw error;
        }
        throw new GenerationError(
          error instanceof DerivativeError
            ? error.code
            : "GENERATED_RELEASE_INVALID",
          1,
        );
      }
      input.expectedHashes.set(relativePath, derivative.sha256);
      await emitPhase(input.hooks, "DERIVATIVE_WRITTEN");
    }

    generatedParts.push({
      role: part.role,
      source: {
        path: part.sourcePath,
        width: 2048,
        height: 3072,
        bitDepth: part.bitDepth as 8 | 16,
        colourType: 6,
        bytes: part.byteSize,
        sha256: part.sha256,
        colour: {
          kind: "png-srgb",
          srgbRenderingIntent: part.colour.srgbRenderingIntent,
          profileSha256: null,
        },
        density: null,
        alpha: part.alpha,
      },
      runtime: {
        path: runtimePath,
        width: 1024,
        height: 1536,
        bitDepth: 8,
        colourType: 6,
        bytes: derivatives.runtime.byteSize,
        sha256: derivatives.runtime.sha256,
        colour: {
          kind: "icc-srgb",
          srgbRenderingIntent: null,
          profileSha256: derivatives.runtime.profileSha256,
        },
        density: derivatives.runtime.density,
        alpha: derivatives.runtime.alpha,
      },
      thumbnail: {
        path: thumbnailPath,
        width: 320,
        height: 480,
        bitDepth: 8,
        colourType: 6,
        bytes: derivatives.thumbnail.byteSize,
        sha256: derivatives.thumbnail.sha256,
        colour: {
          kind: "icc-srgb",
          srgbRenderingIntent: null,
          profileSha256: derivatives.thumbnail.profileSha256,
        },
        density: derivatives.thumbnail.density,
        alpha: derivatives.thumbnail.alpha,
      },
    });
  }

  return {
    manifest: input.sourceAsset.manifest,
    sourceFingerprint: input.sourceAsset.sourceFingerprint,
    asset: input.sourceAsset.asset,
    technical: input.sourceAsset.technical,
    parts: generatedParts,
  };
};

const immutableLedgerEvidence = (asset: GeneratedCatalogAsset): unknown => ({
  sourceFingerprint: asset.sourceFingerprint,
  asset: asset.asset,
  technical: asset.technical,
  parts: asset.parts.map((part) => ({
    role: part.role,
    source: part.source,
    runtime: {
      path: part.runtime.path,
      width: part.runtime.width,
      height: part.runtime.height,
      bitDepth: part.runtime.bitDepth,
      colourType: part.runtime.colourType,
      colour: part.runtime.colour,
      density: part.runtime.density,
    },
    thumbnail: {
      path: part.thumbnail.path,
      width: part.thumbnail.width,
      height: part.thumbnail.height,
      bitDepth: part.thumbnail.bitDepth,
      colourType: part.thumbnail.colourType,
      colour: part.thumbnail.colour,
      density: part.thumbnail.density,
    },
  })),
});

const assetIdentity = (asset: GeneratedCatalogAsset): string =>
  `${asset.asset.id}@${asset.asset.version}`;

const readRetainedCatalogs = async (
  generatedRoot: string,
): Promise<readonly GeneratedCatalog[]> => {
  const releasesRoot = path.join(generatedRoot, "releases");
  const entries = await readdir(releasesRoot, { withFileTypes: true });
  entries.sort((left, right) => compareCodePoint(left.name, right.name));
  const catalogs: GeneratedCatalog[] = [];
  for (const entry of entries) {
    const releasePath = path.join(releasesRoot, entry.name);
    const stats = await lstat(releasePath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new GenerationError("GENERATED_LEDGER_INVALID", 1);
    }
    let bytes: Buffer;
    try {
      bytes = await readStableRegularFile(path.join(releasePath, "catalog.json"));
    } catch {
      throw new GenerationError("GENERATED_LEDGER_INVALID", 1);
    }
    let catalog: GeneratedCatalog;
    try {
      catalog = GeneratedCatalogSchema.parse(
        parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
    } catch {
      throw new GenerationError("GENERATED_LEDGER_INVALID", 1);
    }
    if (catalog.releaseId !== entry.name) {
      throw new GenerationError("GENERATED_LEDGER_INVALID", 1);
    }
    catalogs.push(catalog);
  }
  return catalogs;
};

const assertImmutableLedger = (
  retained: readonly GeneratedCatalog[],
  next: GeneratedCatalog,
): void => {
  const previousByIdentity = new Map<string, string>();
  for (const catalog of retained) {
    for (const asset of catalog.assets) {
      const identity = assetIdentity(asset);
      const evidence = canonicalJson(immutableLedgerEvidence(asset));
      const prior = previousByIdentity.get(identity);
      if (prior !== undefined && prior !== evidence) {
        throw new GenerationError("GENERATED_LEDGER_INVALID", 1);
      }
      previousByIdentity.set(identity, evidence);
    }
  }
  for (const asset of next.assets) {
    const prior = previousByIdentity.get(assetIdentity(asset));
    if (
      prior !== undefined &&
      prior !== canonicalJson(immutableLedgerEvidence(asset))
    ) {
      throw new GenerationError("PUBLISHED_VERSION_IMMUTABLE", 2);
    }
  }
};

const sameReport = (
  initialBytes: Buffer,
  current: ValidationReport,
): boolean => current.ok && initialBytes.equals(Buffer.from(canonicalJson(current)));

const assertSourceReportUnchanged = async (
  sourceRoot: string,
  initialReportBytes: Buffer,
): Promise<void> => {
  const currentReport = await validateSourceTree(sourceRoot);
  if (!sameReport(initialReportBytes, currentReport)) {
    throw new GenerationError("SOURCE_CHANGED_DURING_GENERATION", 2);
  }
};

/**
 * Generate, verify, and publish one immutable target-aware release.
 */
export const generateAssetRelease = async (input: {
  readonly sourceRoot: string;
  readonly generatedRoot: string;
  readonly report: ValidationReport;
  readonly hooks?: GenerationHooks;
}): Promise<GenerationResult> => {
  if (!input.report.ok) {
    throw new GenerationError("SOURCE_CHANGED_DURING_GENERATION", 2);
  }
  const initialReportBytes = Buffer.from(canonicalJson(input.report));
  const sourceReport = {
    schemaVersion: input.report.schemaVersion,
    sha256: hashBytes(initialReportBytes),
  } as const;
  const stage = await createOwnedStage(input.generatedRoot);
  let publicationLock: Awaited<ReturnType<typeof acquirePublicationLock>> | undefined;
  let reusedRelease = false;
  let result: GenerationResult | undefined;
  let failure: unknown;
  try {
    await emitPhase(input.hooks, "STAGE_CREATED");
    const expectedHashes = new Map<string, string>();
    const assets: GeneratedCatalogAssetInput[] = [];
    for (const sourceAsset of input.report.assets) {
      assets.push(
        await makeGeneratedAsset({
          sourceRoot: input.sourceRoot,
          stage,
          sourceAsset,
          expectedHashes,
          ...(input.hooks === undefined ? {} : { hooks: input.hooks }),
        }),
      );
    }
    await emitPhase(input.hooks, "POST_VALIDATION_COMPLETE");

    const catalog = createGeneratedCatalog({
      generator: generatorFingerprint(),
      sourceReport,
      assets,
    });
    const catalogBytes = Buffer.from(canonicalJson(catalog));
    const reopenedCatalog = await writeOwnedStageFile(
      stage,
      "catalog.json",
      catalogBytes,
    );
    try {
      const parsedCatalog = GeneratedCatalogSchema.parse(
        parseStrictJson(
          new TextDecoder("utf-8", { fatal: true }).decode(reopenedCatalog),
        ),
      );
      if (
        !reopenedCatalog.equals(catalogBytes) ||
        canonicalJson(parsedCatalog) !== catalogBytes.toString("utf8")
      ) {
        throw new GenerationError("GENERATED_RELEASE_INVALID", 1);
      }
    } catch (error) {
      throw error instanceof GenerationError
        ? error
        : new GenerationError("GENERATED_RELEASE_INVALID", 1);
    }
    expectedHashes.set("catalog.json", hashBytes(catalogBytes));

    publicationLock = await acquirePublicationLock(stage.generatedRoot);
    await emitPhase(input.hooks, "SOURCE_RECHECK_START");
    await assertSourceReportUnchanged(input.sourceRoot, initialReportBytes);

    await assertStagePromotionParent(stage);
    const retained = await readRetainedCatalogs(stage.generatedRoot);
    await assertStagePromotionParent(stage);
    assertImmutableLedger(retained, catalog);
    await emitPhase(input.hooks, "LEDGER_RESCAN_COMPLETE");

    const publishedReleasePath = path.join(stage.releasesPath, catalog.releaseId);
    await assertStagePromotionParent(stage);
    await emitPhase(input.hooks, "RELEASE_PROMOTION_START");
    // This is deliberately the last source read before staged-tree
    // verification and promotion. It closes mutations during the ledger scan
    // and in the final pre-promotion hook.
    await assertSourceReportUnchanged(input.sourceRoot, initialReportBytes);
    await assertOwnedStageForPromotion(stage);
    await verifyExactReleaseTree(stage.releasePath, expectedHashes);
    await assertOwnedStageForPromotion(stage);
    await assertStagePromotionParent(stage);
    const existing = await lstat(publishedReleasePath).catch((error: unknown) => {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    if (existing === undefined) {
      await assertStagePromotionParent(stage);
      const racedExisting = await lstat(publishedReleasePath).catch(
        (error: unknown) => {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? error.code
              : undefined;
          if (code === "ENOENT") {
            return undefined;
          }
          throw error;
        },
      );
      if (racedExisting === undefined) {
        await rename(stage.releasePath, publishedReleasePath);
        markStageReleasePromoted(stage);
        await verifyExactReleaseTree(publishedReleasePath, expectedHashes);
        await assertStagePromotionParent(stage);
        await emitPhase(input.hooks, "RELEASE_PROMOTED");
      } else {
        await verifyExactReleaseTree(publishedReleasePath, expectedHashes);
        reusedRelease = true;
      }
    } else {
      await assertStagePromotionParent(stage);
      await verifyExactReleaseTree(publishedReleasePath, expectedHashes);
      await assertStagePromotionParent(stage);
      reusedRelease = true;
    }

    await emitPhase(input.hooks, "ROOT_CATALOG_REPLACE_START");
    await atomicallyReplaceRegularFile(
      stage.generatedRoot,
      path.join(stage.generatedRoot, "catalog.json"),
      catalogBytes,
    );
    result = { catalog, catalogBytes, reusedRelease };
  } catch (error) {
    if (error instanceof GenerationError || error instanceof GenerationFileError) {
      failure = error;
    } else {
      failure = new GenerationError("GENERATION_PUBLICATION_FAILED", 1);
    }
  }
  try {
    await publicationLock?.release();
  } catch (lockError) {
    failure ??= lockError;
  }
  try {
    await cleanupOwnedStage(stage);
  } catch (cleanupError) {
    failure = cleanupError;
  }
  if (failure !== undefined) {
    throw failure;
  }
  if (result === undefined) {
    throw new GenerationError("GENERATION_PUBLICATION_FAILED", 1);
  }
  return result;
};
