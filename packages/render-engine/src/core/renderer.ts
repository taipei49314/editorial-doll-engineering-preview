import {
  MAX_SCENE_NODES,
  TARGET_CONTRACT,
} from "./constants.js";
import {
  createDiagnostic,
  orderDiagnostics,
  type RenderDiagnostic,
  type RenderDiagnosticCode,
  RenderDiagnosticSchema,
} from "./diagnostics.js";
import { deepFreezeOwned } from "./freeze.js";
import {
  PortOperationResultSchema,
  createPortValueResultSchema,
  isPortOperationSuccess,
  isPortValueSuccess,
  type PortFailureKind,
  type PortOperationResult,
  type PortValueResult,
  type RenderPorts,
} from "./ports.js";
import {
  RenderImageLeaseMetadataSchema,
  RenderTargetFrameSchema,
  type RenderImageLeaseMetadata,
  type RenderResourceDescriptor,
  type RenderTargetFrame,
} from "./resources.js";
import { SceneGraphSchema, type SceneGraph } from "./scene-schema.js";
import { z } from "zod";

export const RenderFailureSchema = z
  .object({
    ok: z.literal(false),
    diagnostics: z.array(RenderDiagnosticSchema).min(1).readonly(),
  })
  .strict()
  .readonly();

export const createRenderSuccessSchema = <TCommitted>() =>
  z
    .object({
      ok: z.literal(true),
      // Host-owned committed values are intentionally opaque to the control
      // plane. The wrapper remains strict while this value is transferred as-is.
      committed: z.custom<TCommitted>(),
    })
    .strict()
    .readonly();

export const createRenderResultSchema = <TCommitted>() =>
  z.discriminatedUnion("ok", [
    createRenderSuccessSchema<TCommitted>(),
    RenderFailureSchema,
  ]);

/** Public non-specialized result schema; committed payloads remain opaque. */
export const RenderResultSchema = createRenderResultSchema<unknown>();

type RenderFailure = z.infer<typeof RenderFailureSchema>;

export type RenderResult<TCommitted> = z.infer<
  ReturnType<typeof createRenderResultSchema<TCommitted>>
>;

const failure = (
  diagnostics: readonly RenderDiagnostic[],
): RenderFailure =>
  deepFreezeOwned({
    ...RenderFailureSchema.parse({
      ok: false,
      diagnostics: [...orderDiagnostics(diagnostics)].sort((left, right) => {
        if (left.phase !== "render-cleanup" || right.phase !== "render-cleanup") {
          return 0;
        }
        const cleanupRank = (diagnostic: RenderDiagnostic): number =>
          diagnostic.code === "RENDER_RELEASE_FAILED"
            ? 0
            : diagnostic.code === "RENDER_DISCARD_FAILED"
              ? 1
              : 2;
        return cleanupRank(left) - cleanupRank(right);
      }),
    }),
  });

const success = <TCommitted>(committed: TCommitted): RenderResult<TCommitted> =>
  deepFreezeOwned(
    createRenderSuccessSchema<TCommitted>().parse({ ok: true, committed }),
    [committed],
  );

const diagnostic = (
  code: RenderDiagnosticCode,
  phase: "render-input" | "render-begin" | "render-load" | "render-draw" | "render-commit" | "render-cleanup",
  subject?: string,
): RenderDiagnostic =>
  createDiagnostic({
    code,
    phase,
    ...(subject === undefined ? {} : { subject }),
  });

const targetFrameFor = (scene: SceneGraph): RenderTargetFrame => {
  const contract = TARGET_CONTRACT[scene.target];
  return RenderTargetFrameSchema.parse({
    target: scene.target,
    representation: contract.representation,
    width: contract.width,
    height: contract.height,
    origin: "top-left",
  });
};

const hasValidResourceBudget = (resource: RenderResourceDescriptor): boolean => {
  const contract =
    resource.representation === "runtime"
      ? TARGET_CONTRACT.runtime
      : TARGET_CONTRACT.export;
  return (
    resource.width === contract.width &&
    resource.height === contract.height &&
    resource.encodedBytes <= contract.maximumEncodedBytes &&
    (resource.representation !== "runtime" || resource.encodedBitDepth === 8)
  );
};

const ownerMatches = (
  left: RenderResourceDescriptor["owner"],
  right: RenderImageLeaseMetadata["owner"],
): boolean =>
  left.kind === right.kind &&
  left.reference.id === right.reference.id &&
  left.reference.version === right.reference.version &&
  (left.kind !== "asset" ||
    (right.kind === "asset" && left.slot === right.slot));

