/**
 * M2.2 decoded inspection for the deliberately narrow Editorial Doll PNG
 * source subset. This module retains only two reconstructed rows at once and
 * records evidence rather than retaining decoded artwork pixels.
 */

import { inflateSync } from "node:zlib";

import type { EdgeGuardException } from "./manifest.js";
import { inspectPngStructure, PngStructureError } from "./png.js";

const PNG_SIGNATURE_LENGTH = 8;
const MASTER_WIDTH = 2048;
const MASTER_HEIGHT = 3072;
const EDGE_GUARD_PIXELS = 16;
const STANDARD_GAMMA = 45_455;
const STANDARD_CHRM = [
  31_270, 32_900, 64_000, 33_000, 30_000, 60_000, 15_000, 6_000,
] as const;

const EDGE_ORDER = ["top", "right", "bottom", "left"] as const;
type Edge = (typeof EDGE_ORDER)[number];

export type DecodedPngErrorCode =
  | "PNG_SRGB_MISSING"
  | "PNG_SRGB_DUPLICATE"
  | "PNG_SRGB_INVALID"
  | "PNG_ICCP_FORBIDDEN"
  | "PNG_GAMA_DUPLICATE"
  | "PNG_GAMA_INVALID"
  | "PNG_CHRM_DUPLICATE"
  | "PNG_CHRM_INVALID"
  | "PNG_ANCILLARY_FORBIDDEN"
  | "PNG_ANCILLARY_INVALID"
  | "PNG_IMAGE_DATA_INVALID"
  | "PNG_IMAGE_DATA_TRAILING_BYTES"
  | "PNG_IMAGE_DATA_LENGTH_INVALID"
  | "PNG_SCANLINE_FILTER_INVALID"
  | "EDGE_GUARD_EXCEPTION_RANGE_INVALID"
  | "EDGE_GUARD_EXCEPTION_OVERLAP"
  | "EDGE_GUARD_EXCEPTION_BLANKET"
  | "EDGE_GUARD_EXCEPTION_UNUSED"
  | "EDGE_GUARD_ALPHA_NONZERO";

export class DecodedPngError extends Error {
  public constructor(public readonly code: DecodedPngErrorCode) {
    super(code);
    this.name = "DecodedPngError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface AlphaBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface AlphaEvidence {
  readonly transparentPixels: number;
  readonly translucentPixels: number;
  readonly opaquePixels: number;
  readonly nonZeroBounds: AlphaBounds | null;
  readonly edgeGuardViolations: number;
  readonly edgeGuardExceptedPixels: number;
}

export interface DecodedSourcePng {
  readonly width: typeof MASTER_WIDTH;
  readonly height: typeof MASTER_HEIGHT;
  readonly bitDepth: 8 | 16;
  readonly colourType: 6;
  readonly srgbRenderingIntent: 0 | 1 | 2 | 3;
  readonly alpha: AlphaEvidence;
}

export interface DecodedSourcePngOptions {
  readonly edgeGuardExceptions: readonly EdgeGuardException[];
  readonly isBackground: boolean;
}

interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array;
}

interface PreparedException {
  readonly edge: Edge;
  readonly startInclusive: number;
  readonly endInclusive: number;
  used: boolean;
}

/**
 * Reconstructs PNG filter methods 0-4 one row at a time. The callback receives
 * a mutable row which is replaced on the next iteration and must not retain it.
 */
