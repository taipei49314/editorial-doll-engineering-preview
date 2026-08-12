import {
  CatalogSchema,
  LAYER_ROLE_ORDER,
  LookDraftSchema,
  activeSlots,
  evaluateLookCompatibility,
  findAsset,
  findMuse,
  hasAssetId,
  hasMuseId,
  type AssetPart,
  type AssetSlot,
  type Catalog,
  type LookDraft,
} from "@editorial-doll/domain";

import {
  SCENE_SCHEMA_VERSION,
  SHA256_PATTERN,
  TARGET_CONTRACT,
} from "./constants.js";
import {
  createDiagnostic,
  orderDiagnostics,
  type DiagnosticCause,
  type RenderDiagnostic,
} from "./diagnostics.js";
import { deepFreezeOwned } from "./freeze.js";
import {
  RenderResourceRequestSchema,
  SceneResourceResultSchema,
  type RenderOwner,
  type RenderResourceDescriptor,
  type RenderResourceResolver,
  type RenderTarget,
} from "./resources.js";
import { compareSceneNodes, sceneNodeKey } from "./scene-order.js";
import {
  SceneBuildInputSchema,
  SceneBuildResultSchema,
  SceneGraphSchema,
  type SceneBuildInput,
  type SceneBuildResult,
  type SceneGraph,
  type SceneNode,
} from "./scene-schema.js";

interface CandidateNode {
  readonly owner: RenderOwner;
  readonly partId: string;
  readonly role: AssetPart["role"];
  readonly layerOrder: number;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isGeneratedCatalog = (value: unknown): boolean => {
  try {
    return (
      isPlainObject(value) &&
      value["schemaVersion"] === "1.0.0" &&
      hasOwn(value, "releaseId") &&
      hasOwn(value, "releasePath") &&
      hasOwn(value, "generator") &&
      hasOwn(value, "sourceReport") &&
      hasOwn(value, "assets") &&
      !hasOwn(value, "muses")
    );
  } catch {
    return false;
  }
};

const catalogFromRawInput = (input: unknown): unknown => {
  try {
    return isPlainObject(input) && hasOwn(input, "catalog")
      ? input["catalog"]
      : undefined;
  } catch {
    return undefined;
  }
};

const snapshotResolver = (value: unknown): RenderResourceResolver | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  let sourceSetId: unknown;
  let resolve: unknown;
  try {
    // Snapshot each unknown property exactly once. All later scene work uses
    // these captured values, so accessors and prototype methods remain valid
    // without allowing a stateful getter to change the contract mid-build.
    sourceSetId = Reflect.get(value, "sourceSetId");
    resolve = Reflect.get(value, "resolve");
  } catch {
    return undefined;
  }
  if (
    typeof sourceSetId !== "string" ||
    !SHA256_PATTERN.test(sourceSetId) ||
    typeof resolve !== "function"
  ) {
    return undefined;
  }

  const capturedResolve = resolve as RenderResourceResolver["resolve"];
  return deepFreezeOwned({
    sourceSetId,
    resolve(request: Parameters<RenderResourceResolver["resolve"]>[0]) {
      return capturedResolve.call(value, request);
    },
  });
};

const failure = (
  diagnostics: readonly RenderDiagnostic[],
): SceneBuildResult =>
  deepFreezeOwned(
    SceneBuildResultSchema.parse({
      ok: false,
      diagnostics: orderDiagnostics(diagnostics),
    }),
  );

const success = (scene: SceneGraph): SceneBuildResult =>
  deepFreezeOwned(SceneBuildResultSchema.parse({ ok: true, scene }));

const museSubject = (draft: LookDraft): string =>
  `muse:${draft.muse.id}@${draft.muse.version}`;

const assetSubject = (
  slot: AssetSlot,
  reference: { readonly id: string; readonly version: string },
): string => `asset:${slot}:${reference.id}@${reference.version}`;

const exactLookupDiagnostics = (
  draft: LookDraft,
  catalog: Catalog,
): readonly RenderDiagnostic[] => {
  const diagnostics: RenderDiagnostic[] = [];
  if (findMuse(catalog, draft.muse) === undefined) {
    diagnostics.push(
      createDiagnostic({
        code: hasMuseId(catalog, draft.muse.id)
          ? "SCENE_MUSE_VERSION_UNAVAILABLE"
          : "SCENE_MUSE_NOT_FOUND",
        phase: "scene-lookup",
        subject: museSubject(draft),
      }),
    );
  }

  for (const slot of activeSlots(draft)) {
    const reference = draft.selections[slot];
    if (reference === undefined) {
      continue;
    }
    const asset = findAsset(catalog, reference);
    if (asset === undefined) {
      diagnostics.push(
        createDiagnostic({
          code: hasAssetId(catalog, reference.id)
            ? "SCENE_ASSET_VERSION_UNAVAILABLE"
            : "SCENE_ASSET_NOT_FOUND",
          phase: "scene-lookup",
          subject: assetSubject(slot, reference),
        }),
      );
    } else if (asset.slot !== slot) {
      diagnostics.push(
        createDiagnostic({
          code: "SCENE_ACTIVE_SLOT_MISMATCH",
          phase: "scene-lookup",
          subject: assetSubject(slot, reference),
        }),
      );
    }
  }
  return orderDiagnostics(diagnostics);
};