const leaseMatchesResource = (
  lease: RenderImageLeaseMetadata,
  resource: RenderResourceDescriptor,
  target: RenderTargetFrame,
): boolean =>
  lease.sourceSetId === resource.sourceSetId &&
  lease.resourceId === resource.resourceId &&
  ownerMatches(resource.owner, lease.owner) &&
  lease.role === resource.role &&
  lease.representation === resource.representation &&
  lease.width === resource.width &&
  lease.height === resource.height &&
  lease.encodedSha256 === resource.encodedSha256 &&
  lease.encodedBytes === resource.encodedBytes &&
  lease.encodedBitDepth === resource.encodedBitDepth &&
  lease.width === target.width &&
  lease.height === target.height &&
  lease.decodedBitDepth === 8 &&
  lease.pixelFormat === "rgba8" &&
  lease.colourSpace === "srgb" &&
  lease.alphaMode === "straight";

const hasExpectedDecodedBudget = (
  lease: RenderImageLeaseMetadata,
  target: RenderTargetFrame,
): boolean => lease.decodedByteLength === target.width * target.height * 4;

const MISSING_VALUE = Symbol("missing-value");

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null;

const safelyReadProperty = (
  value: Record<PropertyKey, unknown>,
  property: PropertyKey,
): unknown | typeof MISSING_VALUE => {
  try {
    return Reflect.has(value, property)
      ? Reflect.get(value, property)
      : MISSING_VALUE;
  } catch {
    return MISSING_VALUE;
  }
};

const hasExactOwnKeys = (
  value: Record<PropertyKey, unknown>,
  expected: readonly string[],
): boolean => {
  try {
    const keys = Reflect.ownKeys(value);
    return (
      keys.length === expected.length &&
      keys.every(
        (key) => typeof key === "string" && expected.includes(key),
      )
    );
  } catch {
    return false;
  }
};

const isAcceptedPortFailure = (
  value: unknown,
  allowReadbackUnavailable: boolean,
): value is PortFailureKind =>
  value === "failed" ||
  (allowReadbackUnavailable && value === "readback-unavailable");

const normalizePortValueResult = <TValue>(
  value: unknown,
  allowReadbackUnavailable: boolean,
): PortValueResult<TValue> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const ok = safelyReadProperty(value, "ok");
  if (ok === true) {
    const portValue = safelyReadProperty(value, "value");
    if (
      !hasExactOwnKeys(value, ["ok", "value"]) ||
      portValue === MISSING_VALUE
    ) {
      return undefined;
    }
    const parsed = createPortValueResultSchema<TValue>().safeParse({
      ok: true,
      value: portValue,
    });
    return parsed.success
      ? deepFreezeOwned(parsed.data, [portValue as TValue])
      : undefined;
  }
  const kind = safelyReadProperty(value, "kind");
  if (
    ok !== false ||
    !hasExactOwnKeys(value, ["ok", "kind"]) ||
    !isAcceptedPortFailure(kind, allowReadbackUnavailable)
  ) {
    return undefined;
  }
  const parsed = createPortValueResultSchema<TValue>().safeParse({
    ok: false,
    kind,
  });
  return parsed.success ? deepFreezeOwned(parsed.data) : undefined;
};

const normalizePortOperationResult = (
  value: unknown,
): PortOperationResult | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const ok = safelyReadProperty(value, "ok");
  if (ok === true) {
    if (!hasExactOwnKeys(value, ["ok"])) {
      return undefined;
    }
    const parsed = PortOperationResultSchema.safeParse({ ok: true });
    return parsed.success ? deepFreezeOwned(parsed.data) : undefined;
  }
  const kind = safelyReadProperty(value, "kind");
  if (
    ok !== false ||
    !hasExactOwnKeys(value, ["ok", "kind"]) ||
    !isAcceptedPortFailure(kind, false)
  ) {
    return undefined;
  }
  const parsed = PortOperationResultSchema.safeParse({ ok: false, kind });
  return parsed.success ? deepFreezeOwned(parsed.data) : undefined;
};

type LoadedLease<TImage> = Readonly<{
  readonly metadata: unknown | typeof MISSING_VALUE;
  readonly image: TImage | typeof MISSING_VALUE;
  readonly release: (() => Promise<PortOperationResult>) | undefined;
}>;

