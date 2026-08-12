import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

import sharp from "sharp";

export const MASTER_WIDTH = 2048;
export const MASTER_HEIGHT = 3072;
export const RUNTIME_WIDTH = 1024;
export const RUNTIME_HEIGHT = 1536;
export const THUMBNAIL_WIDTH = 320;
export const THUMBNAIL_HEIGHT = 480;
export const RUNTIME_MAX_BYTES = 4 * 1_048_576;
export const THUMBNAIL_MAX_BYTES = 600 * 1024;

export const CANONICAL_SRGB_PROFILE_SHA256 =
  "c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353";

const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const CANONICAL_PHYS = Uint8Array.from([
  0x00, 0x00, 0x03, 0xe8,
  0x00, 0x00, 0x03, 0xe8,
  0x01,
]);
const PNG_OPTIONS = {
  force: true,
  palette: false,
  progressive: false,
  compressionLevel: 9,
  adaptiveFiltering: false,
} as const;
const INPUT_OPTIONS = {
  failOn: "warning" as const,
  limitInputPixels: MASTER_WIDTH * MASTER_HEIGHT,
  limitInputChannels: 4,
  unlimited: false,
  sequentialRead: true,
  autoOrient: false,
  animated: false,
} as const;

export type DerivativeKind = "runtime" | "thumbnail";

export interface DerivativeDensity {
  readonly xPixelsPerMeter: 1000;
  readonly yPixelsPerMeter: 1000;
  readonly unit: "metre";
}

export interface DerivativeAlphaEvidence {
  readonly transparentPixels: number;
  readonly translucentPixels: number;
  readonly opaquePixels: number;
  readonly nonZeroBounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  } | null;
}

export interface VerifiedDerivative {
  readonly kind: DerivativeKind;
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
  readonly bitDepth: 8;
  readonly colourType: 6;
  readonly byteSize: number;
  readonly sha256: string;
  readonly profileSha256: typeof CANONICAL_SRGB_PROFILE_SHA256;
  readonly density: DerivativeDensity;
  readonly alpha: DerivativeAlphaEvidence;
}

export interface Derivatives {
  readonly runtime: VerifiedDerivative;
  readonly thumbnail: VerifiedDerivative;
}

export type DerivativeErrorCode =
  | "DERIVATIVE_MASTER_INVALID"
  | "DERIVATIVE_OUTPUT_BUDGET_EXCEEDED"
  | "DERIVATIVE_PNG_SIGNATURE_INVALID"
  | "DERIVATIVE_PNG_CHUNK_INVALID"
  | "DERIVATIVE_PNG_CHUNK_CRC_INVALID"
  | "DERIVATIVE_PNG_STRUCTURE_INVALID"
  | "DERIVATIVE_PNG_ANCILLARY_INVALID"
  | "DERIVATIVE_PNG_PROFILE_INVALID"
  | "DERIVATIVE_PNG_DENSITY_INVALID"
  | "DERIVATIVE_DECODE_INVALID";

export class DerivativeError extends Error {
  public constructor(public readonly code: DerivativeErrorCode) {
    super(code);
    this.name = "DerivativeError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface ExpectedDerivative {
  readonly kind: DerivativeKind;
  readonly width: number;
  readonly height: number;
  readonly maximumBytes: number;
}

interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array;
}

const expectedDerivative = (kind: DerivativeKind): ExpectedDerivative =>
  kind === "runtime"
    ? {
        kind,
        width: RUNTIME_WIDTH,
        height: RUNTIME_HEIGHT,
        maximumBytes: RUNTIME_MAX_BYTES,
      }
    : {
        kind,
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        maximumBytes: THUMBNAIL_MAX_BYTES,
      };

/**
 * Set process-global Sharp settings once per derivative invocation. These
 * settings deliberately favour repeatability over throughput.
 */
const configureSharpForDerivatives = (): void => {
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.simd(false);
};

