import {
  type AssetSlot,
  DomainIdSchema,
  LAYER_ROLE_ORDER,
  type LayerRole,
  LayerRoleSchema,
  MuseReferenceSchema,
} from "@editorial-doll/domain";
import { z } from "zod";

import {
  MAX_SCENE_NODES,
  SCENE_SCHEMA_VERSION,
  SHA256_PATTERN,
  TARGET_CONTRACT,
} from "./constants.js";
import { RenderDiagnosticSchema } from "./diagnostics.js";
import {
  RenderOwnerSchema,
  RenderResourceDescriptorSchema,
  RenderTargetSchema,
  type RenderResourceResolver,
} from "./resources.js";
import { compareSceneNodes, sceneNodeKey } from "./scene-order.js";

export const ScenePlacementSchema = z
  .object({
    x: z.literal(0),
    y: z.literal(0),
    width: z.union([z.literal(1024), z.literal(2048)]),
    height: z.union([z.literal(1536), z.literal(3072)]),
  })
  .strict()
  .readonly();

export const SceneNodeSchema = z
  .object({
    key: z.string().min(1),
    owner: RenderOwnerSchema,
    partId: DomainIdSchema,
    role: LayerRoleSchema,
    layerOrder: z.number().int().nonnegative(),
    placement: ScenePlacementSchema,
    composite: z.literal("source-over"),
    opacity: z.literal(1),
    resource: RenderResourceDescriptorSchema,
  })
  .strict()
  .superRefine((node, context) => {
    if (node.key !== sceneNodeKey(node.owner, node.partId, node.role)) {
      context.addIssue({
        code: "custom",
        path: ["key"],
        message: "Scene node key does not match its exact identity.",
      });
    }
    if (node.layerOrder !== LAYER_ROLE_ORDER[node.role]) {
      context.addIssue({
        code: "custom",
        path: ["layerOrder"],
        message: "Scene node layer order is not canonical.",
      });
    }
    if (
      node.owner.kind !== node.resource.owner.kind ||
      node.owner.reference.id !== node.resource.owner.reference.id ||
      node.owner.reference.version !== node.resource.owner.reference.version ||
      (node.owner.kind === "asset" &&
        (node.resource.owner.kind !== "asset" ||
          node.owner.slot !== node.resource.owner.slot)) ||
      node.role !== node.resource.role
    ) {
      context.addIssue({
        code: "custom",
        path: ["resource"],
        message: "Scene resource identity does not match its node.",
      });
    }
  })
  .readonly();

const allowedRolesBySlot = Object.freeze({
  background: ["background"],
  hair: ["hair-back", "hair-front"],
  makeup: ["makeup"],
  top: ["top"],
  bottom: ["bottom"],
  dress: ["dress"],
  outerwear: ["outerwear-back", "outerwear-front"],
  shoes: ["shoes"],
  accessory: ["accessory-back", "accessory-front"],
} as const satisfies Readonly<Record<AssetSlot, readonly LayerRole[]>>);

const requiredSplitRolesBySlot = Object.freeze({
  hair: ["hair-back", "hair-front"],
  outerwear: ["outerwear-back", "outerwear-front"],
} as const satisfies Readonly<
  Partial<Record<AssetSlot, readonly LayerRole[]>>
>);

const exactReferenceKey = (node: z.infer<typeof SceneNodeSchema>): string =>
  `${node.owner.reference.id}@${node.owner.reference.version}`;

