# Editorial Doll — Engineering Preview

This public snapshot demonstrates the tested engineering foundation behind a
version-aware editorial styling system. It contains the accepted M0–M3
implementation: a strict TypeScript workspace, deterministic styling domain,
asset validation and derivative generation, and a framework-independent scene
graph and renderer.

The repository is intentionally an engineering preview, not a product release.
The Studio app remains a neutral build-verification shell. Production artwork,
Muse identity, brand direction, interaction design, internal acceptance
evidence, and later product work are maintained in a separate private
repository and are not included here.

## Included

- Immutable, deterministic look reducer and compatibility engine
- Exact `{ id, version }` asset and Muse references
- Dress/separates retention and restoration semantics
- Strict PNG and manifest validation
- Deterministic runtime and thumbnail derivative generation
- Ordered scene graph, reference compositor, and browser adapter
- Enforced workspace dependency and purity boundaries
- Unit, browser-renderer, and neutral-shell tests
- Ubuntu and Windows CI

Only synthetic fixtures and a neutral source-manifest template are included.
No production image assets are present.

## Requirements

- Node.js 24.14 or newer in the Node 24 line
- pnpm 11.9

## Verify

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm asset -- doctor --input assets-source --json
pnpm asset -- validate --input assets-source --json
pnpm asset -- generate --input assets-source --output assets-generated --json
pnpm exec playwright install chromium
pnpm test:render-browser
pnpm test:e2e
```

See [docs/architecture.md](docs/architecture.md) for the public architecture
boundary and `docs/adr/` for the accepted engineering decisions.

## Usage and licensing

This source is publicly viewable for evaluation and portfolio purposes. It is
not currently offered under an open-source license. See [LICENSE](LICENSE).