const sha256 = (input: Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

const readUint32 = (input: Uint8Array, offset: number): number =>
  ((input[offset] ?? 0) * 0x1_000000) +
  ((input[offset + 1] ?? 0) << 16) +
  ((input[offset + 2] ?? 0) << 8) +
  (input[offset + 3] ?? 0);

const crc32 = (input: Uint8Array, start: number, end: number): number => {
  let crc = 0xffff_ffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= input[offset] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb_88320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
};

const readChunkType = (input: Uint8Array, offset: number): string =>
  String.fromCharCode(
    input[offset] ?? 0,
    input[offset + 1] ?? 0,
    input[offset + 2] ?? 0,
    input[offset + 3] ?? 0,
  );

const inspectDerivativeChunks = (input: Uint8Array): readonly PngChunk[] => {
  if (
    input.byteLength < PNG_SIGNATURE.byteLength ||
    !sameBytes(input.subarray(0, PNG_SIGNATURE.byteLength), PNG_SIGNATURE)
  ) {
    throw new DerivativeError("DERIVATIVE_PNG_SIGNATURE_INVALID");
  }

  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.byteLength;
  while (offset < input.byteLength) {
    if (input.byteLength - offset < 12) {
      throw new DerivativeError("DERIVATIVE_PNG_CHUNK_INVALID");
    }
    const length = readUint32(input, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const nextOffset = crcOffset + 4;
    if (nextOffset > input.byteLength) {
      throw new DerivativeError("DERIVATIVE_PNG_CHUNK_INVALID");
    }
    if (crc32(input, typeOffset, crcOffset) !== readUint32(input, crcOffset)) {
      throw new DerivativeError("DERIVATIVE_PNG_CHUNK_CRC_INVALID");
    }
    const type = readChunkType(input, typeOffset);
    chunks.push({ type, data: input.subarray(dataOffset, crcOffset) });
    offset = nextOffset;
  }
  return chunks;
};

const normalizeCanonicalPhys = (input: Uint8Array): Buffer => {
  const output = Buffer.from(input);
  let offset = PNG_SIGNATURE.byteLength;
  let physCount = 0;
  while (offset < output.byteLength) {
    if (output.byteLength - offset < 12) {
      throw new DerivativeError("DERIVATIVE_PNG_CHUNK_INVALID");
    }
    const length = readUint32(output, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const nextOffset = crcOffset + 4;
    if (nextOffset > output.byteLength) {
      throw new DerivativeError("DERIVATIVE_PNG_CHUNK_INVALID");
    }
    if (readChunkType(output, typeOffset) === "pHYs") {
      if (length !== CANONICAL_PHYS.byteLength) {
        throw new DerivativeError("DERIVATIVE_PNG_DENSITY_INVALID");
      }
      physCount += 1;
      output.set(CANONICAL_PHYS, dataOffset);
      output.writeUInt32BE(crc32(output, typeOffset, crcOffset), crcOffset);
    }
    offset = nextOffset;
  }
  if (physCount !== 1) {
    throw new DerivativeError("DERIVATIVE_PNG_DENSITY_INVALID");
  }
  return output;
};

const assertDerivativePngStructure = (
  chunks: readonly PngChunk[],
  expected: ExpectedDerivative,
): void => {
  const ihdr = chunks[0];
  const iend = chunks.at(-1);
  if (
    ihdr?.type !== "IHDR" ||
    ihdr.data.byteLength !== 13 ||
    iend?.type !== "IEND" ||
    iend.data.byteLength !== 0 ||
    chunks.filter((chunk) => chunk.type === "IHDR").length !== 1 ||
    chunks.filter((chunk) => chunk.type === "IEND").length !== 1
  ) {
    throw new DerivativeError("DERIVATIVE_PNG_STRUCTURE_INVALID");
  }
  if (
    readUint32(ihdr.data, 0) !== expected.width ||
    readUint32(ihdr.data, 4) !== expected.height ||
    ihdr.data[8] !== 8 ||
    ihdr.data[9] !== 6 ||
    ihdr.data[10] !== 0 ||
    ihdr.data[11] !== 0 ||
    ihdr.data[12] !== 0
  ) {
    throw new DerivativeError("DERIVATIVE_PNG_STRUCTURE_INVALID");
  }

  let idatCount = 0;
  let idatEnded = false;
  let iccCount = 0;
  let physCount = 0;
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.type === "IHDR" || chunk.type === "IEND") {
      continue;
    }
    if (chunk.type === "IDAT") {
      if (idatEnded) {
        throw new DerivativeError("DERIVATIVE_PNG_STRUCTURE_INVALID");
      }
      idatCount += 1;
      continue;
    }
    if (idatCount > 0) {
      idatEnded = true;
    }
    if (chunk.type === "iCCP") {
      iccCount += 1;
      continue;
    }
    if (chunk.type === "pHYs") {
      physCount += 1;
      if (!sameBytes(chunk.data, CANONICAL_PHYS)) {
        throw new DerivativeError("DERIVATIVE_PNG_DENSITY_INVALID");
      }
      continue;
    }
    if (index > 0 && index < chunks.length - 1) {
      throw new DerivativeError("DERIVATIVE_PNG_ANCILLARY_INVALID");
    }
  }
  if (idatCount === 0 || iccCount !== 1 || physCount !== 1) {
    throw new DerivativeError("DERIVATIVE_PNG_STRUCTURE_INVALID");
  }
  if (
    chunks[1]?.type !== "iCCP" ||
    chunks[2]?.type !== "pHYs" ||
    chunks[3]?.type !== "IDAT"
  ) {
    throw new DerivativeError("DERIVATIVE_PNG_STRUCTURE_INVALID");
  }
};

const assertCanonicalIcc = (chunks: readonly PngChunk[]): void => {
  const chunk = chunks.find((candidate) => candidate.type === "iCCP");
  if (chunk === undefined) {
    throw new DerivativeError("DERIVATIVE_PNG_PROFILE_INVALID");
  }
  const separator = chunk.data.indexOf(0);
  if (
    separator <= 0 ||
    separator + 2 >= chunk.data.byteLength ||
    chunk.data[separator + 1] !== 0
  ) {
    throw new DerivativeError("DERIVATIVE_PNG_PROFILE_INVALID");
  }
  let profile: Uint8Array;
  try {
    profile = inflateSync(chunk.data.subarray(separator + 2));
  } catch {
    throw new DerivativeError("DERIVATIVE_PNG_PROFILE_INVALID");
  }
  if (sha256(profile) !== CANONICAL_SRGB_PROFILE_SHA256) {
    throw new DerivativeError("DERIVATIVE_PNG_PROFILE_INVALID");
  }
};

const inspectAlpha = async (
  data: Buffer,
  expected: ExpectedDerivative,
): Promise<DerivativeAlphaEvidence> => {
  let raw: Awaited<ReturnType<ReturnType<typeof sharp>["toBuffer"]>>;
  try {
    raw = await sharp(data, INPUT_OPTIONS)
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new DerivativeError("DERIVATIVE_DECODE_INVALID");
  }
  if (
    raw.info.width !== expected.width ||
    raw.info.height !== expected.height ||
    raw.info.channels !== 4
  ) {
    throw new DerivativeError("DERIVATIVE_DECODE_INVALID");
  }

  let transparentPixels = 0;
  let translucentPixels = 0;
  let opaquePixels = 0;
  let minX = expected.width;
  let minY = expected.height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < expected.width * expected.height; pixel += 1) {
    const alpha = raw.data[pixel * 4 + 3] ?? 0;
    if (alpha === 0) {
      transparentPixels += 1;
      continue;
    }
    if (alpha === 255) {
      opaquePixels += 1;
    } else {
      translucentPixels += 1;
    }
    const x = pixel % expected.width;
    const y = Math.floor(pixel / expected.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    transparentPixels,
    translucentPixels,
    opaquePixels,
    nonZeroBounds:
      maxX === -1 ? null : { minX, minY, maxX, maxY },
  };
};

const assertMaster = async (source: Buffer): Promise<void> => {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(source, INPUT_OPTIONS).metadata();
  } catch {
    throw new DerivativeError("DERIVATIVE_MASTER_INVALID");
  }
  if (
    metadata.format !== "png" ||
    metadata.width !== MASTER_WIDTH ||
    metadata.height !== MASTER_HEIGHT ||
    metadata.channels !== 4 ||
    metadata.hasAlpha !== true ||
    (metadata.bitsPerSample !== 8 && metadata.bitsPerSample !== 16)
  ) {
    throw new DerivativeError("DERIVATIVE_MASTER_INVALID");
  }
};

