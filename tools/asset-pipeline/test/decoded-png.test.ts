import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  assertDecodedSourcePngAccepted,
  DecodedPngError,
  forEachReconstructedRgbaScanline,
  inspectDecodedSourcePng,
  type DecodedPngErrorCode,
} from "../src/decoded-png.js";
import { pngChunk } from "./helpers.js";

const PNG_SIGNATURE = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
] as const;
const MASTER_WIDTH = 2048;
const MASTER_HEIGHT = 3072;

const uint32 = (value: number): readonly number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

const makeMasterPng = (input: {
  readonly bitDepth?: 8 | 16;
  readonly pixels?: readonly { readonly x: number; readonly y: number; readonly alpha: number }[];
  readonly ancillary?: readonly (readonly number[])[];
  readonly includeSrgb?: boolean;
} = {}): Uint8Array => {
  const bitDepth = input.bitDepth ?? 8;
  const bytesPerSample = bitDepth / 8;
  const stride = 1 + MASTER_WIDTH * 4 * bytesPerSample;
  const scanlines = Buffer.alloc(stride * MASTER_HEIGHT);
  for (const pixel of input.pixels ?? []) {
    const offset = pixel.y * stride + 1 + pixel.x * 4 * bytesPerSample + 3 * bytesPerSample;
    if (bitDepth === 8) {
      scanlines[offset] = pixel.alpha;
    } else {
      scanlines[offset] = (pixel.alpha >>> 8) & 0xff;
      scanlines[offset + 1] = pixel.alpha & 0xff;
    }
  }
  return Uint8Array.from([
    ...PNG_SIGNATURE,
    ...pngChunk("IHDR", [
      ...uint32(MASTER_WIDTH),
      ...uint32(MASTER_HEIGHT),
      bitDepth,
      6,
      0,
      0,
      0,
    ]),
    ...(input.includeSrgb === false ? [] : pngChunk("sRGB", [0])),
    ...(input.ancillary ?? []).flat(),
    ...pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    ...pngChunk("IEND"),
  ]);
};

const expectCode = (callback: () => void, code: DecodedPngErrorCode): void => {
  expect(callback).toThrowError(expect.objectContaining({ code }));
};

