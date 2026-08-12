import { describe, expect, it } from "vitest";

import { buildScene } from "../src/core/build-scene.js";
import { RenderResultSchema, renderScene } from "../src/core/renderer.js";
import type {
  RenderImageLeaseMetadata,
  RenderResourceDescriptor,
} from "../src/core/resources.js";
import {
  PortOperationResultSchema,
  PortValueResultSchema,
  createPortValueResultSchema,
  type RenderPorts,
} from "../src/core/ports.js";
import {
  SYNTHETIC_REFERENCES,
  createSyntheticDraft,
  createSyntheticResolver,
  syntheticCatalog,
} from "./fixtures.js";

const validScene = (draft = createSyntheticDraft()) => {
  const result = buildScene({
    draft,
    catalog: syntheticCatalog,
    target: "runtime",
    resolver: createSyntheticResolver(),
  });
  if (!result.ok) {
    throw new Error("Synthetic renderer fixture did not compile.");
  }
  return result.scene;
};

const leaseMetadataFor = (
  resource: RenderResourceDescriptor,
): RenderImageLeaseMetadata => ({
  ...resource,
  decodedByteLength: resource.width * resource.height * 4,
  decodedBitDepth: 8,
  pixelFormat: "rgba8",
  colourSpace: "srgb",
  alphaMode: "straight",
});