export const forEachReconstructedRgbaScanline = (
  scanlines: Uint8Array,
  width: number,
  height: number,
  bitDepth: 8 | 16,
  visit: (row: Uint8Array, y: number) => void,
): void => {
  const bytesPerSample = bitDepth / 8;
  const bytesPerPixel = 4 * bytesPerSample;
  const rowByteLength = width * bytesPerPixel;
  const encodedRowLength = rowByteLength + 1;
  if (scanlines.byteLength !== encodedRowLength * height) {
    throw decodedError("PNG_IMAGE_DATA_LENGTH_INVALID");
  }

  let previous = new Uint8Array(rowByteLength);
  let current = new Uint8Array(rowByteLength);
  for (let y = 0; y < height; y += 1) {
    const offset = y * encodedRowLength;
    const filter = scanlines[offset];
    if (filter === undefined || filter > 4) {
      throw decodedError("PNG_SCANLINE_FILTER_INVALID");
    }
    for (let x = 0; x < rowByteLength; x += 1) {
      const filtered = scanlines[offset + 1 + x] ?? 0;
      const left = x >= bytesPerPixel ? (current[x - bytesPerPixel] ?? 0) : 0;
      const above = previous[x] ?? 0;
      const upperLeft =
        x >= bytesPerPixel ? (previous[x - bytesPerPixel] ?? 0) : 0;
      current[x] = reconstructByte(filter, filtered, left, above, upperLeft);
    }
    visit(current, y);
    const completed = previous;
    previous = current;
    current = completed;
  }
};

/**
 * Decodes the M2.2 source PNG subset and returns only deterministic colour and
 * alpha evidence. Call assertDecodedSourcePngAccepted to turn edge evidence
 * into validation failures after callers have recorded it.
 */
export const inspectDecodedSourcePng = (
  input: Uint8Array,
  options: DecodedSourcePngOptions,
): DecodedSourcePng => {
  const structure = inspectPngStructure(input);
  const chunks = readPngChunks(input);
  const srgbRenderingIntent = validateSourceAncillaryChunks(chunks);
  const exceptions = prepareExceptions(options.edgeGuardExceptions);
  const scanlines = inflateSourceScanlines(input, structure.bitDepth);

  let transparentPixels = 0;
  let translucentPixels = 0;
  let opaquePixels = 0;
  let minX = MASTER_WIDTH;
  let minY = MASTER_HEIGHT;
  let maxX = -1;
  let maxY = -1;
  let edgeGuardViolations = 0;
  let edgeGuardExceptedPixels = 0;
  const bytesPerSample = structure.bitDepth / 8;
  const bytesPerPixel = 4 * bytesPerSample;
  const alphaMaximum = structure.bitDepth === 8 ? 255 : 65_535;

  forEachReconstructedRgbaScanline(
    scanlines,
    structure.width,
    structure.height,
    structure.bitDepth,
    (row, y) => {
      for (let x = 0; x < MASTER_WIDTH; x += 1) {
        const alphaOffset = x * bytesPerPixel + 3 * bytesPerSample;
        const alpha = readSample(row, alphaOffset, structure.bitDepth);
        if (alpha === 0) {
          transparentPixels += 1;
          continue;
        }
        if (alpha === alphaMaximum) {
          opaquePixels += 1;
        } else {
          translucentPixels += 1;
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);

        if (!options.isBackground) {
          const touchedEdges = edgesForCoordinate(x, y);
          if (touchedEdges.length > 0) {
            const covered = touchedEdges.every((edge) =>
              markCoveringExceptionsUsed(exceptions, edge, x, y),
            );
            if (covered) {
              edgeGuardExceptedPixels += 1;
            } else {
              edgeGuardViolations += 1;
            }
          }
        }
      }
    },
  );

  const unusedExceptions = exceptions.some((exception) => !exception.used);
  if (unusedExceptions) {
    throw decodedError("EDGE_GUARD_EXCEPTION_UNUSED");
  }

  return {
    width: MASTER_WIDTH,
    height: MASTER_HEIGHT,
    bitDepth: structure.bitDepth,
    colourType: structure.colorType,
    srgbRenderingIntent,
    alpha: {
      transparentPixels,
      translucentPixels,
      opaquePixels,
      nonZeroBounds:
        maxX === -1
          ? null
          : { minX, minY, maxX, maxY },
      edgeGuardViolations,
      edgeGuardExceptedPixels,
    },
  };
};

