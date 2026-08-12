# ADR 0004: Dress and separates state

- Status: Accepted
- Date: 2026-08-01

## Context

Choosing a dress temporarily replaces the visible top/bottom combination, but a
user expects the earlier separates to return when switching back.

## Decision

Retain top, bottom, and dress selections independently. `garmentMode` selects
which garment set is active. Selecting a dress activates dress mode without
deleting top/bottom; selecting a top or bottom activates separates without
deleting the dress.

## Consequences

Restoration is guaranteed by state shape rather than fragile history fields.
Compatibility evaluates only active assets.