const statefulPortResult = <TResult extends object>(result: TResult): TResult => {
  const reads = new Map<PropertyKey, number>();
  return new Proxy(result, {
    get(target, property, receiver) {
      const nextReads = (reads.get(property) ?? 0) + 1;
      reads.set(property, nextReads);
      if (nextReads > 1) {
        throw new Error(`native getter failure: https://private.invalid/${String(property)}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
};

interface PortFixture {
  readonly events: string[];
  readonly ports: RenderPorts<Uint8Array, { readonly id: string }, string>;
}

const createPorts = (input: {
  readonly beginResult?: unknown;
  readonly onLoad?: (resource: RenderResourceDescriptor) => void;
  readonly loadResult?:
    | unknown
    | ((resource: RenderResourceDescriptor) => unknown);
  readonly drawResult?: unknown;
  readonly releaseResult?: unknown;
  readonly commitResult?: unknown;
  readonly discardResult?: unknown;
  readonly isCancelled?: () => boolean;
} = {}): PortFixture => {
  const events: string[] = [];
  return {
    events,
    ports: {
      cancellation: {
        isCancelled: input.isCancelled ?? (() => false),
      },
      imageLoader: {
        load: async (resource) => {
          events.push(`load:${resource.role}`);
          input.onLoad?.(resource);
          if (input.loadResult !== undefined) {
            return (
              typeof input.loadResult === "function"
                ? input.loadResult(resource)
                : input.loadResult
            ) as never;
          }
          return {
            ok: true,
            value: {
              metadata: leaseMetadataFor(resource),
              image: new Uint8Array([0]),
              release: async () => {
                events.push(`release:${resource.role}`);
                return (input.releaseResult ?? { ok: true }) as never;
              },
            },
          } as const;
        },
      },
      driver: {
        begin: async () => {
          events.push("begin");
          return (input.beginResult ?? {
            ok: true,
            value: { id: "staging" },
          }) as never;
        },
        draw: async (_staging, _image, node) => {
          events.push(`draw:${node.role}`);
          return (input.drawResult ?? { ok: true }) as never;
        },
        commit: async () => {
          events.push("commit");
          return (input.commitResult ?? { ok: true, value: "committed" }) as never;
        },
        discard: async () => {
          events.push("discard");
          return (input.discardResult ?? { ok: true }) as never;
        },
      },
    },
  };
};

describe("renderScene", () => {
  it("uses strict Zod port result wrappers without taking opaque value ownership", () => {
    const opaqueValue = { hostOwned: true };
    const valueResult = createPortValueResultSchema<typeof opaqueValue>().parse({
      ok: true,
      value: opaqueValue,
    });

    if (!valueResult.ok) {
      throw new Error("Port value success schema rejected its success fixture.");
    }
    expect(valueResult.value).toBe(opaqueValue);
    expect(Object.isFrozen(valueResult)).toBe(true);
    expect(Object.isFrozen(opaqueValue)).toBe(false);
    expect(() =>
      PortValueResultSchema.parse({ ok: true, value: opaqueValue, extra: true }),
    ).toThrow();
    expect(() =>
      PortValueResultSchema.parse({
        ok: false,
        kind: "failed",
        extra: true,
      }),
    ).toThrow();
    expect(
      PortValueResultSchema.parse({
        ok: false,
        kind: "readback-unavailable",
      }),
    ).toEqual({ ok: false, kind: "readback-unavailable" });
    expect(() =>
      PortOperationResultSchema.parse({
        ok: false,
        kind: "readback-unavailable",
      }),
    ).toThrow();
    expect(() =>
      PortOperationResultSchema.parse({ ok: true, extra: true }),
    ).toThrow();
  });

  it("renders each canonical node transactionally and returns an opaque committed value", async () => {
    const scene = validScene();
    const { events, ports } = createPorts();

    const result = await renderScene(scene, ports);

    expect(result).toEqual({ ok: true, committed: "committed" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(events).toEqual([
      "begin",
      ...scene.nodes.flatMap((node) => [
        `load:${node.role}`,
        `draw:${node.role}`,
        `release:${node.role}`,
      ]),
      "commit",
    ]);
  });

  it("uses strict result schemas while preserving opaque committed identity", async () => {
    const opaqueCommitted = { hostOwned: true };
    const { ports } = createPorts({
      commitResult: { ok: true, value: opaqueCommitted },
    });
    const result = await renderScene(validScene(), ports);

    expect(result).toEqual({ ok: true, committed: opaqueCommitted });
    if (result.ok) {
      expect(result.committed).toBe(opaqueCommitted);
      expect(Object.isFrozen(result.committed)).toBe(false);
    }
    expect(() =>
      RenderResultSchema.parse({ ok: true, committed: opaqueCommitted, extra: true }),
    ).toThrow();
    expect(() =>
      RenderResultSchema.parse({ ok: false, diagnostics: [], extra: true }),
    ).toThrow();
  });

  it("gives ports a detached, deeply frozen scene snapshot that cannot alter caller input", async () => {
    const input = structuredClone(validScene());
    const originalEncodedBytes = input.nodes[0]?.resource.encodedBytes;
    let observedNodeEncodedBytes: number | undefined;
    const ports: RenderPorts<Uint8Array, string, string> = {
      cancellation: { isCancelled: () => false },
      imageLoader: {
        load: async (resource) => {
          expect(Object.isFrozen(resource)).toBe(true);
          try {
            (resource as { encodedBytes: number }).encodedBytes = 7;
          } catch {
            // Mutating an M3-owned snapshot is intentionally rejected.
          }
          return {
            ok: true,
            value: {
              metadata: leaseMetadataFor(resource),
              image: new Uint8Array([0]),
              release: async () => ({ ok: true }) as const,
            },
          } as const;
        },
      },
      driver: {
        begin: async () => ({ ok: true, value: "staging" }) as const,
        draw: async (_staging, _image, node) => {
          expect(Object.isFrozen(node)).toBe(true);
          expect(Object.isFrozen(node.resource)).toBe(true);
          try {
            (node.resource as { encodedBytes: number }).encodedBytes = 9;
          } catch {
            // Mutating an M3-owned snapshot is intentionally rejected.
          }
          observedNodeEncodedBytes = node.resource.encodedBytes;
          return { ok: true } as const;
        },
        commit: async () => ({ ok: true, value: "committed" }) as const,
        discard: async () => ({ ok: true }) as const,
      },
    };

    const result = await renderScene(input, ports);

    expect(result).toEqual({ ok: true, committed: "committed" });
    expect(observedNodeEncodedBytes).toBe(originalEncodedBytes);
    expect(input.nodes[0]?.resource.encodedBytes).toBe(originalEncodedBytes);
    expect(Object.isFrozen(input)).toBe(false);
  });

  it("checks cancellation after load, releases the lease, and discards staging", async () => {
    const scene = validScene();
    let cancelled = false;
    const { events, ports } = createPorts({
      onLoad: () => {
        cancelled = true;
      },
      isCancelled: () => cancelled,
    });

    const result = await renderScene(scene, ports);

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        { code: "RENDER_CANCELLED", phase: "render-input", causes: [] },
      ],
    });
    expect(events).toEqual([
      "begin",
      `load:${scene.nodes[0]?.role}`,
      `release:${scene.nodes[0]?.role}`,
      "discard",
    ]);
  });

  it("honours cancellation before begin, before load, before draw, after draw, and before commit", async () => {
    const scene = validScene();
    const checksFor = (cancelAt: number) => {
      let checks = 0;
      return () => {
        checks += 1;
        return checks === cancelAt;
      };
    };

    const beforeBegin = createPorts({ isCancelled: checksFor(1) });
    const beforeLoad = createPorts({ isCancelled: checksFor(2) });
    const beforeDraw = createPorts({ isCancelled: checksFor(3) });
    const afterDraw = createPorts({ isCancelled: checksFor(4) });
    const beforeCommit = createPorts({ isCancelled: checksFor(5) });

    const results = await Promise.all([
      renderScene(scene, beforeBegin.ports),
      renderScene(scene, beforeLoad.ports),
      renderScene(scene, beforeDraw.ports),
      renderScene(scene, afterDraw.ports),
      renderScene(scene, beforeCommit.ports),
    ]);

    for (const result of results) {
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [{ code: "RENDER_CANCELLED" }],
      });
    }
    expect(beforeBegin.events).toEqual([]);
    expect(beforeLoad.events).toEqual(["begin", "discard"]);
    expect(beforeDraw.events).toEqual([
      "begin",
      `load:${scene.nodes[0]?.role}`,
      `release:${scene.nodes[0]?.role}`,
      "discard",
    ]);
    expect(afterDraw.events).toEqual([
      "begin",
      `load:${scene.nodes[0]?.role}`,
      `draw:${scene.nodes[0]?.role}`,
      `release:${scene.nodes[0]?.role}`,
      "discard",
    ]);
    expect(beforeCommit.events).toEqual([
      "begin",
      `load:${scene.nodes[0]?.role}`,
      `draw:${scene.nodes[0]?.role}`,
      `release:${scene.nodes[0]?.role}`,
      "discard",
    ]);
  });

  it("maps every lifecycle operation failure without retaining unavailable resources", async () => {
    const scene = validScene();
    const begin = createPorts({ beginResult: { ok: false, kind: "failed" } });
    const load = createPorts({ loadResult: { ok: false, kind: "failed" } });
    const draw = createPorts({ drawResult: { ok: false, kind: "failed" } });
    const commit = createPorts({ commitResult: { ok: false, kind: "failed" } });
    const release = createPorts({ releaseResult: { ok: false, kind: "failed" } });
    const discard = createPorts({
      loadResult: { ok: false, kind: "failed" },
      discardResult: { ok: false, kind: "failed" },
    });

    const results = await Promise.all([
      renderScene(scene, begin.ports),
      renderScene(scene, load.ports),
      renderScene(scene, draw.ports),
      renderScene(scene, commit.ports),
      renderScene(scene, release.ports),
      renderScene(scene, discard.ports),
    ]);

    expect(results.map((result) => result.ok ? "success" : result.diagnostics.map((item) => item.code))).toEqual([
      ["RENDER_BEGIN_FAILED"],
      ["RENDER_LOAD_FAILED"],
      ["RENDER_DRAW_FAILED"],
      ["RENDER_COMMIT_FAILED"],
      ["RENDER_RELEASE_FAILED"],
      ["RENDER_LOAD_FAILED", "RENDER_DISCARD_FAILED"],
    ]);
    expect(begin.events).toEqual(["begin"]);
    expect(load.events).toEqual(["begin", `load:${scene.nodes[0]?.role}`, "discard"]);
    expect(draw.events).toEqual([
      "begin",
      `load:${scene.nodes[0]?.role}`,
      `draw:${scene.nodes[0]?.role}`,
      `release:${scene.nodes[0]?.role}`,
      "discard",
    ]);
    expect(commit.events.at(-1)).toBe("discard");
    expect(release.events.at(-1)).toBe("discard");
  });

  it("normalizes malformed, rejected, and non-commit readback port responses", async () => {
    const scene = validScene();
    const rejectedBegin = createPorts({
      beginResult: Promise.reject(new Error("native https://private.invalid/begin")),
    });
    const malformedDraw = createPorts({ drawResult: { ok: true, kind: "failed" } });
    const nonCommitReadback = createPorts({
      drawResult: { ok: false, kind: "readback-unavailable" },
    });
    const rejectedRelease = createPorts({
      releaseResult: Promise.reject(new Error("native https://private.invalid/release")),
    });

    const results = await Promise.all([
      renderScene(scene, rejectedBegin.ports),
      renderScene(scene, malformedDraw.ports),
      renderScene(scene, nonCommitReadback.ports),
      renderScene(scene, rejectedRelease.ports),
    ]);

    expect(results.map((result) => result.ok ? "success" : result.diagnostics.map((item) => item.code))).toEqual([
      ["RENDER_BEGIN_FAILED"],
      ["RENDER_DRAW_FAILED"],
      ["RENDER_DRAW_FAILED"],
      ["RENDER_RELEASE_FAILED"],
    ]);
    expect(JSON.stringify(results)).not.toContain("private.invalid");
  });

  it("snapshots stateful proxy responses at every port boundary without re-reading them", async () => {
    const scene = validScene();
    const begin = createPorts({
      beginResult: statefulPortResult({ ok: false, kind: "failed" } as const),
    });
    const load = createPorts({
      loadResult: statefulPortResult({ ok: false, kind: "failed" } as const),
    });
    const draw = createPorts({
      drawResult: statefulPortResult({ ok: false, kind: "failed" } as const),
    });
    const release = createPorts({
      releaseResult: statefulPortResult({ ok: false, kind: "failed" } as const),
    });
    const commit = createPorts({
      commitResult: statefulPortResult({ ok: false, kind: "failed" } as const),
    });
    const discard = createPorts({
      loadResult: statefulPortResult({ ok: false, kind: "failed" } as const),
      discardResult: statefulPortResult({ ok: false, kind: "failed" } as const),
    });

    const results = await Promise.all([
      renderScene(scene, begin.ports),
      renderScene(scene, load.ports),
      renderScene(scene, draw.ports),
      renderScene(scene, release.ports),
      renderScene(scene, commit.ports),
      renderScene(scene, discard.ports),
    ]);

    expect(results.map((result) => result.ok ? "success" : result.diagnostics.map((item) => item.code))).toEqual([
      ["RENDER_BEGIN_FAILED"],
      ["RENDER_LOAD_FAILED"],
      ["RENDER_DRAW_FAILED"],
      ["RENDER_RELEASE_FAILED"],
      ["RENDER_COMMIT_FAILED"],
      ["RENDER_LOAD_FAILED", "RENDER_DISCARD_FAILED"],
    ]);
    expect(JSON.stringify(results)).not.toContain("private.invalid");
  });

  it("snapshots stateful proxy success results across a complete committed render", async () => {
    const { ports } = createPorts({
      beginResult: statefulPortResult({
        ok: true,
        value: { id: "staging" },
      } as const),
      loadResult: (resource: RenderResourceDescriptor) =>
        statefulPortResult({
          ok: true,
          value: {
            metadata: leaseMetadataFor(resource),
            image: new Uint8Array([0]),
            release: async () =>
              statefulPortResult({ ok: true } as const),
          },
        } as const),
      drawResult: statefulPortResult({ ok: true } as const),
      commitResult: statefulPortResult({
        ok: true,
        value: "committed",
      } as const),
    });

    const result = await renderScene(validScene(), ports);

    expect(result).toEqual({ ok: true, committed: "committed" });

    const forcedFailure = createPorts({
      loadResult: statefulPortResult({ ok: false, kind: "failed" } as const),
      discardResult: statefulPortResult({ ok: true } as const),
    });
    const discarded = await renderScene(validScene(), forcedFailure.ports);
    expect(discarded).toMatchObject({
      ok: false,
      diagnostics: [{ code: "RENDER_LOAD_FAILED" }],
    });
    expect(forcedFailure.events.at(-1)).toBe("discard");
  });

  it("loads, draws, and releases one lease at a time for multi-node scenes", async () => {
    const scene = validScene(
      createSyntheticDraft({
        selections: { hair: SYNTHETIC_REFERENCES.hair },
      }),
    );
    let activeLeases = 0;
    let peakLeases = 0;
    const ports: RenderPorts<Uint8Array, string, string> = {
      cancellation: { isCancelled: () => false },
      imageLoader: {
        load: async (resource) => {
          activeLeases += 1;
          peakLeases = Math.max(peakLeases, activeLeases);
          return {
            ok: true,
            value: {
              metadata: leaseMetadataFor(resource),
              image: new Uint8Array([0]),
              release: async () => {
                activeLeases -= 1;
                return { ok: true } as const;
              },
            },
          } as const;
        },
      },
      driver: {
        begin: async () => ({ ok: true, value: "staging" }) as const,
        draw: async () => {
          expect(activeLeases).toBe(1);
          return { ok: true } as const;
        },
        commit: async () => ({ ok: true, value: "committed" }) as const,
        discard: async () => ({ ok: true }) as const,
      },
    };

    const result = await renderScene(scene, ports);

    expect(result).toEqual({ ok: true, committed: "committed" });
    expect(peakLeases).toBe(1);
    expect(activeLeases).toBe(0);
  });

  it("maps malformed port values to stable diagnostics without throwing", async () => {
    const scene = validScene();
    const { events, ports } = createPorts({
      loadResult: { ok: true, value: null },
    });

    await expect(renderScene(scene, ports)).resolves.toEqual({
      ok: false,
      diagnostics: [
        {
          code: "RENDER_RESOURCE_MISMATCH",
          phase: "render-load",
          subject: scene.nodes[0]?.key,
          causes: [],
        },
        {
          code: "RENDER_RELEASE_FAILED",
          phase: "render-cleanup",
          subject: scene.nodes[0]?.key,
          causes: [],
        },
      ],
    });
    expect(events).toEqual(["begin", `load:${scene.nodes[0]?.role}`, "discard"]);
  });

  it("releases a lease-like successful value exactly once even when its metadata is malformed", async () => {
    const scene = validScene();
    let releaseCalls = 0;
    const { ports } = createPorts({
      loadResult: {
        ok: true,
        value: {
          image: new Uint8Array([0]),
          release: async () => {
            releaseCalls += 1;
            return { ok: true } as const;
          },
        },
      },
    });

    const result = await renderScene(scene, ports);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "RENDER_RESOURCE_MISMATCH" }],
    });
    expect(releaseCalls).toBe(1);
  });

  it.each([
    ["source set", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, sourceSetId: "b".repeat(64) })],
    ["resource id", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, resourceId: "c".repeat(64) })],
    ["owner kind", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, owner: { kind: "asset" as const, slot: "hair" as const, reference: { id: "hair-synthetic-001", version: "1.0.0" } } })],
    ["owner slot", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, owner: { kind: "asset" as const, slot: "top" as const, reference: { id: "hair-synthetic-001", version: "1.0.0" } } })],
    ["owner id", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, owner: { kind: "muse" as const, reference: { ...metadata.owner.reference, id: "muse-other-001" } } })],
    ["owner version", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, owner: { kind: "muse" as const, reference: { ...metadata.owner.reference, version: "9.9.9" } } })],
    ["role", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, role: "hair-back" as const })],
    ["representation", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, representation: "master" as const })],
    ["width", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, width: 2048 })],
    ["height", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, height: 3072 })],
    ["encoded sha", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, encodedSha256: "d".repeat(64) })],
    ["encoded bytes", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, encodedBytes: metadata.encodedBytes + 1 })],
    ["encoded bit depth", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, encodedBitDepth: 16 as const })],
    ["decoded byte length", "RENDER_RESOURCE_LIMIT", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, decodedByteLength: metadata.decodedByteLength - 4 })],
    ["decoded bit depth", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, decodedBitDepth: 16 as const })],
    ["pixel format", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, pixelFormat: "rgba16" })],
    ["colour space", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, colourSpace: "display-p3" })],
    ["alpha mode", "RENDER_RESOURCE_MISMATCH", (metadata: RenderImageLeaseMetadata) => ({ ...metadata, alphaMode: "premultiplied" })],
  ] as const)("rejects a mismatched lease %s before draw", async (_name, expectedCode, mutate) => {
    const scene = validScene();
    let draws = 0;
    let releases = 0;
    let discards = 0;
    const result = await renderScene(scene, {
      cancellation: { isCancelled: () => false },
      imageLoader: {
        load: async (resource) => ({
          ok: true,
          value: {
            metadata: mutate(leaseMetadataFor(resource)),
            image: new Uint8Array([0]),
            release: async () => {
              releases += 1;
              return { ok: true } as const;
            },
          },
        }) as never,
      },
      driver: {
        begin: async () => ({ ok: true, value: "staging" }) as const,
        draw: async () => {
          draws += 1;
          return { ok: true } as const;
        },
        commit: async () => ({ ok: true, value: "committed" }) as const,
        discard: async () => {
          discards += 1;
          return { ok: true } as const;
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: expectedCode }],
    });
    expect(draws).toBe(0);
    expect(releases).toBe(1);
    expect(discards).toBe(1);
  });

  it("isolates the asset-owner slot comparison without changing asset identity", async () => {
    const scene = validScene(
      createSyntheticDraft({
        selections: { top: SYNTHETIC_REFERENCES.top },
      }),
    );
    const assetNode = scene.nodes.find((node) => node.owner.kind === "asset");
    if (assetNode === undefined || assetNode.owner.kind !== "asset") {
      throw new Error("Synthetic scene requires an asset node.");
    }
    let releaseCalls = 0;
    const { events, ports } = createPorts({
      loadResult: (resource: RenderResourceDescriptor) => {
        const metadata = leaseMetadataFor(resource);
        return {
          ok: true,
          value: {
            metadata:
              resource.owner.kind === "asset"
                ? {
                    ...metadata,
                    owner: {
                      kind: "asset" as const,
                      slot: "hair" as const,
                      reference: resource.owner.reference,
                    },
                  }
                : metadata,
            image: new Uint8Array([0]),
            release: async () => {
              releaseCalls += 1;
              return { ok: true } as const;
            },
          },
        };
      },
    });

    const result = await renderScene(scene, ports);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "RENDER_RESOURCE_MISMATCH" }],
    });
    expect(events).toEqual([
      "begin",
      "load:muse-body",
      "draw:muse-body",
      `load:${assetNode.role}`,
      "discard",
    ]);
    expect(releaseCalls).toBe(2);
  });

  it("uses release before discard when a primary draw failure also has cleanup failures", async () => {
    const scene = validScene();
    const { ports } = createPorts({
      drawResult: { ok: false, kind: "failed" },
      releaseResult: { ok: false, kind: "failed" },
      discardResult: { ok: false, kind: "failed" },
    });

    const result = await renderScene(scene, ports);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        { code: "RENDER_DRAW_FAILED", phase: "render-draw" },
        { code: "RENDER_RELEASE_FAILED", phase: "render-cleanup" },
        { code: "RENDER_DISCARD_FAILED", phase: "render-cleanup" },
      ],
    });
  });

  it("maps browser readback unavailability only from commit", async () => {
    const { ports } = createPorts({
      commitResult: { ok: false, kind: "readback-unavailable" },
    });

    const result = await renderScene(validScene(), ports);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        { code: "RENDER_READBACK_UNAVAILABLE", phase: "render-commit" },
      ],
    });
  });

  it("preflights unsupported targets and resource-limit facts without trusting forged keys", async () => {
    const { ports } = createPorts();
    const malformed = {
      target: "runtime",
      frame: { width: 2, height: 1536, origin: "top-left" },
      nodes: [
        {
          key: "https://example.invalid/private-path",
          resource: { width: 2, height: 1536 },
        },
      ],
    };

    const resourceLimit = await renderScene(malformed, ports);
    const unsupported = await renderScene(
      { target: "gpu://unsupported" },
      ports,
    );

    expect(resourceLimit).toEqual({
      ok: false,
      diagnostics: [
        { code: "RENDER_RESOURCE_LIMIT", phase: "render-input", causes: [] },
      ],
    });
    expect(JSON.stringify(resourceLimit)).not.toContain("example.invalid");
    expect(unsupported).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "RENDER_TARGET_UNSUPPORTED",
          phase: "render-input",
          causes: [],
        },
      ],
    });
  });

  it("preflights runtime/export encoded caps, forged allocations, and node count before ports", async () => {
    const runtime = structuredClone(validScene());
    const runtimeNode = runtime.nodes[0];
    if (runtimeNode === undefined) {
      throw new Error("Synthetic runtime scene requires a node.");
    }
    (runtimeNode.resource as { encodedBytes: number }).encodedBytes = 4_194_305;

    const exportResult = buildScene({
      draft: createSyntheticDraft(),
      catalog: syntheticCatalog,
      target: "export",
      resolver: createSyntheticResolver(),
    });
    if (!exportResult.ok) {
      throw new Error("Synthetic export scene did not compile.");
    }
    const exportScene = structuredClone(exportResult.scene);
    const exportNode = exportScene.nodes[0];
    if (exportNode === undefined) {
      throw new Error("Synthetic export scene requires a node.");
    }
    (exportNode.resource as { encodedBytes: number }).encodedBytes = 26_214_401;

    const tooManyNodes = structuredClone(validScene());
    const firstNode = tooManyNodes.nodes[0];
    if (firstNode === undefined) {
      throw new Error("Synthetic scene requires a node.");
    }
    (tooManyNodes as unknown as { nodes: unknown[] }).nodes = Array.from(
      { length: 13 },
      () => structuredClone(firstNode),
    );

    const { events, ports } = createPorts();
    const results = await Promise.all([
      renderScene(runtime, ports),
      renderScene(exportScene, ports),
      renderScene(tooManyNodes, ports),
    ]);

    for (const result of results) {
      expect(result).toEqual({
        ok: false,
        diagnostics: [
          { code: "RENDER_RESOURCE_LIMIT", phase: "render-input", causes: [] },
        ],
      });
    }
    expect(events).toEqual([]);
  });

  it("never leaks native getter or proxy failures from hostile scene input", async () => {
    const nativeMessage = "Permission denied: https://private.invalid/image.png";
    const hostileResource = new Proxy(
      {},
      {
        get() {
          throw new Error(nativeMessage);
        },
        has() {
          throw new Error(nativeMessage);
        },
      },
    );
    const hostileNode = {
      get key() {
        throw new Error(nativeMessage);
      },
      get resource() {
        return hostileResource;
      },
    };
    const hostileScene = {
      get target() {
        return "runtime";
      },
      get frame() {
        return { width: 1024, height: 1536, origin: "top-left" };
      },
      get nodes() {
        return [hostileNode];
      },
    };

    const { ports } = createPorts();
    const hostileTarget = {
      get target() {
        throw new Error(nativeMessage);
      },
    };
    const [result, targetResult] = await Promise.all([
      renderScene(hostileScene, ports),
      renderScene(hostileTarget, ports),
    ]);

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        { code: "RENDER_GRAPH_INVALID", phase: "render-input", causes: [] },
      ],
    });
    expect(targetResult).toEqual({
      ok: false,
      diagnostics: [
        { code: "RENDER_GRAPH_INVALID", phase: "render-input", causes: [] },
      ],
    });
    expect(JSON.stringify([result, targetResult])).not.toContain(nativeMessage);
  });
});