export const SceneGraphSchema = z
  .object({
    schemaVersion: z.literal(SCENE_SCHEMA_VERSION),
    target: RenderTargetSchema,
    sourceSetId: z.string().regex(SHA256_PATTERN),
    frame: z
      .object({
        width: z.union([z.literal(1024), z.literal(2048)]),
        height: z.union([z.literal(1536), z.literal(3072)]),
        origin: z.literal("top-left"),
      })
      .strict()
      .readonly(),
    draft: z
      .object({
        id: DomainIdSchema,
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .readonly(),
    muse: MuseReferenceSchema,
    nodes: z.array(SceneNodeSchema).max(MAX_SCENE_NODES).readonly(),
  })
  .strict()
  .superRefine((graph, context) => {
    const target = TARGET_CONTRACT[graph.target];
    if (graph.frame.width !== target.width || graph.frame.height !== target.height) {
      context.addIssue({
        code: "custom",
        path: ["frame"],
        message: "Scene frame does not match its target.",
      });
    }

    const keys = new Set<string>();
    const roles = new Set<string>();
    const assetReferencesBySlot = new Map<AssetSlot, Set<string>>();
    const assetRolesBySlot = new Map<AssetSlot, Set<LayerRole>>();
    const assetSlotByReference = new Map<string, AssetSlot>();
    const assetPartIdsBySelection = new Map<string, Set<string>>();
    let museBodyCount = 0;
    for (const [index, node] of graph.nodes.entries()) {
      if (keys.has(node.key)) {
        context.addIssue({ code: "custom", path: ["nodes", index, "key"], message: "Duplicate scene node key." });
      }
      keys.add(node.key);
      if (roles.has(node.role)) {
        context.addIssue({ code: "custom", path: ["nodes", index, "role"], message: "Duplicate active scene role." });
      }
      roles.add(node.role);

      if (
        node.placement.width !== target.width ||
        node.placement.height !== target.height ||
        node.resource.width !== target.width ||
        node.resource.height !== target.height ||
        node.resource.representation !== target.representation ||
        node.resource.sourceSetId !== graph.sourceSetId ||
        node.resource.encodedBytes > target.maximumEncodedBytes ||
        (graph.target === "runtime" && node.resource.encodedBitDepth !== 8)
      ) {
        context.addIssue({ code: "custom", path: ["nodes", index], message: "Scene node does not match graph target or source set." });
      }

      if (node.role === "muse-body") {
        museBodyCount += 1;
        if (
          node.owner.kind !== "muse" ||
          node.owner.reference.id !== graph.muse.id ||
          node.owner.reference.version !== graph.muse.version
        ) {
          context.addIssue({ code: "custom", path: ["nodes", index, "owner"], message: "Muse body owner does not match graph Muse." });
        }
      } else if (node.owner.kind === "muse") {
        context.addIssue({ code: "custom", path: ["nodes", index, "owner"], message: "Muse owner may only provide muse-body." });
      } else {
        const allowedRoles = allowedRolesBySlot[node.owner.slot];
        if (!allowedRoles.some((role) => role === node.role)) {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, "role"],
            message: `Layer role ${node.role} is not valid for slot ${node.owner.slot}.`,
          });
        }
        const referenceKey = exactReferenceKey(node);
        const references = assetReferencesBySlot.get(node.owner.slot) ?? new Set<string>();
        references.add(referenceKey);
        assetReferencesBySlot.set(node.owner.slot, references);
        const slotRoles = assetRolesBySlot.get(node.owner.slot) ?? new Set<LayerRole>();
        slotRoles.add(node.role);
        assetRolesBySlot.set(node.owner.slot, slotRoles);

        const previousSlot = assetSlotByReference.get(referenceKey);
        if (previousSlot !== undefined && previousSlot !== node.owner.slot) {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, "owner"],
            message: "An exact asset reference cannot be active in multiple slots.",
          });
        }
        assetSlotByReference.set(referenceKey, node.owner.slot);

        const selectionKey = `${node.owner.slot}:${referenceKey}`;
        const partIds = assetPartIdsBySelection.get(selectionKey) ?? new Set<string>();
        if (partIds.has(node.partId)) {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, "partId"],
            message: "An active asset cannot repeat a part ID across roles.",
          });
        }
        partIds.add(node.partId);
        assetPartIdsBySelection.set(selectionKey, partIds);
      }

      const previous = graph.nodes[index - 1];
      if (previous !== undefined && compareSceneNodes(previous, node) > 0) {
        context.addIssue({ code: "custom", path: ["nodes", index], message: "Scene nodes are not canonically ordered." });
      }
    }
    if (museBodyCount !== 1) {
      context.addIssue({ code: "custom", path: ["nodes"], message: "A scene requires exactly one Muse body." });
    }

    for (const [slot, references] of assetReferencesBySlot) {
      if (references.size !== 1) {
        context.addIssue({
          code: "custom",
          path: ["nodes"],
          message: `Active slot ${slot} must use exactly one asset reference.`,
        });
      }
    }

    for (const [slot, requiredRoles] of Object.entries(
      requiredSplitRolesBySlot,
    ) as [keyof typeof requiredSplitRolesBySlot, readonly LayerRole[]][]) {
      const presentRoles = assetRolesBySlot.get(slot);
      if (
        presentRoles !== undefined &&
        requiredRoles.some((role) => !presentRoles.has(role))
      ) {
        context.addIssue({
          code: "custom",
          path: ["nodes"],
          message: `Active slot ${slot} requires its complete split-role topology.`,
        });
      }
    }

    if (
      assetRolesBySlot.has("dress") &&
      (assetRolesBySlot.has("top") || assetRolesBySlot.has("bottom"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Dress and separates cannot be active in the same scene.",
      });
    }
  })
  .readonly();

const isResolverContainer = (value: unknown): value is RenderResourceResolver =>
  typeof value === "object" && value !== null;

export const SceneBuildInputSchema = z
  .object({
    draft: z.unknown(),
    catalog: z.unknown(),
    target: RenderTargetSchema,
    resolver: z.custom<RenderResourceResolver>(isResolverContainer),
  })
  .strict()
  .readonly();

const SceneBuildSuccessSchema = z
  .object({ ok: z.literal(true), scene: SceneGraphSchema })
  .strict()
  .readonly();
const SceneBuildFailureSchema = z
  .object({
    ok: z.literal(false),
    diagnostics: z.array(RenderDiagnosticSchema).min(1).readonly(),
  })
  .strict()
  .readonly();

export const SceneBuildResultSchema = z.discriminatedUnion("ok", [
  SceneBuildSuccessSchema,
  SceneBuildFailureSchema,
]);

export type ScenePlacement = z.infer<typeof ScenePlacementSchema>;
export type SceneNode = z.infer<typeof SceneNodeSchema>;
export type SceneGraph = z.infer<typeof SceneGraphSchema>;
export type SceneBuildInput = z.infer<typeof SceneBuildInputSchema>;
export type SceneBuildResult = z.infer<typeof SceneBuildResultSchema>;

export {
  RenderTargetFrameSchema,
  type RenderTargetFrame,
} from "./resources.js";
