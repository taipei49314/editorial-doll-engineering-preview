/**
 * Portable inspection for the narrow PNG subset accepted by M2.1.
 *
 * This module validates container structure and a bounded zlib scanline stream.
 * Pixel reconstruction, colour-profile, and alpha-edge checks are M2.2 work.
 */

import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MASTER_WIDTH = 2048;
const MASTER_HEIGHT = 3072;

const KNOWN_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const APNG_CHUNKS = new Set(["acTL", "fcTL", "fdAT"]);

export type PngStructureErrorCode =
  | "PNG_INVALID_SIGNATURE"
  | "PNG_CHUNK_TRUNCATED"
  | "PNG_CHUNK_CRC_MISMATCH"
  | "PNG_INVALID_CHUNK_TYPE"
  | "PNG_IHDR_NOT_FIRST"
  | "PNG_IHDR_DUPLICATE"
  | "PNG_IHDR_INVALID_LENGTH"
  | "PNG_IHDR_MISSING"
  | "PNG_IDAT_MISSING"
  | "PNG_IEND_MISSING"
  | "PNG_IEND_INVALID_LENGTH"
  | "PNG_TRAILING_BYTES"
  | "PNG_DIMENSIONS_INVALID"
  | "PNG_COLOR_TYPE_INVALID"
  | "PNG_BIT_DEPTH_INVALID"
  | "PNG_COMPRESSION_METHOD_INVALID"
  | "PNG_FILTER_METHOD_INVALID"
  | "PNG_INTERLACE_METHOD_INVALID"
  | "PNG_IDAT_NONCONTIGUOUS"
  | "PNG_PALETTE_FORBIDDEN"
  | "PNG_APNG_FORBIDDEN"
  | "PNG_OFFSET_FORBIDDEN"
  | "PNG_UNKNOWN_CRITICAL_CHUNK"
  | "PNG_IMAGE_DATA_INVALID"
  | "PNG_IMAGE_DATA_TRAILING_BYTES"
  | "PNG_IMAGE_DATA_LENGTH_INVALID"
  | "PNG_SCANLINE_FILTER_INVALID";

export class PngStructureError extends Error {
  public readonly code: PngStructureErrorCode;

