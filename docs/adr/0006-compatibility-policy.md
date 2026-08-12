# ADR 0006: Compatibility and conflict policy

- Status: Accepted
- Date: 2026-08-01

## Context

Incompatible assets need precise feedback, and retained inactive garments must
not create false conflicts.

## Decision

Evaluate the simulated next active look in a fixed order. Same-slot selection
replaces. Dress/separates conflict suspends without deleting. Hard compatibility
errors reject the candidate. Relations identify exact asset versions. Rejected
operations carry `error` severity; `warning` is reserved for future non-blocking
guidance. Results have stable codes, severity, subjects, and ordering.

## Consequences

Consumers can localize messages later without parsing prose. Invalid operations
leave the draft unchanged and remain testable.