/**
 * Re-opens a staged derivative, validates the fixed output PNG contract, and
 * returns the immutable facts required for the generated catalog.
 */
export const postValidateDerivative = async (
  input: Uint8Array,
  kind: DerivativeKind,
): Promise<VerifiedDerivative> => {
  const expected = expectedDerivative(kind);
  const data = Buffer.from(input);
  if (data.byteLength > expected.maximumBytes) {
    throw new DerivativeError("DERIVATIVE_OUTPUT_BUDGET_EXCEEDED");
  }
  const chunks = inspectDerivativeChunks(data);
  assertDerivativePngStructure(chunks, expected);
  assertCanonicalIcc(chunks);

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(data, INPUT_OPTIONS).metadata();
  } catch {
    throw new DerivativeError("DERIVATIVE_DECODE_INVALID");
  }
  if (
    metadata.format !== "png" ||
    metadata.width !== expected.width ||
    metadata.height !== expected.height ||
    metadata.channels !== 4 ||
    metadata.bitsPerSample !== 8 ||
    metadata.depth !== "uchar" ||
    metadata.isPalette !== false ||
    metadata.isProgressive !== false ||
    metadata.hasAlpha !== true ||
    metadata.hasProfile !== true ||
    metadata.icc === undefined ||
    sha256(metadata.icc) !== CANONICAL_SRGB_PROFILE_SHA256
  ) {
    throw new DerivativeError("DERIVATIVE_DECODE_INVALID");
  }

  return {
    kind,
    data,
    width: expected.width,
    height: expected.height,
    bitDepth: 8,
    colourType: 6,
    byteSize: data.byteLength,
    sha256: sha256(data),
    profileSha256: CANONICAL_SRGB_PROFILE_SHA256,
    density: {
      xPixelsPerMeter: 1000,
      yPixelsPerMeter: 1000,
      unit: "metre",
    },
    alpha: await inspectAlpha(data, expected),
  };
};

const generateDerivative = async (
  source: Buffer,
  expected: ExpectedDerivative,
): Promise<VerifiedDerivative> => {
  const encoded = await sharp(source, INPUT_OPTIONS)
    .resize({
      width: expected.width,
      height: expected.height,
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
      fastShrinkOnLoad: false,
    })
    .toColourspace("srgb")
    .withIccProfile("srgb")
    .png(PNG_OPTIONS)
    .toBuffer();
  const data = normalizeCanonicalPhys(encoded);
  return postValidateDerivative(data, expected.kind);
};

/**
 * Create both derivatives directly from the supplied master bytes. Work is
 * intentionally sequential so output scheduling cannot influence catalog order.
 */
export const generateDerivatives = async (
  master: Uint8Array,
): Promise<Derivatives> => {
  configureSharpForDerivatives();
  const source = Buffer.from(master);
  await assertMaster(source);
  const runtime = await generateDerivative(source, expectedDerivative("runtime"));
  const thumbnail = await generateDerivative(
    source,
    expectedDerivative("thumbnail"),
  );
  return { runtime, thumbnail };
};