const readLoadedLease = <TImage>(value: unknown): LoadedLease<TImage> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const metadata = safelyReadProperty(value, "metadata");
  const image = safelyReadProperty(value, "image");
  const release = safelyReadProperty(value, "release");
  return {
    metadata,
    image: image as TImage,
    release:
      typeof release === "function"
        ? () =>
            Reflect.apply(
              release as (...arguments_: readonly unknown[]) => Promise<PortOperationResult>,
              value,
              [],
            )
        : undefined,
  };
};

const releaseLease = async <TImage>(
  lease: LoadedLease<TImage> | undefined,
): Promise<PortOperationResult> =>
  lease?.release === undefined
    ? PortOperationResultSchema.parse({ ok: false, kind: "failed" })
    : safelyCallOperationPort(lease.release);

const safelyCallValuePort = async <TValue>(
  operation: () => Promise<PortValueResult<TValue>>,
  allowReadbackUnavailable = false,
): Promise<PortValueResult<TValue>> => {
  try {
    const result: unknown = await operation();
    const normalized = normalizePortValueResult<TValue>(
      result,
      allowReadbackUnavailable,
    );
    if (normalized !== undefined) {
      return normalized;
    }
  } catch {
    // A port must never surface host error details through this package.
  }
  return createPortValueResultSchema<TValue>().parse({
    ok: false,
    kind: "failed",
  });
};

const safelyCallOperationPort = async (
  operation: () => Promise<PortOperationResult>,
): Promise<PortOperationResult> => {
  try {
    const result: unknown = await operation();
    const normalized = normalizePortOperationResult(result);
    if (normalized !== undefined) {
      return normalized;
    }
  } catch {
    // A port must never surface host error details through this package.
  }
  return PortOperationResultSchema.parse({ ok: false, kind: "failed" });
};

const cancellationRequested = (ports: RenderPorts<unknown, unknown, unknown>): boolean => {
  try {
    return ports.cancellation.isCancelled();
  } catch {
    // A failed cancellation port is treated as cancelled to avoid publishing a
    // frame when the caller's cancellation state cannot be observed.
    return true;
  }
};

const cancellationDiagnostic = (): RenderDiagnostic =>
  diagnostic("RENDER_CANCELLED", "render-input");

const failedPortCode = (
  operation: "begin" | "load" | "draw" | "commit" | "release" | "discard",
  kind: PortFailureKind,
): RenderDiagnosticCode => {
  if (operation === "commit" && kind === "readback-unavailable") {
    return "RENDER_READBACK_UNAVAILABLE";
  }
  switch (operation) {
    case "begin":
      return "RENDER_BEGIN_FAILED";
    case "load":
      return "RENDER_LOAD_FAILED";
    case "draw":
      return "RENDER_DRAW_FAILED";
    case "commit":
      return "RENDER_COMMIT_FAILED";
    case "release":
      return "RENDER_RELEASE_FAILED";
    case "discard":
      return "RENDER_DISCARD_FAILED";
  }
};

const phaseForOperation = (
  operation: "begin" | "load" | "draw" | "commit" | "release" | "discard",
): "render-begin" | "render-load" | "render-draw" | "render-commit" | "render-cleanup" => {
  switch (operation) {
    case "begin":
      return "render-begin";
    case "load":
      return "render-load";
    case "draw":
      return "render-draw";
    case "commit":
      return "render-commit";
    case "release":
    case "discard":
      return "render-cleanup";
  }
};

const portFailureDiagnostic = (
  operation: "begin" | "load" | "draw" | "commit" | "release" | "discard",
  kind: PortFailureKind,
  subject?: string,
): RenderDiagnostic =>
  diagnostic(failedPortCode(operation, kind), phaseForOperation(operation), subject);

const graphResourceDiagnostics = (
  scene: SceneGraph,
): readonly RenderDiagnostic[] => {
  const diagnostics: RenderDiagnostic[] = [];
  const target = TARGET_CONTRACT[scene.target];
  const targetBytes = target.decodedByteLength;
  if (!Number.isSafeInteger(targetBytes) || targetBytes * 2 <= 0) {
    diagnostics.push(diagnostic("RENDER_RESOURCE_LIMIT", "render-input"));
  }
  for (const node of scene.nodes) {
    if (!hasValidResourceBudget(node.resource)) {
      diagnostics.push(
        diagnostic("RENDER_RESOURCE_LIMIT", "render-input", node.key),
      );
    }
  }
  return diagnostics;
};

const isSafePositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const hasWrongNumericDimension = (
  value: unknown,
  expected: number,
): boolean => typeof value === "number" && (!isSafePositiveInteger(value) || value !== expected);

const preflightScene = (scene: unknown): RenderDiagnostic | undefined => {
  if (!isRecord(scene)) {
    return undefined;
  }

  const target = safelyReadProperty(scene, "target");
  if (
    typeof target === "string" &&
    target !== "runtime" &&
    target !== "export"
  ) {
    return diagnostic("RENDER_TARGET_UNSUPPORTED", "render-input");
  }
  if (target !== "runtime" && target !== "export") {
    return undefined;
  }

  const contract = TARGET_CONTRACT[target];
  const frame = safelyReadProperty(scene, "frame");
  if (isRecord(frame)) {
    if (
      hasWrongNumericDimension(
        safelyReadProperty(frame, "width"),
        contract.width,
      ) ||
      hasWrongNumericDimension(
        safelyReadProperty(frame, "height"),
        contract.height,
      )
    ) {
      return diagnostic("RENDER_RESOURCE_LIMIT", "render-input");
    }
  }

  const nodes = safelyReadProperty(scene, "nodes");
  if (!Array.isArray(nodes)) {
    return undefined;
  }
  if (nodes.length > MAX_SCENE_NODES) {
    return diagnostic("RENDER_RESOURCE_LIMIT", "render-input");
  }
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const resource = safelyReadProperty(node, "resource");
    if (!isRecord(resource)) {
      continue;
    }
    const resourceRepresentation = safelyReadProperty(
      resource,
      "representation",
    );
    const encodedBytes = safelyReadProperty(resource, "encodedBytes");
    const encodedBitDepth = safelyReadProperty(resource, "encodedBitDepth");
    const hasWrongRepresentation =
      (resourceRepresentation === "runtime" ||
        resourceRepresentation === "master") &&
      resourceRepresentation !== contract.representation;
    const exceedsResourceLimit =
      hasWrongRepresentation ||
      hasWrongNumericDimension(
        safelyReadProperty(resource, "width"),
        contract.width,
      ) ||
      hasWrongNumericDimension(
        safelyReadProperty(resource, "height"),
        contract.height,
      ) ||
      (typeof encodedBytes === "number" &&
        (!isSafePositiveInteger(encodedBytes) ||
          encodedBytes > contract.maximumEncodedBytes)) ||
      (target === "runtime" &&
        typeof encodedBitDepth === "number" &&
        encodedBitDepth !== 8);
    if (exceedsResourceLimit) {
      return diagnostic("RENDER_RESOURCE_LIMIT", "render-input");
    }
  }
  return undefined;
};

const validateScene = (scene: unknown): RenderFailure | SceneGraph => {
  let preflightDiagnostic: RenderDiagnostic | undefined;
  try {
    preflightDiagnostic = preflightScene(scene);
  } catch {
    return failure([diagnostic("RENDER_GRAPH_INVALID", "render-input")]);
  }
  if (preflightDiagnostic !== undefined) {
    return failure([preflightDiagnostic]);
  }
  let parsed: ReturnType<typeof SceneGraphSchema.safeParse>;
  try {
    parsed = SceneGraphSchema.safeParse(scene);
  } catch {
    return failure([diagnostic("RENDER_GRAPH_INVALID", "render-input")]);
  }
  if (!parsed.success) {
    return failure([diagnostic("RENDER_GRAPH_INVALID", "render-input")]);
  }
  const diagnostics = graphResourceDiagnostics(parsed.data);
  if (diagnostics.length > 0) {
    return failure(diagnostics);
  }
  try {
    // Zod parsing produces a detached control-plane DTO. Parse once more from
    // that output and recursively freeze it before giving any node or resource
    // to a host port, so a port cannot mutate caller input or renderer facts.
    return deepFreezeOwned(SceneGraphSchema.parse(parsed.data));
  } catch {
    return failure([diagnostic("RENDER_GRAPH_INVALID", "render-input")]);
  }
};

const isRenderFailure = (
  result: RenderFailure | SceneGraph,
): result is RenderFailure => "ok" in result && result.ok === false;

/**
 * Renders an already compiled, validated scene through host-owned ports. The
 * core neither reads asset bytes nor owns a browser canvas; it only enforces
 * deterministic order, metadata agreement, cancellation, and cleanup.
 */
