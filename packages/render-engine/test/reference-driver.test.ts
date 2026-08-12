import { describe, expect, it } from "vitest";

import { buildScene } from "../src/core/build-scene.js";
import { createReferenceRgba8Driver } from "../src/core/reference-driver.js";
import { renderScene } from "../src/core/renderer.js";
import {
  RenderTargetFrameSchema,
  type RenderImageLeaseMetadata,
  type RenderResourceDescriptor,
} from "../src/core/resources.js";
import { createTransparentRgba8Image, type Rgba8Image } from "../src/core/rgba8.js";
import type { SceneNode } from "../src/core/scene-schema.js";
import {
  createSyntheticDraft,
  createSyntheticResolver,
  syntheticCatalog,
} from "./fixtures.js";

const validScene = () => {
  const result = buildScene({
    draft: createSyntheticDraft(),
    catalog: syntheticCatalog,
    target: "runtime",
    resolver: createSyntheticResolver(),
  });
  if (!result.ok) {
    throw new Error("Synthetic reference-driver fixture did not compile.");
  }
  return result.scene;
};

const runtimeTarget = () =>
  RenderTargetFrameSchema.parse({
    target: "runtime",
    representation: "runtime",
    width: 1024,
    height: 1536,
    origin: "top-left",
  });

const referenceNode = (): SceneNode =>
  ({
    composite: "source-over",
    opacity: 1,
    placement: { x: 0, y: 0, width: 1024, height: 1536 },
  }) as SceneNode;

const probeImage = (
  width: number,
  height: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
): Rgba8Image => {
  const image = createTransparentRgba8Image(width, height);
  image.pixels.set([red, green, blue, alpha]);
  return image;
};

const metadataFor = (
  resource: RenderResourceDescriptor,
): RenderImageLeaseMetadata => ({
  ...resource,
  decodedByteLength: resource.width * resource.height * 4,
  decodedBitDepth: 8,
  pixelFormat: "rgba8",
  colourSpace: "srgb",
  alphaMode: "straight",
});

describe("reference RGBA8 transactional driver", () => {
  it("begins transparent, draws in order, commits a detached frame, and discards staging", async () => {
    const target = runtimeTarget();
    const node = referenceNode();
    const mutableTarget = {
      ...target,
    } as {
      target: "runtime";
      representation: "runtime";
      width: number;
      height: number;
      origin: "top-left";
    };
    const driver = createReferenceRgba8Driver();
    const begun = await driver.begin(mutableTarget as never);
    if (!begun.ok) {
      throw new Error("Reference driver did not begin.");
    }

    mutableTarget.width = 1;

    expect([...begun.value.surface.pixels.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    const red = probeImage(target.width, target.height, 255, 0, 0, 128);
    const blue = probeImage(target.width, target.height, 0, 0, 255, 128);
    const beforeRed = [...red.pixels.slice(0, 4)];

    expect(await driver.draw(begun.value, red, node)).toEqual({ ok: true });
    expect(await driver.draw(begun.value, blue, node)).toEqual({ ok: true });
    expect([...red.pixels.slice(0, 4)]).toEqual(beforeRed);

    const committed = await driver.commit(begun.value);
    if (!committed.ok) {
      throw new Error("Reference driver did not commit.");
    }
    expect(committed.value.target.width).toBe(target.width);
    expect([...committed.value.image.pixels.slice(0, 4)]).toEqual([85, 0, 170, 192]);
    expect(
      committed.value.image.pixels === begun.value.surface.pixels,
    ).toBe(false);
    begun.value.surface.pixels[0] = 1;
    expect(committed.value.image.pixels[0]).toBe(85);

    const discarded = await driver.begin(target);
    if (!discarded.ok) {
      throw new Error("Reference driver did not begin discard staging.");
    }
    expect(await driver.discard(discarded.value)).toEqual({ ok: true });
    expect([...discarded.value.surface.pixels.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(await driver.commit(discarded.value)).toEqual({
      ok: false,
      kind: "failed",
    });
  }, 30_000);

  it("rejects source and staging typed-array aliases", async () => {
    const target = runtimeTarget();
    const node = referenceNode();
    const aliasDriver = createReferenceRgba8Driver();
    const aliasStaging = await aliasDriver.begin(target);
    if (!aliasStaging.ok) {
      throw new Error("Reference driver did not begin alias staging.");
    }
    expect(
      await aliasDriver.draw(aliasStaging.value, aliasStaging.value.surface, node),
    ).toEqual({ ok: false, kind: "failed" });

    expect(
      await aliasDriver.begin({
        target: "runtime",
        representation: "runtime",
        width: 1,
        height: 1,
        origin: "top-left",
      } as never),
    ).toEqual({ ok: false, kind: "failed" });
    const statefulTarget = new Proxy(target, {
      get(targetValue, property, receiver) {
        if (property === "width") {
          throw new Error("native https://private.invalid/target");
        }
        return Reflect.get(targetValue, property, receiver);
      },
    });
    expect(await aliasDriver.begin(statefulTarget)).toEqual({
      ok: false,
      kind: "failed",
    });

  });

  it("commits a detached master-resolution export surface", async () => {
    const target = RenderTargetFrameSchema.parse({
      target: "export",
      representation: "master",
      width: 2048,
      height: 3072,
      origin: "top-left",
    });
    const driver = createReferenceRgba8Driver();
    const begun = await driver.begin(target);
    if (!begun.ok) {
      throw new Error("Reference driver did not begin export staging.");
    }
    const committed = await driver.commit(begun.value);
    if (!committed.ok) {
      throw new Error("Reference driver did not commit export staging.");
    }

    expect(committed.value.target).toEqual(target);
    expect(committed.value.image.pixels.byteLength).toBe(25_165_824);
    expect(
      committed.value.image.pixels === begun.value.surface.pixels,
    ).toBe(false);
    begun.value.surface.pixels[0] = 255;
    expect(committed.value.image.pixels[0]).toBe(0);
  });

  it("runs through renderScene and releases each loaded frame exactly once", async () => {
    const completeScene = validScene();
    const node = completeScene.nodes.find(
      (candidate) => candidate.role === "muse-body",
    );
    if (node === undefined) {
      throw new Error("Synthetic scene requires a node.");
    }
    // The renderer lifecycle needs one complete full-frame transaction here.
    // Scene ordering across the full synthetic graph is covered by renderer
    // port-event tests, while compositor ordering is covered by the normative
    // one-pixel vectors. Keeping this integration scene to the required Muse
    // node avoids retaining and traversing twelve 6 MiB frames in one test.
    const scene = {
      ...completeScene,
      nodes: [node],
    };
    const image = probeImage(
      node.resource.width,
      node.resource.height,
      255,
      0,
      0,
      128,
    );
    let releaseCalls = 0;

    const result = await renderScene(scene, {
      cancellation: { isCancelled: () => false },
      imageLoader: {
        load: async (resource) => ({
          ok: true,
          value: {
            metadata: metadataFor(resource),
            image,
            release: async () => {
              releaseCalls += 1;
              return { ok: true } as const;
            },
          },
        }),
      },
      driver: createReferenceRgba8Driver(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.committed.image.pixels.slice(0, 4)]).toEqual([
        255,
        0,
        0,
        128,
      ]);
    }
    expect(releaseCalls).toBe(1);
  });
});
