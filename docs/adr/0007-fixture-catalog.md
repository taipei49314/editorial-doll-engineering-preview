# ADR 0007: Fixture catalog ownership

- Status: Accepted
- Date: 2026-08-01

## Context

M1 needs realistic neutral data to prove styling behavior without waiting for
final art or coupling domain tests to UI.

## Decision

`packages/catalog` owns a deterministic fixture catalog validated by production
schemas. It includes the planned mini-pack categories, deliberate incompatibility
cases, and a multi-version asset. M1 fixture paths are metadata only.

## Consequences

Domain behavior can be tested now. M2 may attach real files without changing
identity, lookup, or reducer semantics.
