export const RGBA8_CHANNELS = 4 as const;

export interface Rgba8Image {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

export interface Rgba8Pixel {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

const CHANNEL_MAX = 255;

const clampByte = (value: number): number =>
  value < 0 ? 0 : value > CHANNEL_MAX ? CHANNEL_MAX : value;

/**
 * The M3 reference rounding rule. Inputs are non-negative integer numerators
 * and positive integer denominators, so this is a deterministic round-half-up
 * operation without a floating-point division.
 */
export const roundHalfUp = (numerator: number, denominator: number): number =>
  Math.floor((2 * numerator + denominator) / (2 * denominator));

const asPixel = (
  red: number,
  green: number,
  blue: number,
  alpha: number,
): Rgba8Pixel =>
  Object.freeze({
    red: clampByte(red),
    green: clampByte(green),
    blue: clampByte(blue),
    alpha: clampByte(alpha),
  });

/**
 * Composites a straight/unassociated sRGB RGBA8 source over a straight/
 * unassociated sRGB RGBA8 destination using the normative M3 integer formula.
 * No gamma conversion or implementation-selected floating-point arithmetic is
 * used here.
 */
export const compositeSourceOverRgba8Pixel = (
  source: Rgba8Pixel,
  destination: Rgba8Pixel,
): Rgba8Pixel => {
  const alphaNumerator =
    source.alpha * CHANNEL_MAX +
    destination.alpha * (CHANNEL_MAX - source.alpha);
  const alpha = roundHalfUp(alphaNumerator, CHANNEL_MAX);

  if (alphaNumerator === 0) {
    return asPixel(0, 0, 0, 0);
  }

  const compositeChannel = (sourceChannel: number, destinationChannel: number): number =>
    clampByte(
      roundHalfUp(
        sourceChannel * source.alpha * CHANNEL_MAX +
          destinationChannel *
            destination.alpha *
            (CHANNEL_MAX - source.alpha),
        alphaNumerator,
      ),
    );

  return asPixel(
    compositeChannel(source.red, destination.red),
    compositeChannel(source.green, destination.green),
    compositeChannel(source.blue, destination.blue),
    alpha,
  );
};

const expectedByteLength = (width: number, height: number): number =>
  width * height * RGBA8_CHANNELS;

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8ClampedArray.prototype,
) as object;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;

const isUint8ClampedArray = (value: unknown): value is Uint8ClampedArray => {
  if (!ArrayBuffer.isView(value) || typedArrayTagGetter === undefined) {
    return false;
  }
  try {
    // Call the intrinsic %TypedArray% brand getter directly. Unlike
    // Object#toString, this ignores a caller-supplied Symbol.toStringTag and
    // reads the actual typed-array internal slot, including across realms.
    return Reflect.apply(typedArrayTagGetter, value, []) === "Uint8ClampedArray";
  } catch {
    return false;
  }
};

const assertRgba8Image = (image: Rgba8Image): void => {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    !isUint8ClampedArray(image.pixels) ||
    image.pixels.byteLength !== expectedByteLength(image.width, image.height)
  ) {
    throw new RangeError("Expected a complete positive RGBA8 image buffer.");
  }
};

/** Creates a newly owned transparent RGBA8 image. */
export const createTransparentRgba8Image = (
  width: number,
  height: number,
): Rgba8Image => {
  const pixels = new Uint8ClampedArray(expectedByteLength(width, height));
  const image = { width, height, pixels };
  assertRgba8Image(image);
  return Object.freeze(image);
};

/**
 * Applies source-over directly into a driver-owned destination surface. The
 * source pixels are never changed. This is intentionally separate from the
 * pure allocating compositor so the reference transaction driver keeps only
 * one decoded source and one staging surface while drawing.
 */
export const compositeSourceOverRgba8Into = (
  source: Rgba8Image,
  destination: Rgba8Image,
): void => {
  assertRgba8Image(source);
  assertRgba8Image(destination);
  if (
    source.width !== destination.width ||
    source.height !== destination.height
  ) {
    throw new RangeError("RGBA8 source and destination dimensions must match.");
  }

  const sourcePixels = source.pixels;
  const destinationPixels = destination.pixels;
  for (
    let offset = 0;
    offset < destinationPixels.byteLength;
    offset += RGBA8_CHANNELS
  ) {
    const sourceAlpha = sourcePixels[offset + 3] as number;
    if (sourceAlpha === 0) {
      // Fully transparent source preserves an existing destination. When both
      // alphas are zero, canonical transparent black avoids retaining invalid
      // colour channels beneath zero alpha.
      if (
        (destinationPixels[offset + 3] as number) === 0 &&
        ((destinationPixels[offset] as number) !== 0 ||
          (destinationPixels[offset + 1] as number) !== 0 ||
          (destinationPixels[offset + 2] as number) !== 0)
      ) {
        destinationPixels[offset] = 0;
        destinationPixels[offset + 1] = 0;
        destinationPixels[offset + 2] = 0;
        destinationPixels[offset + 3] = 0;
      }
      continue;
    }
    const destinationAlpha = destinationPixels[offset + 3] as number;
    if (destinationAlpha === 0 || sourceAlpha === CHANNEL_MAX) {
      destinationPixels[offset] = sourcePixels[offset] as number;
      destinationPixels[offset + 1] = sourcePixels[offset + 1] as number;
      destinationPixels[offset + 2] = sourcePixels[offset + 2] as number;
      destinationPixels[offset + 3] = sourceAlpha;
      continue;
    }
    const alphaNumerator =
      sourceAlpha * CHANNEL_MAX +
      destinationAlpha * (CHANNEL_MAX - sourceAlpha);

    if (alphaNumerator === 0) {
      destinationPixels[offset] = 0;
      destinationPixels[offset + 1] = 0;
      destinationPixels[offset + 2] = 0;
      destinationPixels[offset + 3] = 0;
      continue;
    }

    const inverseSourceAlpha = CHANNEL_MAX - sourceAlpha;
    for (let channel = 0; channel < 3; channel += 1) {
      destinationPixels[offset + channel] = Math.floor(
        (2 *
          (sourcePixels[offset + channel] as number) *
          sourceAlpha *
          CHANNEL_MAX +
          2 *
            (destinationPixels[offset + channel] as number) *
            destinationAlpha *
            inverseSourceAlpha +
          alphaNumerator) /
          (2 * alphaNumerator),
      );
    }
    destinationPixels[offset + 3] = Math.floor(
      (2 * alphaNumerator + CHANNEL_MAX) / (2 * CHANNEL_MAX),
    );
  }
};

/**
 * Returns a newly allocated source-over composition. Both inputs are read-only
 * from this function's perspective; neither typed array is retained or changed.
 */
export const compositeSourceOverRgba8Image = (
  source: Rgba8Image,
  destination: Rgba8Image,
): Rgba8Image => {
  assertRgba8Image(source);
  assertRgba8Image(destination);
  if (
    source.width !== destination.width ||
    source.height !== destination.height
  ) {
    throw new RangeError("RGBA8 source and destination dimensions must match.");
  }

  const pixels = new Uint8ClampedArray(destination.pixels);
  const result = { width: source.width, height: source.height, pixels };
  compositeSourceOverRgba8Into(source, result);

  return Object.freeze(result);
};
