# ADR 0001: Workspace and toolchain

- Status: Accepted
- Date: 2026-08-01

## Context

The project needs one reproducible toolchain across applications, libraries,
tools, local Windows development, and Linux CI.

## Decision

Use a private pnpm workspace with Node 24.14 or newer in the Node 24 line (CI
uses 24.16.0), pnpm 11.9.0, strict TypeScript, ES modules, React + Vite for
Studio, Vitest for units, Playwright for browser smoke verification, and a
committed lockfile. Root scripts are the acceptance entry points.

## Consequences

Package versions and dependency topology remain reviewable. Node/pnpm upgrades
require an explicit architecture update and regenerated lockfile.
