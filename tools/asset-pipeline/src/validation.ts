import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { AssetSchema, type Asset, type AssetPart } from "@editorial-doll/domain";
import type { ZodError } from "zod";

import {
  AssetDiscoveryError,
  discoverSourceFiles,
} from "./discovery.js";
import {
  AssetSourceEnvelopeSchema,
  AssetTechnicalSchema,
  type AssetSourceEnvelope,
  type AssetTechnical,
} from "./manifest.js";
import {
  DecodedPngError,
  assertDecodedSourcePngAccepted,
  inspectDecodedSourcePng,
} from "./decoded-png.js";
import {
  AssetPathError,
  assertPortableRelativePngPath,
  compareCodePoint,
  resolveContainedSourceFile,
  toSourceRootRelativePosixPath,
} from "./paths.js";
import { inspectPortablePng, PngStructureError } from "./png.js";
import {
  REPORT_SCHEMA_VERSION,
  canonicalJson,
  orderDiagnostics,
  type InspectedSourcePart,
  type ValidatedSourceAsset,
  type ValidationDiagnostic,
  type ValidationReport,
} from "./report.js";
import { StrictJsonError, parseStrictJson } from "./strict-json.js";

const MEBIBYTE = 1_048_576;
const MAX_MANIFEST_BYTES = MEBIBYTE;
const MAX_SOURCE_PART_BYTES = 25 * MEBIBYTE;
const MAX_SOURCE_ASSET_BYTES = 50 * MEBIBYTE;

type StableFileErrorCode =
  | "FILE_SIZE_EXCEEDED"
  | "FILE_NOT_REGULAR"
  | "FILE_CHANGED_DURING_READ"
  | "FILE_UNREADABLE";

class StableFileError extends Error {
  public constructor(
    public readonly code: StableFileErrorCode,
    public readonly byteSize: number,
  ) {
    super(code);
    this.name = "StableFileError";
  }
}

interface StableFileRead {
  readonly bytes: Uint8Array;
  readonly byteSize: number;
}

const openReadOnlyNoFollow = (): string | number => {
  const noFollow = Reflect.get(constants, "O_NOFOLLOW") as unknown;
  return typeof noFollow === "number"
    ? constants.O_RDONLY | noFollow
    : "r";
};

const readStableFile = async (
  filePath: string,
  maximumBytes: number,
): Promise<StableFileRead> => {
  let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fileHandle = await open(filePath, openReadOnlyNoFollow());
    const initialStats = await fileHandle.stat();
    if (!initialStats.isFile()) {
      throw new StableFileError("FILE_NOT_REGULAR", initialStats.size);
    }
    if (initialStats.size > maximumBytes) {
      throw new StableFileError("FILE_SIZE_EXCEEDED", initialStats.size);
    }

    const buffer = Buffer.allocUnsafe(initialStats.size + 1);
    let totalBytesRead = 0;
    while (totalBytesRead < buffer.length) {
      const result = await fileHandle.read(
        buffer,
        totalBytesRead,
        buffer.length - totalBytesRead,
        totalBytesRead,
      );
      if (result.bytesRead === 0) {
        break;
      }
      totalBytesRead += result.bytesRead;
    }

    const [finalStats, finalPathStats] = await Promise.all([
      fileHandle.stat(),
      lstat(filePath),
    ]);
    if (
      finalPathStats.isSymbolicLink() ||
      !finalPathStats.isFile() ||
      initialStats.dev !== finalStats.dev ||
      initialStats.ino !== finalStats.ino ||
      initialStats.dev !== finalPathStats.dev ||
      initialStats.ino !== finalPathStats.ino ||
      initialStats.size !== finalStats.size ||
      initialStats.size !== finalPathStats.size ||
      initialStats.mtimeMs !== finalStats.mtimeMs ||
      initialStats.ctimeMs !== finalStats.ctimeMs ||
      totalBytesRead !== initialStats.size
    ) {
      throw new StableFileError(
        "FILE_CHANGED_DURING_READ",
        Math.max(initialStats.size, finalStats.size, totalBytesRead),
      );
    }

    return {
      bytes: buffer.subarray(0, totalBytesRead),
      byteSize: totalBytesRead,
    };
  } catch (error) {
    if (error instanceof StableFileError) {
      throw error;
    }
    throw new StableFileError("FILE_UNREADABLE", 0);
  } finally {
    await fileHandle?.close();
  }
};