export const renderScene = async <TImage, TStaging, TCommitted>(
  scene: unknown,
  ports: RenderPorts<TImage, TStaging, TCommitted>,
): Promise<RenderResult<TCommitted>> => {
  const checked = validateScene(scene);
  if (isRenderFailure(checked)) {
    return checked;
  }
  const validatedScene = checked;

  if (cancellationRequested(ports as RenderPorts<unknown, unknown, unknown>)) {
    return failure([cancellationDiagnostic()]);
  }

  const frame = targetFrameFor(validatedScene);
  const begun = await safelyCallValuePort(() => ports.driver.begin(frame));
  if (!isPortValueSuccess(begun)) {
    return failure([portFailureDiagnostic("begin", begun.kind)]);
  }

  const staging = begun.value;
  let primary: RenderDiagnostic | undefined;
  const cleanupDiagnostics: RenderDiagnostic[] = [];

  for (const node of validatedScene.nodes) {
    if (cancellationRequested(ports as RenderPorts<unknown, unknown, unknown>)) {
      primary = cancellationDiagnostic();
      break;
    }

    const loaded = await safelyCallValuePort(() =>
      ports.imageLoader.load(node.resource),
    );
    if (!isPortValueSuccess(loaded)) {
      primary = portFailureDiagnostic("load", loaded.kind, node.key);
      break;
    }

    const lease = readLoadedLease<TImage>(loaded.value);
    if (lease === undefined) {
      primary = diagnostic("RENDER_RESOURCE_MISMATCH", "render-load", node.key);
      cleanupDiagnostics.push(
        portFailureDiagnostic("release", "failed", node.key),
      );
    } else {
      try {
        if (
          lease.metadata === MISSING_VALUE ||
          lease.image === MISSING_VALUE
        ) {
          primary = diagnostic("RENDER_RESOURCE_MISMATCH", "render-load", node.key);
        } else {
          const image = lease.image as TImage;
          const metadata = RenderImageLeaseMetadataSchema.safeParse(lease.metadata);
          if (!metadata.success) {
            primary = diagnostic("RENDER_RESOURCE_MISMATCH", "render-load", node.key);
          } else if (!hasExpectedDecodedBudget(metadata.data, frame)) {
            primary = diagnostic("RENDER_RESOURCE_LIMIT", "render-load", node.key);
          } else if (!leaseMatchesResource(metadata.data, node.resource, frame)) {
            primary = diagnostic("RENDER_RESOURCE_MISMATCH", "render-load", node.key);
          } else if (
            cancellationRequested(ports as RenderPorts<unknown, unknown, unknown>)
          ) {
            primary = cancellationDiagnostic();
          } else {
            const drawn = await safelyCallOperationPort(() =>
              ports.driver.draw(staging, image, node),
            );
            if (!isPortOperationSuccess(drawn)) {
              primary = portFailureDiagnostic("draw", drawn.kind, node.key);
            } else if (
              cancellationRequested(ports as RenderPorts<unknown, unknown, unknown>)
            ) {
              primary = cancellationDiagnostic();
            }
          }
        }
      } catch {
        primary ??= diagnostic("RENDER_RESOURCE_MISMATCH", "render-load", node.key);
      } finally {
        const released = await releaseLease(lease);
        if (!isPortOperationSuccess(released)) {
          const releaseDiagnostic = portFailureDiagnostic(
            "release",
            released.kind,
            node.key,
          );
          if (primary === undefined) {
            primary = releaseDiagnostic;
          } else {
            cleanupDiagnostics.push(releaseDiagnostic);
          }
        }
      }
    }

    if (primary !== undefined) {
      break;
    }
  }

  if (
    primary === undefined &&
    cancellationRequested(ports as RenderPorts<unknown, unknown, unknown>)
  ) {
    primary = cancellationDiagnostic();
  }

  if (primary === undefined) {
    const committed = await safelyCallValuePort(
      () => ports.driver.commit(staging),
      true,
    );
    if (isPortValueSuccess(committed)) {
      return success(committed.value);
    }
    primary = portFailureDiagnostic("commit", committed.kind);
  }

  const discarded = await safelyCallOperationPort(() => ports.driver.discard(staging));
  if (!isPortOperationSuccess(discarded)) {
    cleanupDiagnostics.push(portFailureDiagnostic("discard", discarded.kind));
  }

  return failure([primary, ...cleanupDiagnostics]);
};
