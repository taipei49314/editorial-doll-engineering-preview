# ADR 0009: Stage the M2 asset pipeline

Status: accepted

## Context

M0/M1 is accepted, while production Muse and visual direction remain pending.
The objective source contract can be implemented and tested with synthetic PNG
fixtures without inventing art. Derivative generation adds native image tooling
and broader pixel/color behavior and should follow a smaller validation gate.

## Decision

Deliver M2 in two ordered gates:

1. M2.1 implements strict envelope, directory, path, portable PNG structure,
   budget, hash, diagnostic, report, and CLI validation.
2. M2.2 pins Sharp and adds decoded pixel/color validation, per-part runtime and
   thumbnail generation, and the generated catalog manifest.

M2.1 reuses `AssetSchema`, emits only relative paths and deterministic content,
and uses generated test PNGs rather than production artwork.

## Consequences

- Pipeline architecture progresses without a subjective Muse decision.
- Native image behavior is introduced only after source validation is proven.
- M2.1 cannot claim edge-alpha, ICC, derivative, or catalog-generation support.
- Studio, renderer, and persistence remain unchanged.
