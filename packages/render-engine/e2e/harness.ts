import {
  createBrowserCanvas2dDriver,
  type BrowserCanvasCommittedFrame,
  type BrowserCanvasStaging,
} from "@editorial-doll/render-engine/browser";
import {
  compositeSourceOverRgba8Pixel,
  type RenderTargetFrame,
  type SceneNode,
} from "@editorial-doll/render-engine";

const syntheticSourceSetId = "a".repeat(64);
const syntheticResourceId = "b".repeat(64);
const syntheticEncodedSha256 = "c".repeat(64);

const runtimeTarget: RenderTargetFrame = Object.freeze({
  target: "runtime",
  representation: "runtime",
  width: 1024,
  height: 1536,
  origin: "top-left",
});

type Rgba = readonly [number, number, number, number];

interface SyntheticProbeReport {
  readonly expected: Rgba;
  readonly observed: Rgba;
  readonly committedPixelsDetached: boolean;
  readonly drawState: {
    readonly composite: string;
    readonly alpha: number;
    readonly smoothing: boolean;
  };
}

interface SyntheticTargetOwnershipReport {
  readonly committedTarget: RenderTargetFrame;
  readonly committedTargetFrozen: boolean;
  readonly committedTargetDetachedFromCaller: boolean;
  readonly committedTargetDetachedFromStaging: boolean;
  readonly stagingTargetFrozen: boolean;
  readonly stagingTargetDetachedFromCaller: boolean;
}

interface SyntheticLifecycleReport {
  readonly commit: { readonly ok: boolean };
  readonly afterCommit: {
    readonly draw: { readonly ok: boolean; readonly kind?: string };
    readonly commit: { readonly ok: boolean; readonly kind?: string };
    readonly discard: { readonly ok: boolean; readonly kind?: string };
  };
  readonly discard: { readonly ok: boolean };
  readonly afterDiscard: {
    readonly draw: { readonly ok: boolean; readonly kind?: string };
    readonly commit: { readonly ok: boolean; readonly kind?: string };
    readonly discard: { readonly ok: boolean; readonly kind?: string };
  };
  readonly readbackFailure: {
    readonly commit: { readonly ok: boolean; readonly kind?: string };
    readonly discard: { readonly ok: boolean; readonly kind?: string };
  };
  readonly resizedCommit: { readonly ok: boolean; readonly kind?: string };
  readonly malformedReadback: { readonly ok: boolean; readonly kind?: string };
  readonly forgedStaging: {
    readonly draw: { readonly ok: boolean; readonly kind?: string };
    readonly commit: { readonly ok: boolean; readonly kind?: string };
    readonly discard: { readonly ok: boolean; readonly kind?: string };
  };
}

interface SyntheticInputDimensionReport {
  readonly stagingMismatch: {
    readonly begin: { readonly ok: boolean; readonly kind?: string };
    readonly surfaceCalls: number;
  };
  readonly sourceMismatch: {
    readonly draw: { readonly ok: boolean; readonly kind?: string };
    readonly pixelAfterRejectedDraw: Rgba;
    readonly discard: { readonly ok: boolean; readonly kind?: string };
    readonly commitAfterDiscard: {
      readonly ok: boolean;
      readonly kind?: string;
    };
  };
}

interface SyntheticContextContractReport {
  readonly attributesAvailable: boolean;
  readonly alpha: boolean | undefined;
  readonly colorSpace: string | undefined;
  readonly initialPixel: Rgba;
  readonly discard: { readonly ok: boolean; readonly kind?: string };
}

const asRgba = (pixels: Uint8ClampedArray): Rgba => [
  pixels[0] ?? 0,
  pixels[1] ?? 0,
  pixels[2] ?? 0,
  pixels[3] ?? 0,
];

const syntheticNode = (): SceneNode => ({
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
    sourceSetId: syntheticSourceSetId,
    resourceId: syntheticResourceId,
    owner: {
      kind: "muse",
      reference: { id: "muse-synthetic-001", version: "1.0.0" },
    },
    role: "muse-body",
    representation: "runtime",
    width: runtimeTarget.width,
    height: runtimeTarget.height,
    encodedSha256: syntheticEncodedSha256,
    encodedBytes: 1,
    encodedBitDepth: 8,
  },
});

const createSyntheticImage = (rgba: Rgba): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = runtimeTarget.width;
  canvas.height = runtimeTarget.height;
  const context = canvas.getContext("2d", { alpha: true, colorSpace: "srgb" });
  if (context === null) {
    throw new Error("Synthetic Canvas 2D source is unavailable.");
  }

  const pixel = context.createImageData(1, 1);
  pixel.data.set(rgba);
  context.putImageData(pixel, 0, 0);
  return canvas;
};

