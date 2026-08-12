# ADR 0003: Exact versioned asset references

- Status: Accepted
- Date: 2026-08-01

## Context

Looks must remain reproducible after a catalog asset receives a newer version.
An ID alone cannot identify the exact content used by a saved draft.

## Decision

Every Muse and asset reference contains `{ id, version }`, including
compatibility constraints, supported Muses, and warning relations. Versions use
strict semantic `major.minor.patch` form. Catalog lookup uses the composite key
and never substitutes a different version.

## Consequences

Missing versions are explicit data errors. Published versions are immutable, and
content changes require a new version.