const errorDiagnostic = (
  code: string,
  reportPath: string,
  message: string,
): ValidationDiagnostic => ({
  code,
  severity: "error",
  path: reportPath,
  message,
});

const referenceKey = (value: {
  readonly id: string;
  readonly version: string;
}): string => `${value.id}@${value.version}`;

const compareReferences = (
  left: { readonly id: string; readonly version: string },
  right: { readonly id: string; readonly version: string },
): number => compareCodePoint(referenceKey(left), referenceKey(right));

const canonicalAsset = (asset: Asset): Asset =>
  AssetSchema.parse({
    ...asset,
    tags: [...asset.tags].sort(compareCodePoint),
    parts: [...asset.parts].sort(
      (left, right) =>
        compareCodePoint(left.role, right.role) ||
        compareCodePoint(left.id, right.id) ||
        compareCodePoint(left.sourcePath, right.sourcePath),
    ),
    compatibility: {
      compatibleMuses: [...asset.compatibility.compatibleMuses].sort(
        compareReferences,
      ),
      requiresActiveTags: [
        ...asset.compatibility.requiresActiveTags,
      ].sort(compareCodePoint),
      excludesActiveTags: [...asset.compatibility.excludesActiveTags].sort(
        compareCodePoint,
      ),
      incompatibleAssets: [
        ...asset.compatibility.incompatibleAssets,
      ].sort(compareReferences),
    },
  });

const canonicalTechnical = (technical: AssetTechnical): AssetTechnical =>
  AssetTechnicalSchema.parse({
    edgeGuardExceptions: [...technical.edgeGuardExceptions].sort(
      (left, right) =>
        compareCodePoint(left.edge, right.edge) ||
        left.startInclusive - right.startInclusive ||
        left.endInclusive - right.endInclusive ||
        compareCodePoint(left.reason, right.reason),
    ),
  });

const canonicalAssetOrder = (
  left: ValidatedSourceAsset,
  right: ValidatedSourceAsset,
): number =>
  compareReferences(left.reference, right.reference) ||
  compareCodePoint(left.manifest.path, right.manifest.path);

const makeReport = (
  manifestCount: number,
  assets: readonly ValidatedSourceAsset[],
  diagnostics: readonly ValidationDiagnostic[],
): ValidationReport => {
  const orderedDiagnostics = orderDiagnostics(diagnostics);
  const orderedAssets = [...assets].sort(canonicalAssetOrder);
  const parts = orderedAssets.reduce(
    (total, asset) => total + asset.parts.length,
    0,
  );

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    ok: orderedDiagnostics.length === 0,
    summary: {
      manifests: manifestCount,
      assets: orderedAssets.length,
      parts,
      errors: orderedDiagnostics.length,
    },
    assets: orderedAssets,
    diagnostics: orderedDiagnostics,
  };
};

const sourcePathFromInput = (
  input: unknown,
  partIndex: number,
): unknown => {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const asset = Reflect.get(input, "asset") as unknown;
  if (typeof asset !== "object" || asset === null) {
    return undefined;
  }
  const parts = Reflect.get(asset, "parts") as unknown;
  if (!Array.isArray(parts)) {
    return undefined;
  }
  const part = parts[partIndex] as unknown;
  return typeof part === "object" && part !== null
    ? Reflect.get(part, "sourcePath")
    : undefined;
};

const zodDiagnosticCode = (error: ZodError, input: unknown): string => {
  const firstPath = error.issues[0]?.path.map(String) ?? [];
  if (firstPath[0] === "schemaVersion") {
    return "MANIFEST_VERSION_UNSUPPORTED";
  }
  if (firstPath[0] === "technical") {
    return "TECHNICAL_SCHEMA_INVALID";
  }
  if (firstPath[0] === "asset" && firstPath[1] === "id") {
    return "ASSET_ID_INVALID";
  }
  if (firstPath[0] === "asset" && firstPath[1] === "version") {
    return "ASSET_VERSION_INVALID";
  }
  if (
    firstPath[0] === "asset" &&
    firstPath[1] === "parts" &&
    firstPath[3] === "sourcePath"
  ) {
    const partIndex = Number(firstPath[2]);
    const sourcePath = sourcePathFromInput(input, partIndex);
    if (typeof sourcePath === "string") {
      try {
        assertPortableRelativePngPath(sourcePath);
      } catch (pathError) {
        if (pathError instanceof AssetPathError) {
          return pathError.code;
        }
      }
    }
  }
  if (firstPath[0] === "asset") {
    return "ASSET_SCHEMA_INVALID";
  }
  return "MANIFEST_SCHEMA_INVALID";
};

