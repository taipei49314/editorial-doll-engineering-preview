import { describe, expect, it } from "vitest";

import { buildScene } from "../src/core/build-scene.js";
import { SceneGraphSchema } from "../src/core/scene-schema.js";
import {
  SYNTHETIC_REFERENCES,
  createSyntheticDraft,
  createSyntheticResolver,
  syntheticCatalog,
} from "./fixtures.js";

const validScene = () => {
  const result = buildScene({
    draft: createSyntheticDraft({
      selections: { hair: SYNTHETIC_REFERENCES.hair },
    }),
    catalog: syntheticCatalog,
    target: "runtime",
    resolver: createSyntheticResolver(),
  });
  if (!result.ok) {
    throw new Error("Synthetic scene fixture did not compile.");
  }
  return result.scene;
};

const garmentScene = (garmentMode: "separates" | "dress") => {
  const result = buildScene({
    draft: createSyntheticDraft({
      garmentMode,
      selections: {
        top: SYNTHETIC_REFERENCES.top,
        bottom: SYNTHETIC_REFERENCES.bottom,
        dress: SYNTHETIC_REFERENCES.dress,
      },
    }),
    catalog: syntheticCatalog,
    target: "runtime",
    resolver: createSyntheticResolver(),
  });
  if (!result.ok) {
    throw new Error("Synthetic garment scene fixture did not compile.");
  }
  return result.scene;
};

describe("scene graph schema", () => {
  it("accepts a canonical strict scene and rejects unknown keys", () => {
    const scene = validScene();
    expect(SceneGraphSchema.parse(scene)).toEqual(scene);
    expect(() => SceneGraphSchema.parse({ ...scene, extra: true })).toThrow();
  });

  it("rejects caller-forged ordering, keys, and target facts", () => {
    const scene = validScene();
    expect(() =>
      SceneGraphSchema.parse({ ...scene, nodes: [...scene.nodes].reverse() }),
    ).toThrow();
    expect(() =>
      SceneGraphSchema.parse({
        ...scene,
        nodes: scene.nodes.map((node, index) =>
          index === 0 ? { ...node, key: "forged" } : node,
        ),
      }),
    ).toThrow();
    expect(() =>
      SceneGraphSchema.parse({
        ...scene,
        nodes: scene.nodes.map((node, index) =>
          index === 0
            ? {
                ...node,
                resource: { ...node.resource, encodedBitDepth: 16 },
              }
            : node,
        ),
      }),
    ).toThrow();
  });

  it("rejects forged slot-role mappings and incomplete split assets", () => {
    const scene = validScene();
    const hairBack = scene.nodes.find((node) => node.role === "hair-back");
    if (hairBack === undefined || hairBack.owner.kind !== "asset") {
      throw new Error("Synthetic hair-back node is unavailable.");
    }
    const forgedOwner = { ...hairBack.owner, slot: "top" as const };
    const forgedHairBack = {
      ...hairBack,
      key: hairBack.key.replace("asset:hair:", "asset:top:"),
      owner: forgedOwner,
      resource: {
        ...hairBack.resource,
        owner: { ...hairBack.resource.owner, slot: "top" as const },
      },
    };
    expect(() =>
      SceneGraphSchema.parse({
        ...scene,
        nodes: scene.nodes.map((node) =>
          node.key === hairBack.key ? forgedHairBack : node,
        ),
      }),
    ).toThrow();

    expect(() =>
      SceneGraphSchema.parse({
        ...scene,
        nodes: scene.nodes.filter((node) => node.role !== "hair-front"),
      }),
    ).toThrow();
  });

  it("rejects a forged graph with dress and separates active together", () => {
    const separates = garmentScene("separates");
    const dress = garmentScene("dress");
    const dressNode = dress.nodes.find((node) => node.role === "dress");
    if (dressNode === undefined) {
      throw new Error("Synthetic dress node is unavailable.");
    }
    const nodes = [...separates.nodes, dressNode].sort(
      (left, right) => left.layerOrder - right.layerOrder,
    );
    expect(() => SceneGraphSchema.parse({ ...separates, nodes })).toThrow();
  });

  it("rejects one exact asset reference forged across two slots", () => {
    const scene = garmentScene("separates");
    const top = scene.nodes.find((node) => node.role === "top");
    const bottom = scene.nodes.find((node) => node.role === "bottom");
    if (
      top === undefined ||
      bottom === undefined ||
      top.owner.kind !== "asset" ||
      bottom.owner.kind !== "asset" ||
      bottom.resource.owner.kind !== "asset"
    ) {
      throw new Error("Synthetic separates nodes are unavailable.");
    }
    const owner = { ...bottom.owner, reference: top.owner.reference };
    const forgedBottom = {
      ...bottom,
      key: `asset:bottom:${top.owner.reference.id}@${top.owner.reference.version}:${bottom.partId}:bottom`,
      owner,
      resource: {
        ...bottom.resource,
        owner: { ...bottom.resource.owner, reference: top.owner.reference },
      },
    };
    expect(() =>
      SceneGraphSchema.parse({
        ...scene,
        nodes: scene.nodes.map((node) =>
          node.key === bottom.key ? forgedBottom : node,
        ),
      }),
    ).toThrow();
  });

  it("rejects duplicate part IDs across roles of one active asset", () => {
    const scene = validScene();
    const hairBack = scene.nodes.find((node) => node.role === "hair-back");
    const hairFront = scene.nodes.find((node) => node.role === "hair-front");
    if (
      hairBack === undefined ||
      hairFront === undefined ||
      hairFront.owner.kind !== "asset"
    ) {
      throw new Error("Synthetic split hair nodes are unavailable.");
    }
    const forgedHairFront = {
      ...hairFront,
      partId: hairBack.partId,
      key: `asset:hair:${hairFront.owner.reference.id}@${hairFront.owner.reference.version}:${hairBack.partId}:hair-front`,
    };
    expect(() =>
      SceneGraphSchema.parse({
        ...scene,
        nodes: scene.nodes.map((node) =>
          node.key === hairFront.key ? forgedHairFront : node,
        ),
      }),
    ).toThrow();
  });

  it("deeply freezes every owned scene object and array", () => {
    const scene = validScene();
    expect(Object.isFrozen(scene)).toBe(true);
    expect(Object.isFrozen(scene.frame)).toBe(true);
    expect(Object.isFrozen(scene.nodes)).toBe(true);
    expect(scene.nodes.every((node) => Object.isFrozen(node))).toBe(true);
    expect(scene.nodes.every((node) => Object.isFrozen(node.resource))).toBe(true);
  });
});
