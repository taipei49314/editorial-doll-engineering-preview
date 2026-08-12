import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  CANONICAL_SRGB_PROFILE_SHA256,
  generateDerivatives,
  postValidateDerivative,
} from "../src/derivatives.js";
import type { DerivativeError } from "../src/derivatives.js";
import { makeTechnicalPng } from "./helpers.js";

const pngOptions = {
  force: true,
  palette: false,
  progressive: false,
  compressionLevel: 9,
  adaptiveFiltering: false,
} as const;

const makeMaster = async (bitDepth: 8 | 16): Promise<Buffer> => {
  const image = sharp({
    create: {
      width: 2048,
      height: 3072,
      channels: 4,
      background: { r: 24, g: 48, b: 96, alpha: 0.5 },
    },
  });
  return bitDepth === 16
    ? image.toColourspace("rgb16").png(pngOptions).toBuffer()
    : image.png(pngOptions).toBuffer();
};

const chunkTypes = (input: Uint8Array): readonly string[] => {
  const types: string[] = [];
  let offset = 8;
  while (offset < input.byteLength) {
    const length =
      ((input[offset] ?? 0) * 0x1_0000_0000) +
      ((input[offset + 1] ?? 0) << 16) +
      ((input[offset + 2] ?? 0) << 8) +
      (input[offset + 3] ?? 0);
    types.push(
      String.fromCharCode(
        input[offset + 4] ?? 0,
        input[offset + 5] ?? 0,
        input[offset + 6] ?? 0,
        input[offset + 7] ?? 0,
      ),
    );
    offset += length + 12;
  }
  return types;
};

describe("M2.2 deterministic derivative generation", () => {
  it("generates and post-validates fixed full-frame runtime and thumbnail PNGs", async () => {
    const master = await makeMaster(8);
    const derivatives = await generateDerivatives(master);
    const repeated = await generateDerivatives(master);

    expect(derivatives.runtime).toMatchObject({
      kind: "runtime",
      width: 1024,
      height: 1536,
      bitDepth: 8,
      colourType: 6,
      density: { xPixelsPerMeter: 1000, yPixelsPerMeter: 1000, unit: "metre" },
      profileSha256: CANONICAL_SRGB_PROFILE_SHA256,
    });
    expect(derivatives.thumbnail).toMatchObject({
      kind: "thumbnail",
      width: 320,
      height: 480,
      bitDepth: 8,
      colourType: 6,
      density: { xPixelsPerMeter: 1000, yPixelsPerMeter: 1000, unit: "metre" },
      profileSha256: CANONICAL_SRGB_PROFILE_SHA256,
    });
    for (const derivative of [derivatives.runtime, derivatives.thumbnail]) {
      const chunks = chunkTypes(derivative.data);
      expect(chunks[0]).toBe("IHDR");
      expect(chunks.at(-1)).toBe("IEND");
      expect(chunks.filter((chunk) => chunk === "iCCP")).toHaveLength(1);
      expect(chunks.filter((chunk) => chunk === "pHYs")).toHaveLength(1);
      expect(chunks.filter((chunk) => chunk === "IDAT").length).toBeGreaterThan(0);
      expect(chunks.every((chunk) => ["IHDR", "iCCP", "pHYs", "IDAT", "IEND"].includes(chunk))).toBe(true);
      expect(derivative.alpha.transparentPixels).toBe(0);
      expect(derivative.alpha.translucentPixels).toBe(
        derivative.width * derivative.height,
      );
      expect(derivative.alpha.opaquePixels).toBe(0);
      expect(derivative.alpha.nonZeroBounds).toEqual({
        minX: 0,
        minY: 0,
        maxX: derivative.width - 1,
        maxY: derivative.height - 1,
      });
      expect(
        createHash("sha256").update(derivative.data).digest("hex"),
      ).toBe(derivative.sha256);
      await expect(postValidateDerivative(derivative.data, derivative.kind)).resolves.toMatchObject({
        sha256: derivative.sha256,
        alpha: derivative.alpha,
      });
    }
    expect(repeated.runtime.sha256).toBe(derivatives.runtime.sha256);
    expect(repeated.thumbnail.sha256).toBe(derivatives.thumbnail.sha256);
  });

  it("normalizes a 16-bit master to the same 8-bit derivative contract", async () => {
    const derivatives = await generateDerivatives(await makeMaster(16));
    for (const derivative of [derivatives.runtime, derivatives.thumbnail]) {
      const metadata = await sharp(derivative.data).metadata();
      expect(metadata).toMatchObject({
        width: derivative.width,
        height: derivative.height,
        channels: 4,
        bitsPerSample: 8,
        depth: "uchar",
        isPalette: false,
        isProgressive: false,
        hasAlpha: true,
        hasProfile: true,
      });
    }
  });

  it("normalizes density for a source-contract master with no pHYs chunk", async () => {
    const derivatives = await generateDerivatives(makeTechnicalPng());
    expect(derivatives.runtime.density).toEqual({
      xPixelsPerMeter: 1000,
      yPixelsPerMeter: 1000,
      unit: "metre",
    });
    expect(derivatives.thumbnail.density).toEqual(
      derivatives.runtime.density,
    );
  });

  it("rejects an input that is not the complete master frame", async () => {
    const invalidMaster = await sharp({
      create: {
        width: 2047,
        height: 3072,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png(pngOptions)
      .toBuffer();

    await expect(generateDerivatives(invalidMaster)).rejects.toMatchObject({
      code: "DERIVATIVE_MASTER_INVALID",
    } satisfies Partial<DerivativeError>);
  });
});