export const assertDecodedSourcePngAccepted = (
  decoded: DecodedSourcePng,
): void => {
  if (decoded.alpha.edgeGuardViolations > 0) {
    throw decodedError("EDGE_GUARD_ALPHA_NONZERO");
  }
};

const inflateSourceScanlines = (
  input: Uint8Array,
  bitDepth: 8 | 16,
): Uint8Array => {
  const idatParts = readPngChunks(input)
    .filter((chunk) => chunk.type === "IDAT")
    .map((chunk) => Buffer.from(chunk.data));
  const compressed = Buffer.concat(idatParts);
  const expectedLength =
    (1 + MASTER_WIDTH * 4 * (bitDepth / 8)) * MASTER_HEIGHT;
  let result: { readonly buffer: Uint8Array; readonly engine: { readonly bytesWritten: number } };
  try {
    result = inflateSync(compressed, {
      info: true,
      maxOutputLength: expectedLength + 1,
    }) as unknown as typeof result;
  } catch {
    throw decodedError("PNG_IMAGE_DATA_INVALID");
  }
  if (result.engine.bytesWritten !== compressed.byteLength) {
    throw decodedError("PNG_IMAGE_DATA_TRAILING_BYTES");
  }
  if (result.buffer.byteLength !== expectedLength) {
    throw decodedError("PNG_IMAGE_DATA_LENGTH_INVALID");
  }
  return result.buffer;
};

const validateSourceAncillaryChunks = (
  chunks: readonly PngChunk[],
): 0 | 1 | 2 | 3 => {
  let srgbRenderingIntent: 0 | 1 | 2 | 3 | undefined;
  let sawGamma = false;
  let sawChromaticities = false;
  for (const chunk of chunks) {
    if (chunk.type === "IHDR" || chunk.type === "IDAT" || chunk.type === "IEND") {
      continue;
    }
    if (chunk.type === "sRGB") {
      if (srgbRenderingIntent !== undefined) {
        throw decodedError("PNG_SRGB_DUPLICATE");
      }
      const intent = chunk.data[0];
      if (chunk.data.byteLength !== 1 || intent === undefined || intent > 3) {
        throw decodedError("PNG_SRGB_INVALID");
      }
      srgbRenderingIntent = intent as 0 | 1 | 2 | 3;
      continue;
    }
    if (chunk.type === "iCCP") {
      throw decodedError("PNG_ICCP_FORBIDDEN");
    }
    if (chunk.type === "gAMA") {
      if (sawGamma) {
        throw decodedError("PNG_GAMA_DUPLICATE");
      }
      sawGamma = true;
      if (chunk.data.byteLength !== 4 || readUint32(chunk.data, 0) !== STANDARD_GAMMA) {
        throw decodedError("PNG_GAMA_INVALID");
      }
      continue;
    }
    if (chunk.type === "cHRM") {
      if (sawChromaticities) {
        throw decodedError("PNG_CHRM_DUPLICATE");
      }
      sawChromaticities = true;
      if (
        chunk.data.byteLength !== 32 ||
        STANDARD_CHRM.some(
          (expected, index) => readUint32(chunk.data, index * 4) !== expected,
        )
      ) {
        throw decodedError("PNG_CHRM_INVALID");
      }
      continue;
    }
    throw decodedError("PNG_ANCILLARY_FORBIDDEN");
  }
  if (srgbRenderingIntent === undefined) {
    throw decodedError("PNG_SRGB_MISSING");
  }
  return srgbRenderingIntent;
};

