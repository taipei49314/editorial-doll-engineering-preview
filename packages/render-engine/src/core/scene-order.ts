import type { LayerRole } from "@editorial-doll/domain";

import { compareAscii } from "./diagnostics.js";
import type { RenderOwner } from "./resources.js";

export interface OrderableSceneNode {
  readonly owner: RenderOwner;
  readonly partId: string;
  readonly role: LayerRole;
  readonly layerOrder: number;
}

const ownerRank = (owner: RenderOwner): number =>
  owner.kind === "muse" ? 0 : 1;

export const sceneNodeKey = (
  owner: RenderOwner,
  partId: string,
  role: LayerRole,
): string =>
  owner.kind === "muse"
    ? `muse:${owner.reference.id}@${owner.reference.version}:${partId}:${role}`
    : `asset:${owner.slot}:${owner.reference.id}@${owner.reference.version}:${partId}:${role}`;

export const compareSceneNodes = (
  left: OrderableSceneNode,
  right: OrderableSceneNode,
): number =>
  left.layerOrder - right.layerOrder ||
  compareAscii(left.role, right.role) ||
  ownerRank(left.owner) - ownerRank(right.owner) ||
  compareAscii(left.owner.reference.id, right.owner.reference.id) ||
  compareAscii(left.owner.reference.version, right.owner.reference.version) ||
  compareAscii(left.partId, right.partId);
