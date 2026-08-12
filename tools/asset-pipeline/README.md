# Editorial Asset CLI

`editorial-asset` is the repository-local M2 asset contract validator. It uses
no network, credentials, user configuration, or hidden global state.

Build and run it from the repository root:

```powershell
pnpm build
pnpm asset -- doctor --input assets-source --json
pnpm asset -- validate --input assets-source --json
pnpm asset -- inspect path/to/manifest.json --json
pnpm asset -- generate --input assets-source --output assets-generated --json
```

## Command contract

- `doctor --input <source-root>` checks the supported Node runtime and a readable
  source directory.
- `inspect <manifest>` validates one envelope and its declared master PNG parts.
- `validate --input <source-root> [--report <file>]` validates the complete
  source tree. A report path must remain outside the source tree and is replaced
  atomically.
- `generate --input <source-root> --output <generated-root> [--report <file>]`
  repeats complete validation, creates fixed per-part runtime/thumbnail PNGs,
  and atomically selects an immutable generated release. All paths are explicit,
  non-overlapping, and the optional report remains outside both roots.

Run these commands only with source, generated, and report-parent directories
controlled by the invoking OS account for the complete command. The pipeline
rejects links, junctions, changed identities, and conflicting cooperating
publishers, but portable Node path APIs are not a sandbox against malicious
same-account filesystem races. See
`docs/adr/0011-m2.2-filesystem-trust-boundary.md`.

M2.1 container checks remain the first gate. M2.2 reconstructs the accepted
8/16-bit RGBA scanlines, enforces colour/alpha/edge evidence, generates both
derivatives directly from the full master, and publishes a strict generated
catalog. It never creates a Muse, production artwork, scene graph, or UI.

Run `editorial-asset --help` for the complete implemented flags. There is no
implicit output, clean, delete, fix, or broad build command.

## JSON policy

With `--json`, the binary emits exactly one JSON value to stdout. A validation
result uses this stable top-level shape:

```json
{
  "schemaVersion": "2.0.0",
  "ok": true,
  "summary": {
    "manifests": 0,
    "assets": 0,
    "parts": 0,
    "errors": 0
  },
  "assets": [],
  "diagnostics": []
}
```

Usage or internal command errors use:

```json
{
  "schemaVersion": "2.0.0",
  "ok": false,
  "error": {
    "code": "CLI_ARGUMENT_INVALID",
    "message": "A stable, non-sensitive explanation."
  }
}
```

Exit code `0` means success, `2` means source validation failed, and `1` means
the command could not be executed. JSON and generated reports never contain
timestamps, random values, credentials, or machine-absolute source paths.

Successful `generate --json` output is the generated catalog schema `1.0.0`.
Derivative paths are release-relative and resolve through
`releasePath: "releases/<releaseId>"`. Internal staging/lock tokens never enter
the catalog; root `catalog.json` is byte-identical to the selected release's
catalog.