const createSyntheticCanvasDriver = () =>
  createBrowserCanvas2dDriver<HTMLCanvasElement>(
    {
      createStagingCanvas(target) {
        const canvas = document.createElement("canvas");
        canvas.width = target.width;
        canvas.height = target.height;
        return canvas;
      },
    },
    {
      intrinsicDimensions(image) {
        return { width: image.width, height: image.height };
      },
    },
  );

const sampleFrameBytes = (pixels: Uint8ClampedArray): readonly number[] => {
  const tail = pixels.length - 4;
  return [
    pixels[0] ?? -1,
    pixels[1] ?? -1,
    pixels[2] ?? -1,
    pixels[3] ?? -1,
    pixels[tail] ?? -1,
    pixels[tail + 1] ?? -1,
    pixels[tail + 2] ?? -1,
    pixels[tail + 3] ?? -1,
  ];
};

const portOutcome = (
  result:
    | { readonly ok: true }
    | { readonly ok: false; readonly kind: string },
): { readonly ok: boolean; readonly kind?: string } =>
  result.ok ? { ok: true } : { ok: false, kind: result.kind };

const renderSyntheticProbe = async (
  layers: readonly Rgba[],
): Promise<SyntheticProbeReport> => {
  const driver = createSyntheticCanvasDriver();
  const begin = await driver.begin(runtimeTarget);
  if (!begin.ok) {
    throw new Error("Synthetic staging canvas is unavailable.");
  }

  for (const layer of layers) {
    const draw = await driver.draw(begin.value, createSyntheticImage(layer), syntheticNode());
    if (!draw.ok) {
      throw new Error("Synthetic Canvas 2D draw was rejected.");
    }
  }

  const committed = await driver.commit(begin.value);
  if (!committed.ok) {
    throw new Error("Synthetic Canvas 2D readback is unavailable.");
  }

  const expected = layers.reduce<Rgba>(
    (destination, source) => {
      const result = compositeSourceOverRgba8Pixel(
        { red: source[0], green: source[1], blue: source[2], alpha: source[3] },
        {
          red: destination[0],
          green: destination[1],
          blue: destination[2],
          alpha: destination[3],
        },
      );
      return [result.red, result.green, result.blue, result.alpha];
    },
    [0, 0, 0, 0],
  );
  const frame: BrowserCanvasCommittedFrame = committed.value;
  const committedBeforeStagingMutation = sampleFrameBytes(frame.pixels);
  begin.value.context.clearRect(0, 0, runtimeTarget.width, runtimeTarget.height);
  const committedAfterStagingMutation = sampleFrameBytes(frame.pixels);
  return {
    expected,
    observed: asRgba(frame.pixels),
    committedPixelsDetached:
      committedBeforeStagingMutation.length ===
        committedAfterStagingMutation.length &&
      committedBeforeStagingMutation.every(
        (value, index) => value === committedAfterStagingMutation[index],
      ),
    drawState: {
      composite: begin.value.context.globalCompositeOperation,
      alpha: begin.value.context.globalAlpha,
      smoothing: begin.value.context.imageSmoothingEnabled,
    },
  };
};

const renderDimensionFailure = async (): Promise<{
  readonly ok: boolean;
  readonly surfaceCalls: number;
}> => {
  let surfaceCalls = 0;
  const driver = createBrowserCanvas2dDriver<HTMLCanvasElement>(
    {
      createStagingCanvas(target) {
        surfaceCalls += 1;
        const canvas = document.createElement("canvas");
        canvas.width = target.width;
        canvas.height = target.height;
        return canvas;
      },
    },
    {
      intrinsicDimensions(image) {
        return { width: image.width, height: image.height };
      },
    },
  );
  const forgedTarget = {
    target: "runtime",
    representation: "runtime",
    width: 1,
    height: 1,
    origin: "top-left",
  } as unknown as RenderTargetFrame;
  const result = await driver.begin(forgedTarget);
  return { ok: result.ok, surfaceCalls };
};

