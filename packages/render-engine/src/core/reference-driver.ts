import { TARGET_CONTRACT } from "./constants.js";
import {
  PortOperationResultSchema,
  createPortValueResultSchema,
  type PortOperationResult,
  type PortValueResult,
  type TransactionalRenderDriver,
} from "./ports.js";
import type { RenderTargetFrame, SceneNode } from "./scene-schema.js";
import { RenderTargetFrameSchema } from "./resources.js";
import {
  compositeSourceOverRgba8Into,
  createTransparentRgba8Image,
  type Rgba8Image,
} from "./rgba8.js";

/** A driver-owned staging surface, isolated until a detached commit. */
export interface ReferenceRgba8Staging {
  readonly target: RenderTargetFrame;
  readonly surface: Rgba8Image;
}

export interface ReferenceRgba8CommittedFrame {
  readonly target: RenderTargetFrame;
  readonly image: Rgba8Image;
}

interface ReferenceRgba8StagingState {
  readonly target: RenderTargetFrame;
  readonly surface: Rgba8Image;
  settled: boolean;
}

const operationSuccess = (): PortOperationResult =>
  PortOperationResultSchema.parse({ ok: true });

const failed = (): PortOperationResult =>
  PortOperationResultSchema.parse({ ok: false, kind: "failed" });

const valueSuccess = <TValue>(value: TValue): PortValueResult<TValue> =>
  createPortValueResultSchema<TValue>().parse({ ok: true, value });

const failedValue = <TValue>(): PortValueResult<TValue> =>
  createPortValueResultSchema<TValue>().parse({ ok: false, kind: "failed" });

const copyTarget = (target: RenderTargetFrame): RenderTargetFrame =>
  Object.freeze({ ...target }) as RenderTargetFrame;

const matchesTargetContract = (target: RenderTargetFrame): boolean => {
  const contract = TARGET_CONTRACT[target.target];
  return (
    target.representation === contract.representation &&
    target.width === contract.width &&
    target.height === contract.height &&
    target.origin === "top-left"
  );
};

const isFullFrameSourceOverNode = (
  node: SceneNode,
  target: RenderTargetFrame,
): boolean =>
  node.composite === "source-over" &&
  node.opacity === 1 &&
  node.placement.x === 0 &&
  node.placement.y === 0 &&
  node.placement.width === target.width &&
  node.placement.height === target.height;

const copyImage = (image: Rgba8Image): Rgba8Image =>
  Object.freeze({
    width: image.width,
    height: image.height,
    pixels: new Uint8ClampedArray(image.pixels),
  });

const clearsImage = (image: Rgba8Image): void => {
  image.pixels.fill(0);
};

/**
 * A dependency-free, Node-testable implementation of the transactional render
 * port. It is intentionally a reference driver: full-frame source-over only,
 * no browser APIs, transforms, colour conversions, filtering, or file output.
 */
export const createReferenceRgba8Driver = (): TransactionalRenderDriver<
  Rgba8Image,
  ReferenceRgba8Staging,
  ReferenceRgba8CommittedFrame
> => {
  const stagingStates = new WeakMap<
    ReferenceRgba8Staging,
    ReferenceRgba8StagingState
  >();

  const stateFor = (
    staging: ReferenceRgba8Staging,
  ): ReferenceRgba8StagingState | undefined => {
    try {
      return stagingStates.get(staging);
    } catch {
      return undefined;
    }
  };

  return {
    async begin(target) {
      try {
        const parsedTarget = RenderTargetFrameSchema.safeParse(target);
        if (!parsedTarget.success || !matchesTargetContract(parsedTarget.data)) {
          return failedValue();
        }
        const copiedTarget = copyTarget(parsedTarget.data);
        const surface = createTransparentRgba8Image(
          copiedTarget.width,
          copiedTarget.height,
        );
        const staging = Object.freeze({
          target: copiedTarget,
          surface,
        }) as ReferenceRgba8Staging;
        stagingStates.set(staging, {
          target: copiedTarget,
          surface,
          settled: false,
        });
        return valueSuccess(staging);
      } catch {
        return failedValue();
      }
    },

    async draw(staging, image, node) {
      try {
        const state = stateFor(staging);
        if (
          state === undefined ||
          state.settled ||
          !matchesTargetContract(state.target) ||
          !isFullFrameSourceOverNode(node, state.target) ||
          image.width !== state.target.width ||
          image.height !== state.target.height ||
          image.pixels.buffer === state.surface.pixels.buffer
        ) {
          return failed();
        }
        compositeSourceOverRgba8Into(image, state.surface);
        return operationSuccess();
      } catch {
        return failed();
      }
    },

    async commit(staging) {
      const state = stateFor(staging);
      if (state === undefined || state.settled) {
        return failedValue();
      }
      try {
        const committed = Object.freeze({
          target: copyTarget(state.target),
          image: copyImage(state.surface),
        });
        state.settled = true;
        return valueSuccess(committed);
      } catch {
        // A readback/copy failure leaves staging available for the mandatory
        // renderer discard path.
        return failedValue();
      }
    },

    async discard(staging) {
      const state = stateFor(staging);
      if (state === undefined || state.settled) {
        return failed();
      }
      try {
        clearsImage(state.surface);
        state.settled = true;
        return operationSuccess();
      } catch {
        return failed();
      }
    },
  };
};
