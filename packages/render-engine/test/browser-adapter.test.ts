import { describe, expect, it } from "vitest";

import {
  createBrowserCanvas2dDriver,
  type BrowserCanvasStaging,
} from "../src/browser.js";
import type { RenderTargetFrame } from "../src/core/resources.js";
import type { SceneNode } from "../src/core/scene-schema.js";

const runtimeTarget: RenderTargetFrame = Object.freeze({
  target: "runtime",
  representation: "runtime",
  width: 1024,
  height: 1536,
  origin: "top-left",
});

const node = Object.freeze({
  key: "muse:muse-synthetic-001@1.0.0:muse-body:muse-body",
  owner: {
    kind: "muse",
    reference: { id: "muse-synthetic-001", version: "1.0.0" },
  },
  partId: "muse-body",
  role: "muse-body",
  layerOrder: 200,
  placement: {
    x: 0,
    y: 0,
    width: runtimeTarget.width,
    height: runtimeTarget.height,
  },
  composite: "source-over",
  opacity: 1,
  resource: {
    sourceSetId: "a".repeat(64),
    resourceId: "b".repeat(64),
    owner: {
      kind: "muse",
      reference: { id: "muse-synthetic-001", version: "1.0.0" },
    },
    role: "muse-body",
    representation: "runtime",
    width: runtimeTarget.width,
    height: runtimeTarget.height,
    encodedSha256: "c".repeat(64),
    encodedBytes: 1,
    encodedBitDepth: 8,
  },
} satisfies SceneNode);

type ReadbackMode = "ok" | "throw" | "short";

interface MockSurface {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly events: unknown[][];
  readonly requestedContexts: unknown[][];
  setReadbackMode(mode: ReadbackMode): void;
}

const createMockSurface = (
  attributes: { readonly alpha: boolean; readonly colorSpace: string } = {
    alpha: true,
    colorSpace: "srgb",
  },
): MockSurface => {
  const events: unknown[][] = [];
  const requestedContexts: unknown[][] = [];
  let composite = "multiply";
  let alpha = 0.25;
  let smoothing = true;
  let readbackMode: ReadbackMode = "ok";

  const rawContext = {
    clearRect: (...arguments_: unknown[]) => {
      events.push(["clearRect", ...arguments_]);
    },
    drawImage: (...arguments_: unknown[]) => {
      events.push(["drawImage", ...arguments_]);
    },
    getContextAttributes: () => attributes,
    getImageData: () => {
      if (readbackMode === "throw") {
        throw new Error("readback unavailable");
      }
      const length =
        readbackMode === "short"
          ? 4
          : runtimeTarget.width * runtimeTarget.height * 4;
      return { data: new Uint8ClampedArray(length) };
    },
    setTransform: (...arguments_: unknown[]) => {
      events.push(["setTransform", ...arguments_]);
    },
  };

  Object.defineProperties(rawContext, {
    globalCompositeOperation: {
      configurable: true,
      get: () => composite,
      set: (value: string) => {
        composite = value;
        events.push(["globalCompositeOperation", value]);
      },
    },
    globalAlpha: {
      configurable: true,
      get: () => alpha,
      set: (value: number) => {
        alpha = value;
        events.push(["globalAlpha", value]);
      },
    },
    imageSmoothingEnabled: {
      configurable: true,
      get: () => smoothing,
      set: (value: boolean) => {
        smoothing = value;
        events.push(["imageSmoothingEnabled", value]);
      },
    },
  });

  const context = rawContext as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: runtimeTarget.width,
    height: runtimeTarget.height,
    getContext: (...arguments_: unknown[]) => {
      requestedContexts.push(arguments_);
      return context;
    },
  } as unknown as HTMLCanvasElement;

  return {
    canvas,
    context,
    events,
    requestedContexts,
    setReadbackMode(mode) {
      readbackMode = mode;
    },
  };
};

const image = Object.freeze({}) as CanvasImageSource;
const wrongSizedImage = Object.freeze({}) as CanvasImageSource;

const createDriver = (surface: MockSurface) =>
  createBrowserCanvas2dDriver<CanvasImageSource>(
    { createStagingCanvas: () => surface.canvas },
    {
      intrinsicDimensions(candidate) {
        return candidate === image
          ? { width: runtimeTarget.width, height: runtimeTarget.height }
          : candidate === wrongSizedImage
            ? { width: 1, height: 1 }
            : undefined;
      },
    },
  );

const expectFailed = (result: { readonly ok: boolean; readonly kind?: string }): void => {
  expect(result).toEqual({ ok: false, kind: "failed" });
};