interface ReadEnvelopeResult {
  readonly envelope: AssetSourceEnvelope;
  readonly sha256: string;
}

const readEnvelope = async (
  manifestPath: string,
  reportPath: string,
  diagnostics: ValidationDiagnostic[],
): Promise<ReadEnvelopeResult | undefined> => {
  let manifestBytes: StableFileRead;
  try {
    manifestBytes = await readStableFile(manifestPath, MAX_MANIFEST_BYTES);
  } catch (error) {
    const code =
      error instanceof StableFileError && error.code === "FILE_SIZE_EXCEEDED"
        ? "MANIFEST_SIZE_EXCEEDED"
        : error instanceof StableFileError &&
            error.code === "FILE_CHANGED_DURING_READ"
          ? "MANIFEST_CHANGED_DURING_VALIDATION"
          : "MANIFEST_UNREADABLE";
    diagnostics.push(
      errorDiagnostic(
        code,
        reportPath,
        "The source manifest could not be read.",
      ),
    );
    return undefined;
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(
      manifestBytes.bytes,
    );
  } catch {
    diagnostics.push(
      errorDiagnostic(
        "MANIFEST_UTF8_INVALID",
        reportPath,
        "The source manifest must contain valid UTF-8 JSON.",
      ),
    );
    return undefined;
  }

  let input: unknown;
  try {
    input = parseStrictJson(source);
  } catch (error) {
    const code =
      error instanceof StrictJsonError ? error.code : "JSON_INVALID";
    diagnostics.push(
      errorDiagnostic(code, reportPath, "The source manifest is not strict JSON."),
    );
    return undefined;
  }

  const result = AssetSourceEnvelopeSchema.safeParse(input);
  if (!result.success) {
    diagnostics.push(
      errorDiagnostic(
        zodDiagnosticCode(result.error, input),
        reportPath,
        "The source manifest does not satisfy the supported envelope schema.",
      ),
    );
    return undefined;
  }
  return {
    envelope: result.data,
    sha256: createHash("sha256").update(manifestBytes.bytes).digest("hex"),
  };
};

const layoutDiagnostics = (
  manifestPath: string,
  envelope: AssetSourceEnvelope,
): readonly ValidationDiagnostic[] => {
  const segments = manifestPath.split("/");
  if (segments.length !== 5 || segments[4] !== "manifest.json") {
    return [
      errorDiagnostic(
        "MANIFEST_LAYOUT_INVALID",
        manifestPath,
        "The manifest must use the documented five-segment source layout.",
      ),
    ];
  }

  const [scope, slot, id, version] = segments;
  const diagnostics: ValidationDiagnostic[] = [];
  if (slot !== envelope.asset.slot) {
    diagnostics.push(
      errorDiagnostic(
        "MANIFEST_SLOT_MISMATCH",
        manifestPath,
        "The slot directory does not match the asset payload.",
      ),
    );
  }
  if (id !== envelope.asset.id) {
    diagnostics.push(
      errorDiagnostic(
        "MANIFEST_ID_MISMATCH",
        manifestPath,
        "The asset directory does not match the payload identity.",
      ),
    );
  }
  if (version !== envelope.asset.version) {
    diagnostics.push(
      errorDiagnostic(
        "MANIFEST_VERSION_MISMATCH",
        manifestPath,
        "The version directory does not match the payload version.",
      ),
    );
  }

  if (envelope.asset.slot === "background") {
    if (scope !== "global" || slot !== "background") {
      diagnostics.push(
        errorDiagnostic(
          "MANIFEST_SCOPE_MISMATCH",
          manifestPath,
          "Background assets must use the global/background source scope.",
        ),
      );
    }
  } else if (scope === "global") {
    diagnostics.push(
      errorDiagnostic(
        "MANIFEST_SCOPE_MISMATCH",
        manifestPath,
        "Only background assets may use the global source scope.",
      ),
    );
  } else if (
    scope === undefined ||
    !envelope.asset.compatibility.compatibleMuses.some(
      (reference) => reference.id === scope,
    )
  ) {
    diagnostics.push(
      errorDiagnostic(
        "MANIFEST_MUSE_MISMATCH",
        manifestPath,
        "The Muse source scope is not declared by the asset payload.",
      ),
    );
  }
  return diagnostics;
};

