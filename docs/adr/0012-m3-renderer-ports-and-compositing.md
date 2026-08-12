# ADR 0012: M3 renderer ports and deterministic compositing

- Status: Accepted
- Date: 2026-08-04

## Context

M2.2 publishes immutable asset releases with runtime derivatives and master
source evidence, but its generated catalog is a Node/Sharp pipeline ledger, not
the Muse-bearing Domain catalog. It intentionally has no approved Muse resource.
Importing that tool package into the renderer would break the browser-ready
dependency direction and confuse two different sources of truth.

M3 must still prove exact active-layer mapping and both runtime- and master-
resolution compositing without inventing a Muse, adding product UI, or making
filesystem/network behavior part of the render engine.

## Decision

- Keep scene semantics in `packages/render-engine`, depending only on Domain and
  Zod runtime validation.
- Accept a host-verified, synchronous resource resolver that joins exact Domain
  identity/role requests to opaque release-bound resource descriptors. The
  renderer never imports or parses the asset-pipeline package and never receives
  a path or URL.
- Bind one complete resource set with a canonical lowercase SHA-256
  `sourceSetId`. A future production host derives it from exact M2 release and
  source-report identity plus the exact approved Muse resource-set and runtime/
  master hashes. Synthetic tests use distinctly labeled synthetic provenance.
- Treat the host and loader as an explicit trust boundary: core validates
  descriptor/lease echoes but cannot prove bytes behind opaque handles. A
  production host must verify those encoded bytes before crossing the boundary.
- Build a pure, synchronous, deeply frozen scene graph from validated
  `LookDraft`, Domain catalog, existing compatibility evaluation, and resolver
  results.
- Derive active nodes from Domain garment-mode rules and order them by
  `LAYER_ROLE_ORDER` plus an explicit code-point total order. No caller-defined
  placement or visual operation enters the graph.
- Define runtime as a 1024 × 1536 RGBA8 composite of M2 runtime resources and
  export as a 2048 × 3072 RGBA8 master-resolution composite. M3 export is an
  unencoded surface, not a downloadable file or a 16-bit archival promise.
- Render through explicit image-loader and transactional-driver ports. Load one
  resource at a time; validate every lease; release it exactly once; commit only
  after all layers succeed; discard on failure or cancellation after begin.
  Commit returns a detached, newly-owned complete frame and never mutates a
  consumer-visible canvas.
- Make a fixed integer straight-alpha RGBA8 source-over implementation the
  deterministic reference driver.
- Provide a separate browser Canvas 2D adapter using injected surface and image
  providers. Verify it against synthetic in-memory probes in a package-local
  non-product harness; build it with a separate DOM-enabled TypeScript config so
  core remains ES-only; keep Studio unchanged.
- Use synthetic Muse/body and layer resources only in tests. Do not claim a
  production resource join, Muse approval, art approval, or production visual
  QA.

## Consequences

- Scene graphs, resource requests, diagnostic order, and reference compositing
  are deterministic and testable in plain Node without React, DOM, I/O, time, or
  randomness.
- The browser adapter can be exercised before M4 without creating an Atelier or
  binding the core package to global DOM discovery.
- A later composition-layer adapter must validate M2 generated metadata and
  approved Muse resources before constructing the resolver. That future adapter
  remains an explicit gate rather than a hidden dependency.
- Runtime and export surface pixels can be verified with synthetic fixtures, but
  M3 does not promise encoded PNG bytes, cross-browser byte equality, 16-bit
  output, matte quality, seam quality, or an approved visual result.
- Production compositing and the mini art pack remain blocked on the Muse
  identity and visual-direction decision.
