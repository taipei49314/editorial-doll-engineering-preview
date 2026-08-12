# ADR 0005: Reducer determinism and immutability

- Status: Accepted
- Date: 2026-08-01

## Context

Undo/redo, replay, testing, and future persistence require predictable state
transitions.

## Decision

The look reducer is a pure function of draft, command, and read-only catalog. It
does not generate IDs or read time/random sources. Successful changes increment
revision once; rejected and no-op commands preserve state and revision. Inputs
are never mutated.

## Consequences

Callers supply identity and timestamps where needed. Identical inputs produce
deeply identical outputs and can be replayed safely.