interface PartValidationResult {
  readonly part?: InspectedSourcePart;
  readonly byteSize: number;
}

const partReportPath = (
  manifestPath: string,
  partIndex: number,
): string => `${manifestPath}#asset.parts.${partIndex}.sourcePath`;

const validatePart = async (
  sourceRoot: string,
  manifestDirectory: string,
  manifestReportPath: string,
  part: AssetPart,
  partIndex: number,
  technical: AssetTechnical,
  isBackground: boolean,
  diagnostics: ValidationDiagnostic[],
  referencedPaths: Set<string>,
): Promise<PartValidationResult> => {
  const declaredPathLabel = partReportPath(manifestReportPath, partIndex);
  try {
    assertPortableRelativePngPath(part.sourcePath);
  } catch (error) {
    const code =
      error instanceof AssetPathError ? error.code : "SOURCE_PATH_INVALID";
    diagnostics.push(
      errorDiagnostic(code, declaredPathLabel, "The declared source path is invalid."),
    );
    return { byteSize: 0 };
  }

  if (path.posix.basename(part.sourcePath) !== `${part.role}.png`) {
    diagnostics.push(
      errorDiagnostic(
        "SOURCE_FILENAME_ROLE_MISMATCH",
        declaredPathLabel,
        "The source filename must exactly match its layer role.",
      ),
    );
  }

  let resolved;
  try {
    resolved = await resolveContainedSourceFile(
      manifestDirectory,
      part.sourcePath,
    );
  } catch (error) {
    const code =
      error instanceof AssetPathError ? error.code : "SOURCE_FILE_UNREADABLE";
    diagnostics.push(
      errorDiagnostic(code, declaredPathLabel, "The declared source file is invalid."),
    );
    return { byteSize: 0 };
  }

  referencedPaths.add(path.normalize(resolved.absolutePath));
  if (
    path.basename(resolved.absolutePath) !==
    path.posix.basename(part.sourcePath)
  ) {
    diagnostics.push(
      errorDiagnostic(
        "SOURCE_FILENAME_CASE_MISMATCH",
        declaredPathLabel,
        "The source filename casing must match the manifest exactly.",
      ),
    );
  }
  const sourceReportPath = toSourceRootRelativePosixPath(
    sourceRoot,
    resolved.absolutePath,
  );

  let sourceFile: StableFileRead;
  try {
    sourceFile = await readStableFile(
      resolved.absolutePath,
      MAX_SOURCE_PART_BYTES,
    );
  } catch (error) {
    const byteSize = error instanceof StableFileError ? error.byteSize : 0;
    const code =
      error instanceof StableFileError && error.code === "FILE_SIZE_EXCEEDED"
        ? "SOURCE_FILE_SIZE_EXCEEDED"
        : error instanceof StableFileError &&
            error.code === "FILE_CHANGED_DURING_READ"
          ? "SOURCE_FILE_CHANGED_DURING_VALIDATION"
          : error instanceof StableFileError && error.code === "FILE_NOT_REGULAR"
            ? "SOURCE_FILE_NOT_REGULAR"
            : "SOURCE_FILE_UNREADABLE";
    diagnostics.push(
      errorDiagnostic(
        code,
        sourceReportPath,
        "The source file could not be read safely.",
      ),
    );
    return { byteSize };
  }

  let structure;
  let decoded;
  try {
    structure = inspectPortablePng(sourceFile.bytes);
    decoded = inspectDecodedSourcePng(sourceFile.bytes, {
      edgeGuardExceptions: technical.edgeGuardExceptions,
      isBackground,
    });
    assertDecodedSourcePngAccepted(decoded);
  } catch (error) {
    const code =
      error instanceof PngStructureError || error instanceof DecodedPngError
        ? error.code
        : "PNG_INVALID";
    diagnostics.push(
      errorDiagnostic(code, sourceReportPath, "The source PNG is invalid."),
    );
    return { byteSize: sourceFile.byteSize };
  }

  return {
    byteSize: sourceFile.byteSize,
    part: {
      id: part.id,
      role: part.role,
      sourcePath: sourceReportPath,
      width: structure.width,
      height: structure.height,
      bitDepth: structure.bitDepth,
      colorType: structure.colorType,
      byteSize: sourceFile.byteSize,
      sha256: createHash("sha256").update(sourceFile.bytes).digest("hex"),
      colour: {
        srgbDeclaration: "png-srgb",
        srgbRenderingIntent: decoded.srgbRenderingIntent,
        profileSha256: null,
      },
      alpha: decoded.alpha,
    },
  };
};

