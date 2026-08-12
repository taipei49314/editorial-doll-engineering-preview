import {
  PortOperationResultSchema,
  createPortValueResultSchema,
  type PortOperationResult,
  type PortValueResult,
  type TransactionalRenderDriver,
} from "./core/ports.js";
import {
  RenderTargetFrameSchema,
  type RenderTargetFrame,
} from "./core/resources.js";
import type { SceneNode } from "./core/scene-schema.js";

export interface BrowserCanvasImageDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * The host owns image handles. It supplies their intrinsic dimensions so this
 * adapter never has to infer a resource from a page or application state.
 */
export interface BrowserCanvasImageProvider<TImage extends CanvasImageSource> {
  intrinsicDimensions(image: TImage): BrowserCanvasImageDimensions | undefined;
}

/**
 * The host creates a new, detached staging canvas for every render attempt.
 * This adapter deliberately does not discover or retain a canvas from a DOM.
 */
export interface BrowserCanvasSurfaceProvider {
  createStagingCanvas(target: RenderTargetFrame): HTMLCanvasElement | undefined;
}

export interface BrowserCanvasStaging {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly target: RenderTargetFrame;
}

/** A newly-owned RGBA8 readback; this is not an encoded export file. */
export interface BrowserCanvasCommittedFrame {
  readonly target: RenderTargetFrame;
  readonly pixels: Uint8ClampedArray;
}

const operationSucceeded = (): PortOperationResult =>
  PortOperationResultSchema.parse({ ok: true });

const operationFailed = (): PortOperationResult =>
  PortOperationResultSchema.parse({ ok: false, kind: "failed" });

const valueSucceeded = <TValue>(value: TValue): PortValueResult<TValue> =>
  createPortValueResultSchema<TValue>().parse({ ok: true, value });

const valueFailed = <TValue>(): PortValueResult<TValue> =>
  createPortValueResultSchema<TValue>().parse({ ok: false, kind: "failed" });

const readbackUnavailable = <TValue>(): PortValueResult<TValue> =>
  createPortValueResultSchema<TValue>().parse({
    ok: false,
    kind: "readback-unavailable",
  });

const snapshotTargetFrame = (
  target: RenderTargetFrame,
): RenderTargetFrame =>
  target.target === "runtime"
    ? Object.freeze({
        target: target.target,
        representation: target.representation,
        width: target.width,
        height: target.height,
        origin: target.origin,
      })
    : Object.freeze({
        target: target.target,
        representation: target.representation,
        width: target.width,
        height: target.height,
        origin: target.origin,
      });

const hasExactFrame = (
  canvas: HTMLCanvasElement,
  target: RenderTargetFrame,
): boolean => canvas.width === target.width && canvas.height === target.height;

const matchesNodeFrame = (
  node: SceneNode,
  target: RenderTargetFrame,
): boolean =>
  node.placement.x === 0 &&
  node.placement.y === 0 &&
  node.placement.width === target.width &&
  node.placement.height === target.height &&
  node.composite === "source-over" &&
  node.opacity === 1;

const prepareForSourceOver = (context: CanvasRenderingContext2D): void => {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.imageSmoothingEnabled = false;
};

/**
 * Creates the M3 Canvas 2D transactional driver. Canvas and image ownership
 * stay with the supplied providers; this function neither reads page state nor
 * discovers DOM resources. Successful commits return a detached RGBA8 copy.
 */
export const createBrowserCanvas2dDriver = <TImage extends CanvasImageSource>(
  surfaceProvider: BrowserCanvasSurfaceProvider,
  imageProvider: BrowserCanvasImageProvider<TImage>,
): TransactionalRenderDriver<
  TImage,
  BrowserCanvasStaging,
  BrowserCanvasCommittedFrame
> => {
  const active = new WeakSet<BrowserCanvasStaging>();
  const settled = new WeakSet<BrowserCanvasStaging>();

  return {
    async begin(target) {
      try {
        const parsedTarget = RenderTargetFrameSchema.safeParse(target);
        if (!parsedTarget.success) {
          return valueFailed<BrowserCanvasStaging>();
        }
        const targetSnapshot = snapshotTargetFrame(parsedTarget.data);
        const canvas = surfaceProvider.createStagingCanvas(targetSnapshot);
        if (canvas === undefined || !hasExactFrame(canvas, targetSnapshot)) {
          return valueFailed<BrowserCanvasStaging>();
        }

        const context = canvas.getContext("2d", {
          alpha: true,
          colorSpace: "srgb",
          willReadFrequently: true,
        });
        if (context === null) {
          return valueFailed<BrowserCanvasStaging>();
        }

        if (typeof context.getContextAttributes === "function") {
          const attributes = context.getContextAttributes();
          if (
            attributes.alpha !== true ||
            attributes.colorSpace !== "srgb"
          ) {
            return valueFailed<BrowserCanvasStaging>();
          }
        }

        prepareForSourceOver(context);
        context.clearRect(0, 0, targetSnapshot.width, targetSnapshot.height);
        const staging = Object.freeze({
          canvas,
          context,
          target: targetSnapshot,
        });
        const result = valueSucceeded(staging);
        active.add(staging);
        return result;
      } catch {
        return valueFailed<BrowserCanvasStaging>();
      }
    },

    async draw(staging, image, node) {
      try {
        if (!active.has(staging) || settled.has(staging)) {
          return operationFailed();
        }
        const dimensions = imageProvider.intrinsicDimensions(image);
        if (
          dimensions === undefined ||
          dimensions.width !== staging.target.width ||
          dimensions.height !== staging.target.height ||
          !hasExactFrame(staging.canvas, staging.target) ||
          !matchesNodeFrame(node, staging.target)
        ) {
          return operationFailed();
        }

        prepareForSourceOver(staging.context);
        staging.context.drawImage(image, 0, 0);
        return operationSucceeded();
      } catch {
        return operationFailed();
      }
    },

    async commit(staging) {
      try {
        if (
          !active.has(staging) ||
          settled.has(staging) ||
          !hasExactFrame(staging.canvas, staging.target)
        ) {
          return valueFailed<BrowserCanvasCommittedFrame>();
        }
      } catch {
        return valueFailed<BrowserCanvasCommittedFrame>();
      }

      let imageData: ImageData;
      try {
        imageData = staging.context.getImageData(
          0,
          0,
          staging.target.width,
          staging.target.height,
        );
      } catch {
        return readbackUnavailable<BrowserCanvasCommittedFrame>();
      }

      try {
        const expectedByteLength =
          staging.target.width * staging.target.height * 4;
        if (imageData.data.byteLength !== expectedByteLength) {
          return valueFailed<BrowserCanvasCommittedFrame>();
        }

        const result = valueSucceeded(
          Object.freeze({
            target: snapshotTargetFrame(staging.target),
            pixels: new Uint8ClampedArray(imageData.data),
          }),
        );
        active.delete(staging);
        settled.add(staging);
        return result;
      } catch {
        return valueFailed<BrowserCanvasCommittedFrame>();
      }
    },

    async discard(staging) {
      try {
        if (
          !active.has(staging) ||
          settled.has(staging) ||
          !hasExactFrame(staging.canvas, staging.target)
        ) {
          return operationFailed();
        }
        prepareForSourceOver(staging.context);
        staging.context.clearRect(
          0,
          0,
          staging.target.width,
          staging.target.height,
        );
        active.delete(staging);
        settled.add(staging);
        return operationSucceeded();
      } catch {
        return operationFailed();
      }
    },
  };
};
