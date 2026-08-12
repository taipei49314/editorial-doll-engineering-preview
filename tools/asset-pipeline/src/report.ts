import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { Asset, AssetReference, LayerRole } from "@editorial-doll/domain";

import type { AssetTechnical } from "./manifest.js";
import { compareCodePoint } from "./paths.js";

export const REPORT_SCHEMA_VERSION = "2.0.0" as const;

export type DiagnosticSeverity = "error";

export interface ValidationDiagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly path: string;
  readonly message: string;
}

export interface InspectedSourcePart {
  readonly id: string;
  readonly role: LayerRole;
  readonly sourcePath: string;
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly byteSize: number;
  readonly sha256: string;
  readonly colour: {
    readonly srgbDeclaration: "png-srgb";
    readonly srgbRenderingIntent: 0 | 1 | 2 | 3;
    readonly profileSha256: null;
  };
  readonly alpha: {
    readonly transparentPixels: number;
    readonly translucentPixels: number;
    readonly opaquePixels: number;
    readonly nonZeroBounds: {
      readonly minX: number;
      readonly minY: number;
      readonly maxX: number;
      readonly maxY: number;
    } | null;
    readonly edgeGuardViolations: number;
    readonly edgeGuardExceptedPixels: number;
  };
}

export interface ValidatedSourceAsset {
  readonly reference: AssetReference;
  readonly manifest: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly sourceFingerprint: string;
  readonly asset: Asset;
  readonly technical: AssetTechnical;
  readonly parts: readonly InspectedSourcePart[];
}

export interface ValidationSummary {
  readonly manifests: number;
  readonly assets: number;
  readonly parts: number;
  readonly errors: number;
}

export interface ValidationReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly ok: boolean;
  readonly summary: ValidationSummary;
  readonly assets: readonly ValidatedSourceAsset[];
  readonly diagnostics: readonly ValidationDiagnostic[];
}

const compareDiagnostics = (
  left: ValidationDiagnostic,
  right: ValidationDiagnostic,
): number =>
  compareCodePoint(left.path, right.path) ||
  compareCodePoint(left.code, right.code) ||
  compareCodePoint(left.message, right.message);

export const orderDiagnostics = (
  diagnostics: readonly ValidationDiagnostic[],
): readonly ValidationDiagnostic[] => [...diagnostics].sort(compareDiagnostics);

export const canonicalJson = (value: unknown): string =>
  `${JSON.stringify(value, undefined, 2)}\n`;

let temporaryFileSequence = 0;

export const writeCanonicalJsonAtomic = async (
  outputPath: string,
  value: unknown,
): Promise<void> => {
  const absoluteOutputPath = path.resolve(outputPath);
  temporaryFileSequence += 1;
  const temporaryPath = `${absoluteOutputPath}.${process.pid}.${temporaryFileSequence}.tmp`;

  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, canonicalJson(value), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, absoluteOutputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};