interface ManifestValidationOptions {
  readonly sourceRoot: string;
  readonly manifestPath: string;
  readonly checkLayout: boolean;
  readonly diagnostics: ValidationDiagnostic[];
  readonly referencedPaths: Set<string>;
  readonly seenIdentities: Map<string, string>;
}

const validateManifest = async (
  options: ManifestValidationOptions,
): Promise<ValidatedSourceAsset | undefined> => {
  const manifestReportPath = toSourceRootRelativePosixPath(
    options.sourceRoot,
    options.manifestPath,
  );
  const initialErrorCount = options.diagnostics.length;
  let sourceRootRealPath: string;

  try {
    const manifestStats = await lstat(options.manifestPath);
    if (manifestStats.isSymbolicLink()) {
      options.diagnostics.push(
        errorDiagnostic(
          "MANIFEST_SYMLINK_FORBIDDEN",
          manifestReportPath,
          "Source manifests must not be symbolic links.",
        ),
      );
      return undefined;
    }
    if (!manifestStats.isFile()) {
      options.diagnostics.push(
        errorDiagnostic(
          "MANIFEST_NOT_REGULAR",
          manifestReportPath,
          "The source manifest must be a regular file.",
        ),
      );
      return undefined;
    }
    const [resolvedSourceRoot, manifestRealPath] = await Promise.all([
      realpath(options.sourceRoot),
      realpath(options.manifestPath),
    ]);
    sourceRootRealPath = resolvedSourceRoot;
    const manifestRelativeRealPath = path.relative(
      sourceRootRealPath,
      manifestRealPath,
    );
    if (
      manifestRelativeRealPath === "" ||
      manifestRelativeRealPath === ".." ||
      manifestRelativeRealPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(manifestRelativeRealPath)
    ) {
      options.diagnostics.push(
        errorDiagnostic(
          "MANIFEST_OUTSIDE_SOURCE_ROOT",
          manifestReportPath,
          "The source manifest resolves outside the source root.",
        ),
      );
      return undefined;
    }
  } catch {
    options.diagnostics.push(
      errorDiagnostic(
        "MANIFEST_UNREADABLE",
        manifestReportPath,
        "The source manifest could not be inspected safely.",
      ),
    );
    return undefined;
  }

  const readResult = await readEnvelope(
    options.manifestPath,
    manifestReportPath,
    options.diagnostics,
  );
  if (readResult === undefined) {
    return undefined;
  }
  const { envelope } = readResult;

  if (options.checkLayout) {
    options.diagnostics.push(...layoutDiagnostics(manifestReportPath, envelope));
  }

  const identity = referenceKey(envelope.asset);
  const previousManifest = options.seenIdentities.get(identity);
  if (previousManifest === undefined) {
    options.seenIdentities.set(identity, manifestReportPath);
  } else {
    options.diagnostics.push(
      errorDiagnostic(
        "ASSET_IDENTITY_DUPLICATE",
        manifestReportPath,
        "The source tree contains a duplicate asset identity.",
      ),
    );
  }

  const inspectedParts: InspectedSourcePart[] = [];
  let totalByteSize = 0;
  for (const [partIndex, part] of envelope.asset.parts.entries()) {
    const result = await validatePart(
      sourceRootRealPath,
      path.dirname(options.manifestPath),
      manifestReportPath,
      part,
      partIndex,
      envelope.technical,
      envelope.asset.slot === "background",
      options.diagnostics,
      options.referencedPaths,
    );
    totalByteSize += result.byteSize;
    if (result.part !== undefined) {
      inspectedParts.push(result.part);
    }
  }

  if (totalByteSize > MAX_SOURCE_ASSET_BYTES) {
    options.diagnostics.push(
      errorDiagnostic(
        "ASSET_SOURCE_SIZE_EXCEEDED",
        manifestReportPath,
        "The asset's source parts exceed the 50 MiB total budget.",
      ),
    );
  }

  const bitDepths = new Set(inspectedParts.map((part) => part.bitDepth));
  if (bitDepths.size > 1) {
    options.diagnostics.push(
      errorDiagnostic(
        "ASSET_SOURCE_BIT_DEPTH_MIXED",
        manifestReportPath,
        "Every source part in one asset version must use the same bit depth.",
      ),
    );
  }

  if (options.diagnostics.length !== initialErrorCount) {
    return undefined;
  }

  inspectedParts.sort(
    (left, right) =>
      compareCodePoint(left.role, right.role) ||
      compareCodePoint(left.id, right.id) ||
      compareCodePoint(left.sourcePath, right.sourcePath),
  );
  const asset = canonicalAsset(envelope.asset);
  const technical = canonicalTechnical(envelope.technical);
  const sourceFingerprint = createHash("sha256")
    .update(
      canonicalJson({
        manifestSha256: readResult.sha256,
        asset,
        technical,
        parts: inspectedParts.map((part) => ({
          id: part.id,
          role: part.role,
          sourcePath: part.sourcePath,
          sha256: part.sha256,
        })),
      }),
    )
    .digest("hex");
  return {
    reference: { id: envelope.asset.id, version: envelope.asset.version },
    manifest: { path: manifestReportPath, sha256: readResult.sha256 },
    sourceFingerprint,
    asset,
    technical,
    parts: inspectedParts,
  };
};

