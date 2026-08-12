import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";

import {
  inspectPortablePng,
  inspectPngStructure,
  PngStructureError,
  type PngStructureErrorCode,
} from "../src/png.js";
import { makeTechnicalPng } from "./helpers.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crc32(input: readonly number[]): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: readonly number[] | Uint8Array = []): number[] {
  const typeBytes = [...type].map((character) => character.charCodeAt(0));
  const crc = crc32([...typeBytes, ...data]);
  return [...uint32(data.length), ...typeBytes, ...data, ...uint32(crc)];
}

function ihdr(options: {
  readonly width?: number;
  readonly height?: number;
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly compressionMethod?: number;
  readonly filterMethod?: number;
  readonly interlaceMethod?: number;
} = {}): number[] {
  return chunk("IHDR", [
    ...uint32(options.width ?? 2048),
    ...uint32(options.height ?? 3072),
    options.bitDepth ?? 8,
    options.colorType ?? 6,
    options.compressionMethod ?? 0,
    options.filterMethod ?? 0,
    options.interlaceMethod ?? 0,
  ]);
}

function png(chunks: readonly number[][]): Uint8Array {
  return Uint8Array.from([...PNG_SIGNATURE, ...chunks.flat()]);
}

function validPng(): Uint8Array {
  return png([ihdr(), chunk("IDAT", [0]), chunk("IEND")]);
}

function expectCode(input: Uint8Array, code: PngStructureErrorCode): void {
  expect(() => inspectPngStructure(input)).toThrowError(
    expect.objectContaining({ code }),
  );
}

function expectPortableCode(
  input: Uint8Array,
  code: PngStructureErrorCode,
): void {
  expect(() => inspectPortablePng(input)).toThrowError(
    expect.objectContaining({ code }),
  );
}

describe("inspectPngStructure", () => {
  it("returns portable master PNG facts", () => {
    expect(inspectPngStructure(validPng())).toEqual({
      width: 2048,
      height: 3072,
      bitDepth: 8,
      colorType: 6,
      chunks: {
        chunkTypes: ["IHDR", "IDAT", "IEND"],
        hasIdat: true,
        hasIend: true,
        hasPalette: false,
        hasApng: false,
        hasOffset: false,
      },
    });
    expect(
      inspectPngStructure(
        png([ihdr({ bitDepth: 16 }), chunk("IDAT"), chunk("IEND")]),
      ),
    ).toMatchObject({ bitDepth: 16 });
  });

  it("uses a typed stable error", () => {
    try {
      inspectPngStructure(Uint8Array.of(0));
      throw new Error("Expected inspection to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PngStructureError);
      expect((error as PngStructureError).code).toBe("PNG_INVALID_SIGNATURE");
    }
  });

  it("validates a bounded zlib scanline stream", () => {
    expect(inspectPortablePng(makeTechnicalPng())).toMatchObject({
      width: 2048,
      height: 3072,
      bitDepth: 8,
      colorType: 6,
    });
    expectPortableCode(validPng(), "PNG_IMAGE_DATA_INVALID");

    const shortStream = deflateSync(Buffer.alloc(1));
    expectPortableCode(
      png([ihdr(), chunk("IDAT", shortStream), chunk("IEND")]),
      "PNG_IMAGE_DATA_LENGTH_INVALID",
    );

    const scanlines = Buffer.alloc((1 + 2048 * 4) * 3072);
    const validStream = deflateSync(scanlines, { level: 9 });
    expectPortableCode(
      png([
        ihdr(),
        chunk("IDAT", Buffer.concat([validStream, Buffer.of(0)])),
        chunk("IEND"),
      ]),
      "PNG_IMAGE_DATA_TRAILING_BYTES",
    );
    expectPortableCode(
      png([
        ihdr(),
        chunk(
          "IDAT",
          Buffer.concat([validStream, deflateSync(Buffer.alloc(1))]),
        ),
        chunk("IEND"),
      ]),
      "PNG_IMAGE_DATA_TRAILING_BYTES",
    );

    scanlines[0] = 5;
    const invalidFilterStream = deflateSync(scanlines, { level: 9 });
    expectPortableCode(
      png([ihdr(), chunk("IDAT", invalidFilterStream), chunk("IEND")]),
      "PNG_SCANLINE_FILTER_INVALID",
    );
  });

  it.each([
    [Uint8Array.of(...PNG_SIGNATURE, 0), "PNG_CHUNK_TRUNCATED"],
    [png([chunk("IDAT"), chunk("IEND")]), "PNG_IHDR_NOT_FIRST"],
    [png([chunk("IHDR", []), chunk("IDAT"), chunk("IEND")]), "PNG_IHDR_INVALID_LENGTH"],
    [png([ihdr(), ihdr(), chunk("IDAT"), chunk("IEND")]), "PNG_IHDR_DUPLICATE"],
    [png([ihdr(), chunk("IDAT"), chunk("IEND", [1])]), "PNG_IEND_INVALID_LENGTH"],
    [png([ihdr(), chunk("IEND")]), "PNG_IDAT_MISSING"],
    [Uint8Array.of(...PNG_SIGNATURE), "PNG_IHDR_MISSING"],
    [png([ihdr(), chunk("IDAT")]), "PNG_IEND_MISSING"],
    [Uint8Array.of(...validPng(), 0), "PNG_TRAILING_BYTES"],
    [png([ihdr({ width: 2047 }), chunk("IDAT"), chunk("IEND")]), "PNG_DIMENSIONS_INVALID"],
    [png([ihdr({ colorType: 2 }), chunk("IDAT"), chunk("IEND")]), "PNG_COLOR_TYPE_INVALID"],
    [png([ihdr({ bitDepth: 4 }), chunk("IDAT"), chunk("IEND")]), "PNG_BIT_DEPTH_INVALID"],
    [png([ihdr({ compressionMethod: 1 }), chunk("IDAT"), chunk("IEND")]), "PNG_COMPRESSION_METHOD_INVALID"],
    [png([ihdr({ filterMethod: 1 }), chunk("IDAT"), chunk("IEND")]), "PNG_FILTER_METHOD_INVALID"],
    [png([ihdr({ interlaceMethod: 2 }), chunk("IDAT"), chunk("IEND")]), "PNG_INTERLACE_METHOD_INVALID"],
    [png([ihdr(), chunk("IDAT"), chunk("tEXt"), chunk("IDAT"), chunk("IEND")]), "PNG_IDAT_NONCONTIGUOUS"],
    [png([ihdr(), chunk("PLTE"), chunk("IDAT"), chunk("IEND")]), "PNG_PALETTE_FORBIDDEN"],
    [png([ihdr(), chunk("acTL"), chunk("IDAT"), chunk("IEND")]), "PNG_APNG_FORBIDDEN"],
    [png([ihdr(), chunk("oFFs"), chunk("IDAT"), chunk("IEND")]), "PNG_OFFSET_FORBIDDEN"],
    [png([ihdr(), chunk("ABCD"), chunk("IDAT"), chunk("IEND")]), "PNG_UNKNOWN_CRITICAL_CHUNK"],
  ] as const)("rejects %s with %s", (input, code) => {
    expectCode(input, code);
  });

  it("rejects malformed chunk type and mismatched CRC", () => {
    const malformedType = validPng();
    malformedType[12] = 0;
    expectCode(malformedType, "PNG_INVALID_CHUNK_TYPE");

    const badCrc = validPng();
    badCrc[32] = (badCrc[32] ?? 0) ^ 0xff;
    expectCode(badCrc, "PNG_CHUNK_CRC_MISMATCH");
  });
});