const prepareExceptions = (
  exceptions: readonly EdgeGuardException[],
): PreparedException[] => {
  const prepared = exceptions.map((exception) => ({ ...exception, used: false }));
  for (const edge of EDGE_ORDER) {
    const maximum = edge === "top" || edge === "bottom" ? 2047 : 3071;
    const onEdge = prepared
      .filter((exception) => exception.edge === edge)
      .sort(
        (left, right) =>
          left.startInclusive - right.startInclusive ||
          left.endInclusive - right.endInclusive,
      );
    let previousEnd = -1;
    for (const exception of onEdge) {
      if (
        exception.startInclusive < 0 ||
        exception.endInclusive > maximum ||
        exception.startInclusive > exception.endInclusive
      ) {
        throw decodedError("EDGE_GUARD_EXCEPTION_RANGE_INVALID");
      }
      if (exception.startInclusive <= previousEnd) {
        throw decodedError("EDGE_GUARD_EXCEPTION_OVERLAP");
      }
      previousEnd = exception.endInclusive;
    }
    if (
      onEdge.length > 0 &&
      onEdge[0]?.startInclusive === 0 &&
      onEdge[onEdge.length - 1]?.endInclusive === maximum &&
      onEdge.every(
        (exception, index) =>
          index === 0 ||
          exception.startInclusive === (onEdge[index - 1]?.endInclusive ?? -2) + 1,
      )
    ) {
      throw decodedError("EDGE_GUARD_EXCEPTION_BLANKET");
    }
  }
  return prepared;
};

const edgesForCoordinate = (x: number, y: number): readonly Edge[] => {
  const edges: Edge[] = [];
  if (y < EDGE_GUARD_PIXELS) {
    edges.push("top");
  }
  if (x >= MASTER_WIDTH - EDGE_GUARD_PIXELS) {
    edges.push("right");
  }
  if (y >= MASTER_HEIGHT - EDGE_GUARD_PIXELS) {
    edges.push("bottom");
  }
  if (x < EDGE_GUARD_PIXELS) {
    edges.push("left");
  }
  return edges;
};

const markCoveringExceptionsUsed = (
  exceptions: readonly PreparedException[],
  edge: Edge,
  x: number,
  y: number,
): boolean => {
  const coordinate = edge === "top" || edge === "bottom" ? x : y;
  const matching = exceptions.filter(
    (exception) =>
      exception.edge === edge &&
      exception.startInclusive <= coordinate &&
      coordinate <= exception.endInclusive,
  );
  for (const exception of matching) {
    exception.used = true;
  }
  return matching.length > 0;
};

const reconstructByte = (
  filter: number,
  filtered: number,
  left: number,
  above: number,
  upperLeft: number,
): number => {
  switch (filter) {
    case 0:
      return filtered;
    case 1:
      return (filtered + left) & 0xff;
    case 2:
      return (filtered + above) & 0xff;
    case 3:
      return (filtered + Math.floor((left + above) / 2)) & 0xff;
    case 4:
      return (filtered + paeth(left, above, upperLeft)) & 0xff;
    default:
      throw decodedError("PNG_SCANLINE_FILTER_INVALID");
  }
};

const paeth = (left: number, above: number, upperLeft: number): number => {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
};

const readSample = (
  row: Uint8Array,
  offset: number,
  bitDepth: 8 | 16,
): number =>
  bitDepth === 8
    ? (row[offset] ?? 0)
    : ((row[offset] ?? 0) << 8) | (row[offset + 1] ?? 0);

const readPngChunks = (input: Uint8Array): readonly PngChunk[] => {
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE_LENGTH;
  while (offset < input.byteLength) {
    const length = readUint32(input, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const type = String.fromCharCode(
      input[typeOffset] ?? 0,
      input[typeOffset + 1] ?? 0,
      input[typeOffset + 2] ?? 0,
      input[typeOffset + 3] ?? 0,
    );
    chunks.push({ type, data: input.subarray(dataOffset, dataEnd) });
    offset = dataEnd + 4;
    if (type === "IEND") {
      return chunks;
    }
  }
  throw new PngStructureError("PNG_IEND_MISSING");
};

const readUint32 = (input: Uint8Array, offset: number): number =>
  ((input[offset] ?? 0) * 0x1000000) +
  ((input[offset + 1] ?? 0) << 16) +
  ((input[offset + 2] ?? 0) << 8) +
  (input[offset + 3] ?? 0);

const decodedError = (code: DecodedPngErrorCode): DecodedPngError =>
  new DecodedPngError(code);