export const validateSourceTree = async (
  sourceRoot: string,
): Promise<ValidationReport> => {
  const diagnostics: ValidationDiagnostic[] = [];
  const effectiveSourceRoot = await realpath(sourceRoot).catch(() => sourceRoot);
  let discovery;
  try {
    discovery = await discoverSourceFiles(effectiveSourceRoot);
  } catch (error) {
    const code =
      error instanceof AssetDiscoveryError ? error.code : "SOURCE_ROOT_UNREADABLE";
    return makeReport(0, [], [
      errorDiagnostic(code, ".", "The source root could not be discovered."),
    ]);
  }

  const assets: ValidatedSourceAsset[] = [];
  const referencedPaths = new Set<string>();
  const seenIdentities = new Map<string, string>();
  for (const manifestPath of discovery.manifestPaths) {
    const asset = await validateManifest({
      sourceRoot: effectiveSourceRoot,
      manifestPath,
      checkLayout: true,
      diagnostics,
      referencedPaths,
      seenIdentities,
    });
    if (asset !== undefined) {
      assets.push(asset);
    }
  }

  for (const pngPath of discovery.pngPaths) {
    if (!referencedPaths.has(path.normalize(pngPath))) {
      diagnostics.push(
        errorDiagnostic(
          "SOURCE_FILE_UNDECLARED",
          toSourceRootRelativePosixPath(effectiveSourceRoot, pngPath),
          "The source PNG is not declared by a valid manifest part.",
        ),
      );
    }
  }

  return makeReport(discovery.manifestPaths.length, assets, diagnostics);
};

export const inspectManifest = async (
  manifestPath: string,
): Promise<ValidationReport> => {
  const diagnostics: ValidationDiagnostic[] = [];
  const sourceRoot = path.dirname(manifestPath);
  const asset = await validateManifest({
    sourceRoot,
    manifestPath,
    checkLayout: false,
    diagnostics,
    referencedPaths: new Set<string>(),
    seenIdentities: new Map<string, string>(),
  });
  return makeReport(1, asset === undefined ? [] : [asset], diagnostics);
};
