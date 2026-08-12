import { describe, expect, it } from "vitest";

import {
  compositeSourceOverRgba8Image,
  compositeSourceOverRgba8Into,
  compositeSourceOverRgba8Pixel,
  createTransparentRgba8Image,
  type Rgba8Image,
  type Rgba8Pixel,
} from "../src/core/rgba8.js";

const pixel = (
  red: number,
  green: number,
  blue: number,
  alpha: number,
): Rgba8Pixel => ({ red, green, blue, alpha });

const rgba = (value: Rgba8Pixel): readonly number[] => [
  value.red,
  value.green,
  value.blue,
  value.alpha,
];

const onePixelImage = (values: readonly number[]): Rgba8Image =>
  Object.freeze({
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray(values),
  });

describe("M3 reference RGBA8 source-over compositor", () => {
  it.each([
    {
      source: pixel(10, 20, 30, 0),
      destination: pixel(40, 50, 60, 0),
      expected: [0, 0, 0, 0],
    },
    {
      source: pixel(10, 20, 30, 0),
      destination: pixel(40, 50, 60, 200),
      expected: [40, 50, 60, 200],
    },
    {
      source: pixel(200, 100, 50, 255),
      destination: pixel(1, 2, 3, 77),
      expected: [200, 100, 50, 255],
    },
    {
      source: pixel(255, 0, 0, 128),
      destination: pixel(0, 0, 0, 0),
      expected: [255, 0, 0, 128],
    },
    {
      source: pixel(0, 0, 255, 128),
      destination: pixel(255, 0, 0, 128),
      expected: [85, 0, 170, 192],
    },
    {
      source: pixel(255, 255, 255, 1),
      destination: pixel(0, 0, 0, 254),
      expected: [1, 1, 1, 254],
    },
  ])("matches the normative source-over vector %#", ({ source, destination, expected }) => {
    expect(rgba(compositeSourceOverRgba8Pixel(source, destination))).toEqual(
      expected,
    );
  });

  it.each([
    { source: [10, 20, 30, 0], destination: [40, 50, 60, 0], expected: [0, 0, 0, 0] },
    { source: [10, 20, 30, 0], destination: [40, 50, 60, 200], expected: [40, 50, 60, 200] },
    { source: [200, 100, 50, 255], destination: [1, 2, 3, 77], expected: [200, 100, 50, 255] },
    { source: [255, 0, 0, 128], destination: [0, 0, 0, 0], expected: [255, 0, 0, 128] },
    { source: [0, 0, 255, 128], destination: [255, 0, 0, 128], expected: [85, 0, 170, 192] },
    { source: [255, 255, 255, 1], destination: [0, 0, 0, 254], expected: [1, 1, 1, 254] },
  ])("matches the normative vector through allocating and in-place image paths %#", ({ source, destination, expected }) => {
    const sourceImage = onePixelImage(source);
    const destinationImage = onePixelImage(destination);
    const staging = onePixelImage(destination);
    const beforeSource = [...sourceImage.pixels];

    const allocated = compositeSourceOverRgba8Image(sourceImage, destinationImage);
    compositeSourceOverRgba8Into(sourceImage, staging);

    expect([...allocated.pixels]).toEqual(expected);
    expect([...staging.pixels]).toEqual(expected);
    expect([...sourceImage.pixels]).toEqual(beforeSource);
  });

  it("matches the normative ordered three-layer accumulation", () => {
    const green = pixel(0, 255, 0, 64);
    const red = pixel(255, 0, 0, 128);
    const blue = pixel(0, 0, 255, 192);
    const transparent = pixel(0, 0, 0, 0);

    const result = compositeSourceOverRgba8Pixel(
      blue,
      compositeSourceOverRgba8Pixel(
        red,
        compositeSourceOverRgba8Pixel(green, transparent),
      ),
    );

    expect(rgba(result)).toEqual([35, 9, 211, 232]);
  });

  it("preserves input image bytes and returns a detached image allocation", () => {
    const source = onePixelImage([0, 0, 255, 128]);
    const destination = onePixelImage([255, 0, 0, 128]);
    const beforeSource = [...source.pixels];
    const beforeDestination = [...destination.pixels];

    const result = compositeSourceOverRgba8Image(source, destination);

    expect([...source.pixels]).toEqual(beforeSource);
    expect([...destination.pixels]).toEqual(beforeDestination);
    expect(result.pixels).not.toBe(source.pixels);
    expect(result.pixels).not.toBe(destination.pixels);
    expect([...result.pixels]).toEqual([85, 0, 170, 192]);
  });

  it("clears newly owned surfaces to transparent black", () => {
    const image = createTransparentRgba8Image(2, 1);

    expect(image.pixels).toBeInstanceOf(Uint8ClampedArray);
    expect([...image.pixels]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("rejects mismatched source and destination frames", () => {
    expect(() =>
      compositeSourceOverRgba8Image(
        createTransparentRgba8Image(1, 1),
        createTransparentRgba8Image(2, 1),
      ),
    ).toThrow("dimensions must match");
  });

  it("rejects byte-compatible buffers that are not Uint8ClampedArray RGBA8", () => {
    const floatPixels = new Float32Array([255]);
    const invalidSource = {
      width: 1,
      height: 1,
      pixels: floatPixels,
    } as unknown as Rgba8Image;
    const spoofedFloatPixels = new Float32Array([255]);
    Object.defineProperty(spoofedFloatPixels, Symbol.toStringTag, {
      value: "Uint8ClampedArray",
    });
    const spoofedSource = {
      width: 1,
      height: 1,
      pixels: spoofedFloatPixels,
    } as unknown as Rgba8Image;
    const destination = onePixelImage([0, 0, 0, 0]);

    expect(() =>
      compositeSourceOverRgba8Image(invalidSource, destination),
    ).toThrow("complete positive RGBA8 image buffer");
    expect(() =>
      compositeSourceOverRgba8Into(invalidSource, destination),
    ).toThrow("complete positive RGBA8 image buffer");
    expect(() =>
      compositeSourceOverRgba8Image(spoofedSource, destination),
    ).toThrow("complete positive RGBA8 image buffer");
  });
});