  public constructor(code: PngStructureErrorCode) {
    super(code);
    this.name = "PngStructureError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface PngChunkFacts {
  readonly chunkTypes: readonly string[];
  readonly hasIdat: boolean;
  readonly hasIend: boolean;
  readonly hasPalette: boolean;
  readonly hasApng: boolean;
  readonly hasOffset: boolean;
}

export interface PngStructure {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: 8 | 16;
  readonly colorType: 6;
  readonly chunks: PngChunkFacts;
}

/**
 * Inspects the required static RGBA master-PNG container without decoding image
 * data. It accepts only the Editorial Doll 2048 x 3072, 8/16-bit subset.
 */
export function inspectPngStructure(input: Uint8Array): PngStructure {
  assertSignature(input);

  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let sawIhdr = false;
  let sawIdat = false;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compressionMethod = 0;
  let filterMethod = 0;
  let interlaceMethod = 0;
  let idatSequenceClosed = false;
  const chunkTypes: string[] = [];

  while (offset < input.length) {
    if (input.length - offset < 12) {
      throw pngError("PNG_CHUNK_TRUNCATED");
    }

    const dataLength = readUint32(input, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + dataLength;
    const nextOffset = crcOffset + 4;

    if (nextOffset > input.length) {
      throw pngError("PNG_CHUNK_TRUNCATED");
    }

    const type = readChunkType(input, typeOffset);
    if (!isAlphabeticChunkType(input, typeOffset)) {
      throw pngError("PNG_INVALID_CHUNK_TYPE");
    }
    if (crc32(input, typeOffset, crcOffset) !== readUint32(input, crcOffset)) {
      throw pngError("PNG_CHUNK_CRC_MISMATCH");
    }

    if (chunkIndex === 0 && type !== "IHDR") {
      throw pngError("PNG_IHDR_NOT_FIRST");
    }
    if (type === "IHDR") {
      if (sawIhdr) {
        throw pngError("PNG_IHDR_DUPLICATE");
      }
      if (dataLength !== 13) {
        throw pngError("PNG_IHDR_INVALID_LENGTH");
      }
      sawIhdr = true;
      width = readUint32(input, dataOffset);
      height = readUint32(input, dataOffset + 4);
      bitDepth = input[dataOffset + 8] ?? 0;
      colorType = input[dataOffset + 9] ?? 0;
      compressionMethod = input[dataOffset + 10] ?? 0;
      filterMethod = input[dataOffset + 11] ?? 0;
      interlaceMethod = input[dataOffset + 12] ?? 0;
    } else if (isCriticalChunk(input, typeOffset) && !KNOWN_CRITICAL_CHUNKS.has(type)) {
      throw pngError("PNG_UNKNOWN_CRITICAL_CHUNK");
    }

    if (type === "PLTE") {
      throw pngError("PNG_PALETTE_FORBIDDEN");
    }
    if (APNG_CHUNKS.has(type)) {
      throw pngError("PNG_APNG_FORBIDDEN");
    }
    if (type === "oFFs") {
      throw pngError("PNG_OFFSET_FORBIDDEN");
    }

    chunkTypes.push(type);
    if (type === "IDAT") {
      if (idatSequenceClosed) {
        throw pngError("PNG_IDAT_NONCONTIGUOUS");
      }
      sawIdat = true;
    } else if (sawIdat) {
      idatSequenceClosed = true;
    }
    if (type === "IEND") {
      if (dataLength !== 0) {
        throw pngError("PNG_IEND_INVALID_LENGTH");
      }
      if (nextOffset !== input.length) {
        throw pngError("PNG_TRAILING_BYTES");
      }
      if (!sawIhdr) {
        throw pngError("PNG_IHDR_MISSING");
      }
      if (!sawIdat) {
        throw pngError("PNG_IDAT_MISSING");
      }
      return validateMasterHeader({
        width,
        height,
        bitDepth,
        colorType,
        compressionMethod,
        filterMethod,
        interlaceMethod,
        chunkTypes,
      });
    }

    offset = nextOffset;
    chunkIndex += 1;
  }

  if (!sawIhdr) {
    throw pngError("PNG_IHDR_MISSING");
  }
  throw pngError("PNG_IEND_MISSING");
}

/**
 * Verifies the zlib stream expands to one non-interlaced RGBA scanline per
 * master-frame row. It deliberately stops before PNG filter reconstruction.
 */
export function inspectPortablePng(input: Uint8Array): PngStructure {
  const structure = inspectPngStructure(input);
  const idatParts: Uint8Array[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset < input.length) {
    const dataLength = readUint32(input, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + dataLength;
    const type = readChunkType(input, typeOffset);
    if (type === "IDAT") {
      idatParts.push(input.subarray(dataOffset, crcOffset));
    }
    offset = crcOffset + 4;
    if (type === "IEND") {
      break;
    }
  }

  const bytesPerSample = structure.bitDepth / 8;
  const scanlineLength = 1 + structure.width * 4 * bytesPerSample;
  const expectedLength = scanlineLength * structure.height;
  const compressed = Buffer.concat(
    idatParts.map((part) => Buffer.from(part)),
  );
  let inflateResult: {
    readonly buffer: Uint8Array;
    readonly engine: { readonly bytesWritten: number };
  };
  try {
    inflateResult = inflateSync(compressed, {
      info: true,
      maxOutputLength: expectedLength + 1,
    }) as unknown as typeof inflateResult;
  } catch {
    throw pngError("PNG_IMAGE_DATA_INVALID");
  }

  if (inflateResult.engine.bytesWritten !== compressed.byteLength) {
    throw pngError("PNG_IMAGE_DATA_TRAILING_BYTES");
  }
  const scanlines = inflateResult.buffer;
  if (scanlines.byteLength !== expectedLength) {
    throw pngError("PNG_IMAGE_DATA_LENGTH_INVALID");
  }
  for (let row = 0; row < structure.height; row += 1) {
    const filterType = scanlines[row * scanlineLength];
    if (filterType === undefined || filterType > 4) {
      throw pngError("PNG_SCANLINE_FILTER_INVALID");
    }
  }
  return structure;
}

function validateMasterHeader(input: {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly compressionMethod: number;
  readonly filterMethod: number;
  readonly interlaceMethod: number;
  readonly chunkTypes: readonly string[];
}): PngStructure {
  if (input.width !== MASTER_WIDTH || input.height !== MASTER_HEIGHT) {
    throw pngError("PNG_DIMENSIONS_INVALID");
  }
  if (input.colorType !== 6) {
    throw pngError("PNG_COLOR_TYPE_INVALID");
  }
  if (input.bitDepth !== 8 && input.bitDepth !== 16) {
    throw pngError("PNG_BIT_DEPTH_INVALID");
  }
  if (input.compressionMethod !== 0) {
    throw pngError("PNG_COMPRESSION_METHOD_INVALID");
  }
  if (input.filterMethod !== 0) {
    throw pngError("PNG_FILTER_METHOD_INVALID");
  }
  if (input.interlaceMethod !== 0) {
    throw pngError("PNG_INTERLACE_METHOD_INVALID");
  }

  return {
    width: input.width,
    height: input.height,
    bitDepth: input.bitDepth,
    colorType: input.colorType,
    chunks: {
      chunkTypes: [...input.chunkTypes],
      hasIdat: true,
      hasIend: true,
      hasPalette: false,
      hasApng: false,
      hasOffset: false,
    },
  };
}

function assertSignature(input: Uint8Array): void {
  if (input.length < PNG_SIGNATURE.length) {
    throw pngError("PNG_INVALID_SIGNATURE");
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (input[index] !== PNG_SIGNATURE[index]) {
      throw pngError("PNG_INVALID_SIGNATURE");
    }
  }
}

function readUint32(input: Uint8Array, offset: number): number {
  return (
    ((input[offset] ?? 0) * 0x1000000) +
    ((input[offset + 1] ?? 0) << 16) +
    ((input[offset + 2] ?? 0) << 8) +
    (input[offset + 3] ?? 0)
  );
}

function readChunkType(input: Uint8Array, offset: number): string {
  return String.fromCharCode(
    input[offset] ?? 0,
    input[offset + 1] ?? 0,
    input[offset + 2] ?? 0,
    input[offset + 3] ?? 0,
  );
}

function isAlphabeticChunkType(input: Uint8Array, offset: number): boolean {
  for (let index = offset; index < offset + 4; index += 1) {
    const value = input[index] ?? 0;
    if (!((value >= 65 && value <= 90) || (value >= 97 && value <= 122))) {
      return false;
    }
  }
  return true;
}

function isCriticalChunk(input: Uint8Array, typeOffset: number): boolean {
  const firstByte = input[typeOffset] ?? 0;
  return (firstByte & 0x20) === 0;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let entry = value;
  for (let bit = 0; bit < 8; bit += 1) {
    entry = (entry >>> 1) ^ (entry & 1 ? 0xedb88320 : 0);
  }
  return entry >>> 0;
});

function crc32(input: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    const tableIndex = (crc ^ (input[offset] ?? 0)) & 0xff;
    crc = (crc >>> 8) ^ (CRC_TABLE[tableIndex] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngError(code: PngStructureErrorCode): PngStructureError {
  return new PngStructureError(code);
}
