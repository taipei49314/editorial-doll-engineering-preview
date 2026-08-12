# ADR 0002: Pure domain and dependency boundaries

- Status: Accepted
- Date: 2026-08-01

## Context

Core styling behavior must remain testable without React, browser APIs,
persistence, rendering, Node runtime APIs, or a running application.

## Decision

`packages/domain` may depend only on pure external validation code. Workspace
dependencies point toward domain. ESLint restrictions, strict TypeScript, a
path-aware workspace boundary verifier, and a source purity scan enforce the
boundary automatically. The verifier also rejects undeclared workspace
dependencies and public-export bypasses.

## Consequences

Domain behavior can run in any JavaScript host. Adapters must translate external
state into validated commands instead of leaking infrastructure into the model.
