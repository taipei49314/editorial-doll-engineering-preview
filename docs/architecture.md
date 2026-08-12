# Public engineering architecture

This snapshot covers the accepted engineering foundation through the M3 scene
graph and renderer. Product UI, production art, persistence behavior, export,
accounts, backend services, commerce, and AI integration are outside this
public snapshot.

## Boundaries

- `packages/domain` owns runtime schemas, inferred types, commands, the pure
  reducer, compatibility evaluation, and domain invariants. It has no browser,
  rendering, persistence, time, or random dependencies.
- `packages/catalog` owns deterministic exact-version lookup and synthetic
  fixtures and depends only on Domain.
- `tools/asset-pipeline` owns source discovery, validation, portable PNG
  inspection, deterministic derivatives, and generated reports.
- `packages/render-engine` owns scene schemas, deterministic scene compilation,
  rendering ports, a reference compositor, and a separate browser adapter.
- `packages/persistence` and `packages/design-system` are boundary-bearing
  shells in this snapshot.
- `apps/studio` is deliberately a neutral build-verification shell.

Workspace boundaries are enforced by ESLint, TypeScript configuration, and
repository verification scripts.

## Core invariants

- Zod schemas are the runtime source of truth; TypeScript types are inferred.
- Every resource reference includes both `id` and `version`.
- Selecting a dress retains top and bottom selections; returning to separates
  restores their exact references.
- Reducers, compatibility evaluation, catalog lookup, asset generation, and
  scene compilation are deterministic.
- Core behavior does not invent time, identity, or randomness.
- Generated resource ordering and diagnostics are stable.

## Public-snapshot exclusions

This repository does not include real Muse resources, backgrounds, garments,
visual-direction proofs, production manifests, internal QA evidence, or
unreleased interaction and product specifications. Synthetic fixtures prove
the engineering contracts only; they do not represent production content.

The detailed engineering decisions through M3 are recorded in `docs/adr/`.