describe("decoded PNG reconstruction", () => {
  it("reconstructs PNG filters 0 through 4 byte-for-byte", () => {
    const scanlines = Uint8Array.from([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
      1, 10, 20, 30, 40, 10, 10, 10, 10,
      2, 1, 2, 3, 4, 1, 2, 3, 4,
      3, 5, 5, 5, 5, 5, 5, 5, 5,
      4, 1, 1, 1, 1, 1, 1, 1, 1,
    ]);
    const rows: number[][] = [];
    forEachReconstructedRgbaScanline(scanlines, 2, 5, 8, (row) => {
      rows.push([...row]);
    });
    expect(rows).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8],
      [10, 20, 30, 40, 20, 30, 40, 50],
      [11, 22, 33, 44, 21, 32, 43, 54],
      [10, 16, 21, 27, 20, 29, 37, 45],
      [11, 17, 22, 28, 21, 30, 38, 46],
    ]);
  });

  it("records 8-bit alpha evidence and exact bounds", () => {
    const decoded = inspectDecodedSourcePng(
      makeMasterPng({
        pixels: [
          { x: 16, y: 16, alpha: 128 },
          { x: 100, y: 200, alpha: 255 },
        ],
      }),
      { edgeGuardExceptions: [], isBackground: false },
    );
    expect(decoded).toMatchObject({
      bitDepth: 8,
      srgbRenderingIntent: 0,
      alpha: {
        transparentPixels: MASTER_WIDTH * MASTER_HEIGHT - 2,
        translucentPixels: 1,
        opaquePixels: 1,
        nonZeroBounds: { minX: 16, minY: 16, maxX: 100, maxY: 200 },
        edgeGuardViolations: 0,
        edgeGuardExceptedPixels: 0,
      },
    });
    expect(() => assertDecodedSourcePngAccepted(decoded)).not.toThrow();
  });

  it("preserves 16-bit alpha precision", () => {
    const decoded = inspectDecodedSourcePng(
      makeMasterPng({
        bitDepth: 16,
        pixels: [
          { x: 20, y: 20, alpha: 1 },
          { x: 21, y: 20, alpha: 65_535 },
        ],
      }),
      { edgeGuardExceptions: [], isBackground: false },
    );
    expect(decoded.alpha).toMatchObject({
      transparentPixels: MASTER_WIDTH * MASTER_HEIGHT - 2,
      translucentPixels: 1,
      opaquePixels: 1,
      nonZeroBounds: { minX: 20, minY: 20, maxX: 21, maxY: 20 },
    });
  });

  it("enforces exact edge exception and corner coverage", () => {
    const covered = inspectDecodedSourcePng(
      makeMasterPng({ pixels: [{ x: 0, y: 20, alpha: 255 }] }),
      {
        edgeGuardExceptions: [
          { edge: "left", startInclusive: 20, endInclusive: 20, reason: "fixture" },
        ],
        isBackground: false,
      },
    );
    expect(covered.alpha).toMatchObject({
      edgeGuardViolations: 0,
      edgeGuardExceptedPixels: 1,
    });

    const corner = inspectDecodedSourcePng(
      makeMasterPng({ pixels: [{ x: 0, y: 0, alpha: 255 }] }),
      {
        edgeGuardExceptions: [
          { edge: "top", startInclusive: 0, endInclusive: 0, reason: "fixture" },
        ],
        isBackground: false,
      },
    );
    expectCode(
      () => assertDecodedSourcePngAccepted(corner),
      "EDGE_GUARD_ALPHA_NONZERO",
    );
  });

  it("rejects invalid ancillary metadata and exception declarations", () => {
    expectCode(
      () =>
        inspectDecodedSourcePng(makeMasterPng({ includeSrgb: false }), {
          edgeGuardExceptions: [],
          isBackground: false,
        }),
      "PNG_SRGB_MISSING",
    );
    expectCode(
      () =>
        inspectDecodedSourcePng(
          makeMasterPng({ ancillary: [pngChunk("sRGB", [0])] }),
          { edgeGuardExceptions: [], isBackground: false },
        ),
      "PNG_SRGB_DUPLICATE",
    );
    expectCode(
      () =>
        inspectDecodedSourcePng(
          makeMasterPng({ ancillary: [pngChunk("iCCP", [0])] }),
          { edgeGuardExceptions: [], isBackground: false },
        ),
      "PNG_ICCP_FORBIDDEN",
    );
    expectCode(
      () =>
        inspectDecodedSourcePng(
          makeMasterPng({ ancillary: [pngChunk("pHYs", [0, 0, 0, 1, 0, 0, 0, 1, 1])] }),
          { edgeGuardExceptions: [], isBackground: false },
        ),
      "PNG_ANCILLARY_FORBIDDEN",
    );
    expectCode(
      () =>
        inspectDecodedSourcePng(makeMasterPng(), {
          edgeGuardExceptions: [
            { edge: "top", startInclusive: 0, endInclusive: 10, reason: "first" },
            { edge: "top", startInclusive: 10, endInclusive: 20, reason: "second" },
          ],
          isBackground: false,
        }),
      "EDGE_GUARD_EXCEPTION_OVERLAP",
    );
    expectCode(
      () =>
        inspectDecodedSourcePng(makeMasterPng(), {
          edgeGuardExceptions: [
            { edge: "top", startInclusive: 0, endInclusive: 2047, reason: "blanket" },
          ],
          isBackground: false,
        }),
      "EDGE_GUARD_EXCEPTION_BLANKET",
    );
    expectCode(
      () =>
        inspectDecodedSourcePng(makeMasterPng(), {
          edgeGuardExceptions: [
            { edge: "left", startInclusive: 0, endInclusive: 0, reason: "stale" },
          ],
          isBackground: false,
        }),
      "EDGE_GUARD_EXCEPTION_UNUSED",
    );
  });

  it("accepts only canonical optional gAMA and cHRM metadata", () => {
    const chromaticities = [
      31_270, 32_900, 64_000, 33_000, 30_000, 60_000, 15_000, 6_000,
    ].flatMap(uint32);
    expect(
      inspectDecodedSourcePng(
        makeMasterPng({
          ancillary: [
            pngChunk("gAMA", uint32(45_455)),
            pngChunk("cHRM", chromaticities),
          ],
        }),
        { edgeGuardExceptions: [], isBackground: false },
      ),
    ).toMatchObject({ srgbRenderingIntent: 0 });
    expectCode(
      () =>
        inspectDecodedSourcePng(
          makeMasterPng({ ancillary: [pngChunk("gAMA", uint32(45_454))] }),
          { edgeGuardExceptions: [], isBackground: false },
        ),
      "PNG_GAMA_INVALID",
    );
  });

  it("uses the typed decoded error class", () => {
    try {
      assertDecodedSourcePngAccepted({
        width: 2048,
        height: 3072,
        bitDepth: 8,
        colourType: 6,
        srgbRenderingIntent: 0,
        alpha: {
          transparentPixels: 0,
          translucentPixels: 0,
          opaquePixels: 0,
          nonZeroBounds: null,
          edgeGuardViolations: 1,
          edgeGuardExceptedPixels: 0,
        },
      });
      throw new Error("Expected edge guard rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(DecodedPngError);
    }
  });
});
