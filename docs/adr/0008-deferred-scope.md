# ADR 0008: Later-scope deferral

- Status: Accepted
- Date: 2026-08-01

## Context

Premature implementations in rendering, persistence, asset processing, or UI
would harden assumptions before their contracts and visual direction are
approved.

## Decision

M0/M1 creates package boundaries but implements no asset transformation,
rendering, persistence, formal Atelier UI, export, AI, backend, accounts,
commerce, 3D, or WebGL. Studio remains a neutral verification shell.

## Consequences

Each later milestone begins only after its dependency gate passes. Empty product
routes, fake buttons, and speculative dependencies are prohibited.