const candidatesFor = (
  draft: LookDraft,
  catalog: Catalog,
): readonly CandidateNode[] => {
  const muse = findMuse(catalog, draft.muse);
  if (muse === undefined) {
    throw new Error("Exact Muse lookup invariant failed.");
  }

  const candidates: CandidateNode[] = [
    {
      owner: { kind: "muse", reference: draft.muse },
      partId: muse.bodyPart.id,
      role: muse.bodyPart.role,
      layerOrder: LAYER_ROLE_ORDER[muse.bodyPart.role],
    },
  ];

  for (const slot of activeSlots(draft)) {
    const reference = draft.selections[slot];
    if (reference === undefined) {
      continue;
    }
    const asset = findAsset(catalog, reference);
    if (asset === undefined || asset.slot !== slot) {
      throw new Error("Exact Asset lookup invariant failed.");
    }
    for (const part of asset.parts) {
      candidates.push({
        owner: { kind: "asset", slot, reference },
        partId: part.id,
        role: part.role,
        layerOrder: LAYER_ROLE_ORDER[part.role],
      });
    }
  }

  return candidates.sort(compareSceneNodes);
};

const sameOwner = (left: RenderOwner, right: RenderOwner): boolean =>
  left.kind === right.kind &&
  left.reference.id === right.reference.id &&
  left.reference.version === right.reference.version &&
  (left.kind === "muse" ||
    (right.kind === "asset" && left.slot === right.slot));

const resourceSubject = (
  candidate: CandidateNode,
  representation: string,
): string =>
  candidate.owner.kind === "muse"
    ? `resource:muse:${candidate.owner.reference.id}@${candidate.owner.reference.version}:${candidate.role}:${representation}`
    : `resource:asset:${candidate.owner.slot}:${candidate.owner.reference.id}@${candidate.owner.reference.version}:${candidate.role}:${representation}`;

const resolveCandidate = (input: {
  readonly candidate: CandidateNode;
  readonly resolver: RenderResourceResolver;
  readonly target: RenderTarget;
}):
  | { readonly resource: RenderResourceDescriptor }
  | { readonly diagnostics: readonly RenderDiagnostic[] } => {
  const contract = TARGET_CONTRACT[input.target];
  const subject = resourceSubject(input.candidate, contract.representation);
  const request = deepFreezeOwned(
    RenderResourceRequestSchema.parse({
      sourceSetId: input.resolver.sourceSetId,
      owner: input.candidate.owner,
      role: input.candidate.role,
      representation: contract.representation,
    }),
  );

  let rawResult: unknown;
  try {
    rawResult = input.resolver.resolve(request);
  } catch {
    return {
      diagnostics: [
        createDiagnostic({
          code: "SCENE_RESOURCE_UNAVAILABLE",
          phase: "scene-resource",
          subject,
        }),
      ],
    };
  }

  let result: ReturnType<typeof SceneResourceResultSchema.safeParse>;
  try {
    result = SceneResourceResultSchema.safeParse(rawResult);
  } catch {
    return {
      diagnostics: [
        createDiagnostic({
          code: "SCENE_RESOURCE_INVALID",
          phase: "scene-resource",
          subject,
        }),
      ],
    };
  }
  if (!result.success) {
    return {
      diagnostics: [
        createDiagnostic({
          code: "SCENE_RESOURCE_INVALID",
          phase: "scene-resource",
          subject,
        }),
      ],
    };
  }
  if (!result.data.ok) {
    return {
      diagnostics: [
        createDiagnostic({
          code: "SCENE_RESOURCE_UNAVAILABLE",
          phase: "scene-resource",
          subject,
        }),
      ],
    };
  }

  const resource = result.data.resource;
  const diagnostics: RenderDiagnostic[] = [];
  if (resource.sourceSetId !== input.resolver.sourceSetId) {
    diagnostics.push(
      createDiagnostic({
        code: "SCENE_RESOURCE_SET_MISMATCH",
        phase: "scene-resource",
        subject,
      }),
    );
  }
  if (
    !sameOwner(resource.owner, input.candidate.owner) ||
    resource.role !== input.candidate.role
  ) {
    diagnostics.push(
      createDiagnostic({
        code: "SCENE_RESOURCE_IDENTITY_MISMATCH",
        phase: "scene-resource",
        subject,
      }),
    );
  }
  if (
    resource.representation !== contract.representation ||
    resource.encodedBytes > contract.maximumEncodedBytes ||
    (input.target === "runtime" && resource.encodedBitDepth !== 8)
  ) {
    diagnostics.push(
      createDiagnostic({
        code: "SCENE_RESOURCE_REPRESENTATION_MISMATCH",
        phase: "scene-resource",
        subject,
      }),
    );
  }
  if (resource.width !== contract.width || resource.height !== contract.height) {
    diagnostics.push(
      createDiagnostic({
        code: "SCENE_RESOURCE_DIMENSION_MISMATCH",
        phase: "scene-resource",
        subject,
      }),
    );
  }

  return diagnostics.length === 0
    ? { resource: deepFreezeOwned(resource) }
    : { diagnostics: orderDiagnostics(diagnostics) };
};