describe("browser Canvas 2D adapter", () => {
  it("requires a transparent sRGB context and records the exact request", async () => {
    const surface = createMockSurface();
    const begin = await createDriver(surface).begin(runtimeTarget);

    expect(begin.ok).toBe(true);
    expect(surface.requestedContexts).toEqual([
      [
        "2d",
        {
          alpha: true,
          colorSpace: "srgb",
          willReadFrequently: true,
        },
      ],
    ]);

    for (const attributes of [
      { alpha: false, colorSpace: "srgb" },
      { alpha: true, colorSpace: "display-p3" },
    ]) {
      const rejected = await createDriver(createMockSurface(attributes)).begin(
        runtimeTarget,
      );
      expectFailed(rejected);
    }

    const nullContextCanvas = {
      width: runtimeTarget.width,
      height: runtimeTarget.height,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const nullContextDriver = createBrowserCanvas2dDriver<CanvasImageSource>(
      { createStagingCanvas: () => nullContextCanvas },
      { intrinsicDimensions: () => undefined },
    );
    expectFailed(await nullContextDriver.begin(runtimeTarget));
  });

  it("resets state before every draw and uses only drawImage(image, 0, 0)", async () => {
    const surface = createMockSurface();
    const driver = createDriver(surface);
    const begin = await driver.begin(runtimeTarget);
    if (!begin.ok) {
      throw new Error("mock staging must begin");
    }

    for (let drawIndex = 0; drawIndex < 2; drawIndex += 1) {
      surface.context.globalCompositeOperation = "multiply";
      surface.context.globalAlpha = 0.25;
      surface.context.imageSmoothingEnabled = true;
      surface.events.length = 0;

      expect(await driver.draw(begin.value, image, node)).toEqual({ ok: true });
      expect(surface.events).toEqual([
        ["setTransform", 1, 0, 0, 1, 0, 0],
        ["globalCompositeOperation", "source-over"],
        ["globalAlpha", 1],
        ["imageSmoothingEnabled", false],
        ["drawImage", image, 0, 0],
      ]);
    }

    surface.events.length = 0;
    expectFailed(await driver.draw(begin.value, wrongSizedImage, node));
    expect(surface.events).toEqual([]);
    expect(await driver.discard(begin.value)).toEqual({ ok: true });
  });

  it("classifies readback and structural commit failures and settles transactions once", async () => {
    const readbackSurface = createMockSurface();
    const readbackDriver = createDriver(readbackSurface);
    const readbackBegin = await readbackDriver.begin(runtimeTarget);
    if (!readbackBegin.ok) {
      throw new Error("mock readback staging must begin");
    }
    readbackSurface.setReadbackMode("throw");
    expect(await readbackDriver.commit(readbackBegin.value)).toEqual({
      ok: false,
      kind: "readback-unavailable",
    });
    expect(await readbackDriver.discard(readbackBegin.value)).toEqual({ ok: true });
    expectFailed(await readbackDriver.commit(readbackBegin.value));

    const shortSurface = createMockSurface();
    const shortDriver = createDriver(shortSurface);
    const shortBegin = await shortDriver.begin(runtimeTarget);
    if (!shortBegin.ok) {
      throw new Error("mock short-read staging must begin");
    }
    shortSurface.setReadbackMode("short");
    expectFailed(await shortDriver.commit(shortBegin.value));
    expect(await shortDriver.discard(shortBegin.value)).toEqual({ ok: true });

    const resizedSurface = createMockSurface();
    const resizedDriver = createDriver(resizedSurface);
    const resizedBegin = await resizedDriver.begin(runtimeTarget);
    if (!resizedBegin.ok) {
      throw new Error("mock resized staging must begin");
    }
    resizedSurface.canvas.width = 1;
    expectFailed(await resizedDriver.commit(resizedBegin.value));
    resizedSurface.canvas.width = runtimeTarget.width;
    expect(await resizedDriver.discard(resizedBegin.value)).toEqual({ ok: true });

    const committedSurface = createMockSurface();
    const committedDriver = createDriver(committedSurface);
    const committedBegin = await committedDriver.begin(runtimeTarget);
    if (!committedBegin.ok) {
      throw new Error("mock committed staging must begin");
    }
    expect((await committedDriver.commit(committedBegin.value)).ok).toBe(true);
    expectFailed(await committedDriver.draw(committedBegin.value, image, node));
    expectFailed(await committedDriver.commit(committedBegin.value));
    expectFailed(await committedDriver.discard(committedBegin.value));

    const discardedSurface = createMockSurface();
    const discardedDriver = createDriver(discardedSurface);
    const discardedBegin = await discardedDriver.begin(runtimeTarget);
    if (!discardedBegin.ok) {
      throw new Error("mock discarded staging must begin");
    }
    expect(await discardedDriver.discard(discardedBegin.value)).toEqual({ ok: true });
    expectFailed(await discardedDriver.draw(discardedBegin.value, image, node));
    expectFailed(await discardedDriver.commit(discardedBegin.value));
    expectFailed(await discardedDriver.discard(discardedBegin.value));

    const forgedSurface = createMockSurface();
    const forgedDriver = createDriver(forgedSurface);
    const forgedStaging: BrowserCanvasStaging = Object.freeze({
      canvas: forgedSurface.canvas,
      context: forgedSurface.context,
      target: runtimeTarget,
    });
    expectFailed(await forgedDriver.draw(forgedStaging, image, node));
    expectFailed(await forgedDriver.commit(forgedStaging));
    expectFailed(await forgedDriver.discard(forgedStaging));
  });
});
