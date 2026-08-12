import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
] as const;

const crc32 = (input: readonly number[]): number => {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const uint32 = (value: number): readonly number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

export const pngChunk = (
  type: string,
  data: readonly number[] | Uint8Array = [],
): readonly number[] => {
  const typeBytes = [...type].map((character) => character.charCodeAt(0));
  return [
    ...uint32(data.length),
    ...typeBytes,
    ...data,
    ...uint32(crc32([...typeBytes, ...data])),
  ];
};

const compressedScanlineCache = new Map<string, Buffer>();

const compressedTransparentScanlines = (
  width: number,
  height: number,
  bitDepth: number,
): Buffer => {
  const key = `${width}x${height}x${bitDepth}`;
  const cached = compressedScanlineCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const bytesPerSample = bitDepth / 8;
  const compressed = deflateSync(
    Buffer.alloc((1 + width * 4 * bytesPerSample) * height),
    { level: 9 },
  );
  compressedScanlineCache.set(key, compressed);
  return compressed;
};

export const makeTechnicalPng = (
  input: {
    readonly width?: number;
    readonly height?: number;
    readonly bitDepth?: number;
    readonly colorType?: number;
    readonly extraChunks?: readonly (readonly number[])[];
    readonly idatData?: Uint8Array;
    readonly includeSrgb?: boolean;
  } = {},
): Uint8Array => {
  const width = input.width ?? 2048;
  const height = input.height ?? 3072;
  const bitDepth = input.bitDepth ?? 8;
  const colorType = input.colorType ?? 6;
  const ihdr = pngChunk("IHDR", [
    ...uint32(width),
    ...uint32(height),
    bitDepth,
    colorType,
    0,
    0,
    0,
  ]);
  const compressedScanlines =
    input.idatData ??
    compressedTransparentScanlines(width, height, bitDepth);
  return Uint8Array.from([
    ...PNG_SIGNATURE,
    ...ihdr,
    ...(input.includeSrgb === false ? [] : pngChunk("sRGB", [0])),
    ...(input.extraChunks ?? []).flat(),
    ...pngChunk("IDAT", compressedScanlines),
    ...pngChunk("IEND"),
  ]);
};

export const makeAssetEnvelope = (
  overrides: {
    readonly id?: string;
    readonly version?: string;
    readonly slot?: string;
    readonly museId?: string;
    readonly parts?: readonly Record<string, unknown>[];
  } = {},
): Record<string, unknown> => {
  const id = overrides.id ?? "top-fixture-001";
  const version = overrides.version ?? "1.0.0";
  const slot = overrides.slot ?? "top";
  const museId = overrides.museId ?? "muse-editorial-001";
  return {
    schemaVersion: "1.0.0",
    asset: {
      id,
      version,
      slot,
      displayName: "Technical Fixture",
      frame: { width: 2048, height: 3072, origin: "top-left" },
      tags: ["technical-fixture"],
      parts:
        overrides.parts ??
        [
          {
            id: `${id}-main`,
            role: slot,
            sourcePath: `${slot}.png`,
          },
        ],
      compatibility: {
        compatibleMuses: [{ id: museId, version: "1.0.0" }],
        requiresActiveTags: [],
        excludesActiveTags: [],
        incompatibleAssets: [],
      },
    },
    technical: { edgeGuardExceptions: [] },
  };
};

export const writeAssetFixture = async (
  sourceRoot: string,
  input: {
    readonly scope?: string;
    readonly slot?: string;
    readonly id?: string;
    readonly version?: string;
    readonly envelope?: Record<string, unknown>;
    readonly pngs?: Readonly<Record<string, Uint8Array>>;
  } = {},
): Promise<{ readonly directory: string; readonly manifestPath: string }> => {
  const scope = input.scope ?? "muse-editorial-001";
  const slot = input.slot ?? "top";
  const id = input.id ?? "top-fixture-001";
  const version = input.version ?? "1.0.0";
  const directory = path.join(sourceRoot, scope, slot, id, version);
  const manifestPath = path.join(directory, "manifest.json");
  const envelope =
    input.envelope ?? makeAssetEnvelope({ id, version, slot, museId: scope });
  const pngs = input.pngs ?? { [`${slot}.png`]: makeTechnicalPng() };

  await mkdir(directory, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(envelope, undefined, 2)}\n`);
  for (const [filename, bytes] of Object.entries(pngs)) {
    await writeFile(path.join(directory, filename), bytes);
  }
  return { directory, manifestPath };
};