const renderInputDimensionProbe = async (): Promise<SyntheticInputDimensionReport> => {
  let surfaceCalls = 0;
  const mismatchedSurfaceDriver = createBrowserCanvas2dDriver<HTMLCanvasElement>(
    {
      createStagingCanvas() {
        surfaceCalls += 1;
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        return canvas;
      },
    },
    {
      intrinsicDimensions(image) {
        return { width: image.width, height: image.height };
      },
    },
  );
  const mismatchedBegin = await mismatchedSurfaceDriver.begin(runtimeTarget);

  const driver = createSyntheticCanvasDriver();
  const begin = await driver.begin(runtimeTarget);
  if (!begin.ok) {
    throw new Error("Synthetic intrinsic-dimension staging is unavailable.");
  }
  const onePixelImage = document.createElement("canvas");
  onePixelImage.width = 1;
  onePixelImage.height = 1;
  const onePixelContext = onePixelImage.getContext("2d", {
    alpha: true,
    colorSpace: "srgb",
  });
  if (onePixelContext === null) {
    throw new Error("Synthetic intrinsic-dimension source is unavailable.");
  }
  onePixelContext.fillStyle = "rgba(255, 0, 0, 1)";
  onePixelContext.fillRect(0, 0, 1, 1);

  const draw = await driver.draw(begin.value, onePixelImage, syntheticNode());
  const pixelAfterRejectedDraw = asRgba(
    begin.value.context.getImageData(0, 0, 1, 1).data,
  );
  const discard = await driver.discard(begin.value);
  const commitAfterDiscard = await driver.commit(begin.value);

  return {
    stagingMismatch: {
      begin: portOutcome(mismatchedBegin),
      surfaceCalls,
    },
    sourceMismatch: {
      draw: portOutcome(draw),
      pixelAfterRejectedDraw,
      discard: portOutcome(discard),
      commitAfterDiscard: portOutcome(commitAfterDiscard),
    },
  };
};

const renderContextContractProbe = async (): Promise<SyntheticContextContractReport> => {
  const driver = createSyntheticCanvasDriver();
  const begin = await driver.begin(runtimeTarget);
  if (!begin.ok) {
    throw new Error("Synthetic context-contract staging is unavailable.");
  }

  const attributes =
    typeof begin.value.context.getContextAttributes === "function"
      ? begin.value.context.getContextAttributes()
      : undefined;
  const initialPixel = asRgba(
    begin.value.context.getImageData(0, 0, 1, 1).data,
  );
  const discard = await driver.discard(begin.value);

  return {
    attributesAvailable: attributes !== undefined,
    alpha: attributes?.alpha,
    colorSpace: attributes?.colorSpace,
    initialPixel,
    discard: portOutcome(discard),
  };
};

const renderTargetOwnershipProbe = async (): Promise<SyntheticTargetOwnershipReport> => {
  const callerTarget: RenderTargetFrame = {
    target: "runtime",
    representation: "runtime",
    width: 1024,
    height: 1536,
    origin: "top-left",
  };
  const callerMutationAlias = callerTarget as unknown as {
    target: string;
    representation: string;
    width: number;
    height: number;
    origin: string;
  };
  const driver = createSyntheticCanvasDriver();
  const begin = await driver.begin(callerTarget);
  if (!begin.ok) {
    throw new Error("Synthetic ownership staging canvas is unavailable.");
  }

  callerMutationAlias.width = 1;
  callerMutationAlias.height = 1;
  const committed = await driver.commit(begin.value);
  if (!committed.ok) {
    throw new Error("Synthetic ownership readback is unavailable.");
  }

  callerMutationAlias.target = "export";
  callerMutationAlias.representation = "master";
  callerMutationAlias.origin = "mutated";
  return {
    committedTarget: committed.value.target,
    committedTargetFrozen: Object.isFrozen(committed.value.target),
    committedTargetDetachedFromCaller: committed.value.target !== callerTarget,
    committedTargetDetachedFromStaging:
      committed.value.target !== begin.value.target,
    stagingTargetFrozen: Object.isFrozen(begin.value.target),
    stagingTargetDetachedFromCaller: begin.value.target !== callerTarget,
  };
};