const compileScene = (input: {
  readonly draft: LookDraft;
  readonly catalog: Catalog;
  readonly target: RenderTarget;
  readonly resolver: RenderResourceResolver;
}): SceneBuildResult => {
  const lookupDiagnostics = exactLookupDiagnostics(input.draft, input.catalog);
  if (lookupDiagnostics.length > 0) {
    return failure(lookupDiagnostics);
  }

  const compatibility = evaluateLookCompatibility(input.draft, input.catalog);
  if (!compatibility.allowed) {
    const causes: readonly DiagnosticCause[] = compatibility.warnings.map(
      (warning) => ({ kind: "domain-compatibility", warning }),
    );
    return failure([
      createDiagnostic({
        code: "SCENE_INCOMPATIBLE_LOOK",
        phase: "scene-compatibility",
        subject: `draft:${input.draft.id}`,
        causes,
      }),
    ]);
  }

  const candidates = candidatesFor(input.draft, input.catalog);
  const nodes: SceneNode[] = [];
  const diagnostics: RenderDiagnostic[] = [];
  const contract = TARGET_CONTRACT[input.target];
  for (const candidate of candidates) {
    const resolution = resolveCandidate({
      candidate,
      resolver: input.resolver,
      target: input.target,
    });
    if ("diagnostics" in resolution) {
      diagnostics.push(...resolution.diagnostics);
      continue;
    }
    nodes.push({
      key: sceneNodeKey(candidate.owner, candidate.partId, candidate.role),
      owner: candidate.owner,
      partId: candidate.partId,
      role: candidate.role,
      layerOrder: candidate.layerOrder,
      placement: {
        x: 0,
        y: 0,
        width: contract.width,
        height: contract.height,
      },
      composite: "source-over",
      opacity: 1,
      resource: resolution.resource,
    });
  }
  if (diagnostics.length > 0) {
    return failure(diagnostics);
  }

  const scene = SceneGraphSchema.parse({
    schemaVersion: SCENE_SCHEMA_VERSION,
    target: input.target,
    sourceSetId: input.resolver.sourceSetId,
    frame: {
      width: contract.width,
      height: contract.height,
      origin: "top-left",
    },
    draft: { id: input.draft.id, revision: input.draft.revision },
    muse: input.draft.muse,
    nodes,
  });
  return success(deepFreezeOwned(scene));
};

export function buildScene(input: SceneBuildInput): SceneBuildResult;
export function buildScene(input: unknown): SceneBuildResult {
  const rawCatalog = catalogFromRawInput(input);
  if (isGeneratedCatalog(input) || isGeneratedCatalog(rawCatalog)) {
    return failure([
      createDiagnostic({
        code: "SCENE_GENERATED_CATALOG_FORBIDDEN",
        phase: "scene-generated-catalog",
      }),
    ]);
  }

  let parsedInput: ReturnType<typeof SceneBuildInputSchema.safeParse>;
  try {
    parsedInput = SceneBuildInputSchema.safeParse(input);
  } catch {
    return failure([
      createDiagnostic({ code: "SCENE_INPUT_INVALID", phase: "scene-input" }),
    ]);
  }
  if (!parsedInput.success) {
    return failure([
      createDiagnostic({ code: "SCENE_INPUT_INVALID", phase: "scene-input" }),
    ]);
  }

  let draft: ReturnType<typeof LookDraftSchema.safeParse>;
  try {
    draft = LookDraftSchema.safeParse(parsedInput.data.draft);
  } catch {
    return failure([
      createDiagnostic({ code: "SCENE_INPUT_INVALID", phase: "scene-input" }),
    ]);
  }
  if (!draft.success) {
    return failure([
      createDiagnostic({ code: "SCENE_INPUT_INVALID", phase: "scene-input" }),
    ]);
  }

  let catalog: ReturnType<typeof CatalogSchema.safeParse>;
  try {
    catalog = CatalogSchema.safeParse(parsedInput.data.catalog);
  } catch {
    return failure([
      createDiagnostic({
        code: "SCENE_DOMAIN_CATALOG_INVALID",
        phase: "scene-catalog",
      }),
    ]);
  }
  if (!catalog.success) {
    return failure([
      createDiagnostic({
        code: "SCENE_DOMAIN_CATALOG_INVALID",
        phase: "scene-catalog",
      }),
    ]);
  }

  let resolver: RenderResourceResolver | undefined;
  try {
    resolver = snapshotResolver(parsedInput.data.resolver);
  } catch {
    resolver = undefined;
  }
  if (resolver === undefined) {
    return failure([
      createDiagnostic({ code: "SCENE_INPUT_INVALID", phase: "scene-input" }),
    ]);
  }

  return compileScene({
    draft: draft.data,
    catalog: catalog.data,
    target: parsedInput.data.target,
    resolver,
  });
}