const renderLifecycleProbe = async (): Promise<SyntheticLifecycleReport> => {
  const driver = createSyntheticCanvasDriver();
  const committedBegin = await driver.begin(runtimeTarget);
  if (!committedBegin.ok) {
    throw new Error("Synthetic lifecycle commit staging is unavailable.");
  }
  const commit = await driver.commit(committedBegin.value);
  const afterCommit = {
    draw: portOutcome(
      await driver.draw(
        committedBegin.value,
        createSyntheticImage([1, 2, 3, 255]),
        syntheticNode(),
      ),
    ),
    commit: portOutcome(await driver.commit(committedBegin.value)),
    discard: portOutcome(await driver.discard(committedBegin.value)),
  };

  const discardedBegin = await driver.begin(runtimeTarget);
  if (!discardedBegin.ok) {
    throw new Error("Synthetic lifecycle discard staging is unavailable.");
  }
  const discard = await driver.discard(discardedBegin.value);
  const afterDiscard = {
    draw: portOutcome(
      await driver.draw(
        discardedBegin.value,
        createSyntheticImage([1, 2, 3, 255]),
        syntheticNode(),
      ),
    ),
    commit: portOutcome(await driver.commit(discardedBegin.value)),
    discard: portOutcome(await driver.discard(discardedBegin.value)),
  };

  const readbackBegin = await driver.begin(runtimeTarget);
  if (!readbackBegin.ok) {
    throw new Error("Synthetic lifecycle readback staging is unavailable.");
  }
  const originalGetImageData =
    readbackBegin.value.context.getImageData.bind(readbackBegin.value.context);
  readbackBegin.value.context.getImageData = () => {
    throw new Error("Synthetic readback unavailable.");
  };
  const readbackCommit = await driver.commit(readbackBegin.value);
  readbackBegin.value.context.getImageData = originalGetImageData;
  const readbackDiscard = await driver.discard(readbackBegin.value);

  const resizedBegin = await driver.begin(runtimeTarget);
  if (!resizedBegin.ok) {
    throw new Error("Synthetic lifecycle resize staging is unavailable.");
  }
  resizedBegin.value.canvas.width = 1;
  const resizedCommit = await driver.commit(resizedBegin.value);

  const malformedBegin = await driver.begin(runtimeTarget);
  if (!malformedBegin.ok) {
    throw new Error("Synthetic lifecycle malformed staging is unavailable.");
  }
  malformedBegin.value.context.getImageData = () => new ImageData(1, 1);
  const malformedReadback = await driver.commit(malformedBegin.value);

  const forgedCanvas = document.createElement("canvas");
  forgedCanvas.width = runtimeTarget.width;
  forgedCanvas.height = runtimeTarget.height;
  const forgedContext = forgedCanvas.getContext("2d", {
    alpha: true,
    colorSpace: "srgb",
  });
  if (forgedContext === null) {
    throw new Error("Synthetic forged staging context is unavailable.");
  }
  const forgedStaging: BrowserCanvasStaging = Object.freeze({
    canvas: forgedCanvas,
    context: forgedContext,
    target: runtimeTarget,
  });
  const forgedStagingResults = {
    draw: portOutcome(
      await driver.draw(
        forgedStaging,
        createSyntheticImage([1, 2, 3, 255]),
        syntheticNode(),
      ),
    ),
    commit: portOutcome(await driver.commit(forgedStaging)),
    discard: portOutcome(await driver.discard(forgedStaging)),
  };

  return {
    commit: { ok: commit.ok },
    afterCommit,
    discard: { ok: discard.ok },
    afterDiscard,
    readbackFailure: {
      commit: portOutcome(readbackCommit),
      discard: portOutcome(readbackDiscard),
    },
    resizedCommit: portOutcome(resizedCommit),
    malformedReadback: portOutcome(malformedReadback),
    forgedStaging: forgedStagingResults,
  };
};

declare global {
  interface Window {
    __editorialDollSyntheticRenderHarness: {
      runOpaqueProbe(): Promise<SyntheticProbeReport>;
      runHalfAlphaProbe(): Promise<SyntheticProbeReport>;
      runDimensionFailureProbe(): Promise<{
        readonly ok: boolean;
        readonly surfaceCalls: number;
      }>;
      runInputDimensionProbe(): Promise<SyntheticInputDimensionReport>;
      runContextContractProbe(): Promise<SyntheticContextContractReport>;
      runTargetOwnershipProbe(): Promise<SyntheticTargetOwnershipReport>;
      runLifecycleProbe(): Promise<SyntheticLifecycleReport>;
    };
  }
}

window.__editorialDollSyntheticRenderHarness = Object.freeze({
  runOpaqueProbe: () => renderSyntheticProbe([[200, 100, 50, 255]]),
  runHalfAlphaProbe: () =>
    renderSyntheticProbe([
      [255, 0, 0, 128],
      [0, 0, 255, 128],
    ]),
  runDimensionFailureProbe: renderDimensionFailure,
  runInputDimensionProbe: renderInputDimensionProbe,
  runContextContractProbe: renderContextContractProbe,
  runTargetOwnershipProbe: renderTargetOwnershipProbe,
  runLifecycleProbe: renderLifecycleProbe,
});
