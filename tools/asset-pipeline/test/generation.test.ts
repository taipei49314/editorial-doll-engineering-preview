import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GeneratedCatalogSchema,
} from "../src/generated-catalog.js";
import {
  GenerationError,
  generateAssetRelease,
  type GenerationPhase,
} from "../src/generation.js";
import { canonicalJson } from "../src/report.js";
import { validateSourceTree } from "../src/validation.js";
import { makeTechnicalPng, writeAssetFixture } from "./helpers.js";

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "editorial-generation-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const setupFixture = async (): Promise<{
  readonly sourceRoot: string;
  readonly generatedRoot: string;
  readonly manifestPath: string;
}> => {
  const workspace = await makeTemporaryDirectory();
  const sourceRoot = path.join(workspace, "source");
  const generatedRoot = path.join(workspace, "generated");
  await mkdir(sourceRoot);
  const fixture = await writeAssetFixture(sourceRoot, {
    pngs: { "top.png": makeTechnicalPng() },
  });
  return { sourceRoot, generatedRoot, manifestPath: fixture.manifestPath };
};

const acceptedReport = async (sourceRoot: string) => {
  const report = await validateSourceTree(sourceRoot);
  expect(report.ok).toBe(true);
  return report;
};

const activeStageRelease = async (generatedRoot: string): Promise<string> => {
  const stages = await readdir(path.join(generatedRoot, ".staging"));
  expect(stages).toHaveLength(1);
  return path.join(generatedRoot, ".staging", stages[0] ?? "", "release");
};

describe("immutable generated release", () => {
  it.each([
    "STAGE_CREATED",
    "DERIVATIVE_WRITTEN",
    "POST_VALIDATION_COMPLETE",
    "SOURCE_RECHECK_START",
    "LEDGER_RESCAN_COMPLETE",
    "RELEASE_PROMOTION_START",
  ] as const)("preserves an empty publication state when %s fails", async (target) => {
    const fixture = await setupFixture();
    await expect(
      generateAssetRelease({
        sourceRoot: fixture.sourceRoot,
        generatedRoot: fixture.generatedRoot,
        report: await acceptedReport(fixture.sourceRoot),
        hooks: {
          onPhase: (phase) => {
            if (phase === target) {
              throw new GenerationError("GENERATION_PUBLICATION_FAILED", 1);
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: "GENERATION_PUBLICATION_FAILED" });
    expect(await readdir(path.join(fixture.generatedRoot, "releases"))).toEqual([]);
    await expect(
      readFile(path.join(fixture.generatedRoot, "catalog.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("generates, validates, and byte-identically reuses one synthetic release", async () => {
    const fixture = await setupFixture();
    const report = await acceptedReport(fixture.sourceRoot);
    const first = await generateAssetRelease({
      sourceRoot: fixture.sourceRoot,
      generatedRoot: fixture.generatedRoot,
      report,
    });
    expect(GeneratedCatalogSchema.parse(first.catalog)).toEqual(first.catalog);
    expect(first.catalog.assets).toHaveLength(1);
    expect(first.reusedRelease).toBe(false);
    const generatedPart = first.catalog.assets[0]?.parts[0];
    expect(generatedPart).toBeDefined();
    for (const relativePath of [
      generatedPart?.runtime.path,
      generatedPart?.thumbnail.path,
    ]) {
      expect(relativePath).toBeDefined();
      const bytes = await readFile(
        path.join(
          fixture.generatedRoot,
          first.catalog.releasePath,
          ...(relativePath ?? "").split("/"),
        ),
      );
      expect(bytes.byteLength).toBeGreaterThan(0);
    }

    const second = await generateAssetRelease({
      sourceRoot: fixture.sourceRoot,
      generatedRoot: fixture.generatedRoot,
      report: await acceptedReport(fixture.sourceRoot),
    });
    expect(second.reusedRelease).toBe(true);
    expect(second.catalogBytes).toEqual(first.catalogBytes);
    expect(await readFile(path.join(fixture.generatedRoot, "catalog.json"))).toEqual(
      first.catalogBytes,
    );
  });

  it("rejects changed raw manifest bytes for a published id@version", async () => {
    const fixture = await setupFixture();
    const first = await generateAssetRelease({
      sourceRoot: fixture.sourceRoot,
      generatedRoot: fixture.generatedRoot,
      report: await acceptedReport(fixture.sourceRoot),
    });
    const previousPointer = await readFile(
      path.join(fixture.generatedRoot, "catalog.json"),
    );
    const manifest = await readFile(fixture.manifestPath, "utf8");
    await writeFile(fixture.manifestPath, `${manifest}\n`);

    await expect(
      generateAssetRelease({
        sourceRoot: fixture.sourceRoot,
        generatedRoot: fixture.generatedRoot,
        report: await acceptedReport(fixture.sourceRoot),
      }),
    ).rejects.toMatchObject({ code: "PUBLISHED_VERSION_IMMUTABLE" });
    expect(await readFile(path.join(fixture.generatedRoot, "catalog.json"))).toEqual(
      previousPointer,
    );
    expect(first.catalog.releaseId).toBe(
      GeneratedCatalogSchema.parse(JSON.parse(previousPointer.toString("utf8")))
        .releaseId,
    );
  });

  it("detects source mutation inside the publication lock", async () => {
    const fixture = await setupFixture();
    const report = await acceptedReport(fixture.sourceRoot);
    let changed = false;
    await expect(
      generateAssetRelease({
        sourceRoot: fixture.sourceRoot,
        generatedRoot: fixture.generatedRoot,
        report,
        hooks: {
          onPhase: async (phase) => {
            if (phase === "SOURCE_RECHECK_START" && !changed) {
              changed = true;
              await writeFile(
                fixture.manifestPath,
                `${await readFile(fixture.manifestPath, "utf8")}\n`,
              );
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED_DURING_GENERATION" });
    await expect(
      readFile(path.join(fixture.generatedRoot, "catalog.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["LEDGER_RESCAN_COMPLETE", "RELEASE_PROMOTION_START"] as const)(
    "rejects source mutation at the final %s boundary",
    async (target) => {
      const fixture = await setupFixture();
      let changed = false;
      await expect(
        generateAssetRelease({
          sourceRoot: fixture.sourceRoot,
          generatedRoot: fixture.generatedRoot,
          report: await acceptedReport(fixture.sourceRoot),
          hooks: {
            onPhase: async (phase) => {
              if (phase === target && !changed) {
                changed = true;
                await writeFile(
                  fixture.manifestPath,
                  `${await readFile(fixture.manifestPath, "utf8")}\n`,
                );
              }
            },
          },
        }),
      ).rejects.toMatchObject({ code: "SOURCE_CHANGED_DURING_GENERATION" });
      await expect(
        readFile(path.join(fixture.generatedRoot, "catalog.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(path.join(fixture.generatedRoot, "releases"))).toEqual(
        [],
      );
    },
  );

  it("rejects a staged derivative changed after its reopen gate", async () => {
    const fixture = await setupFixture();
    const report = await acceptedReport(fixture.sourceRoot);
    const asset = report.assets[0];
    expect(asset).toBeDefined();
    const basePath = path.posix.dirname(asset?.manifest.path ?? "");
    let changed = false;
    await expect(
      generateAssetRelease({
        sourceRoot: fixture.sourceRoot,
        generatedRoot: fixture.generatedRoot,
        report,
        hooks: {
          onPhase: async (phase) => {
            if (phase === "DERIVATIVE_WRITTEN" && !changed) {
              changed = true;
              await writeFile(
                path.join(
                  await activeStageRelease(fixture.generatedRoot),
                  ...basePath.split("/"),
                  "runtime",
                  "top.png",
                ),
                "tampered",
              );
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: "GENERATED_RELEASE_CONTENT_MISMATCH" });
    expect(await readdir(path.join(fixture.generatedRoot, "releases"))).toEqual([]);
  });

  it("rejects a staged thumbnail junction without writing outside", async (context) => {
    const fixture = await setupFixture();
    const report = await acceptedReport(fixture.sourceRoot);
    const asset = report.assets[0];
    expect(asset).toBeDefined();
    const basePath = path.posix.dirname(asset?.manifest.path ?? "");
    const external = path.join(path.dirname(fixture.generatedRoot), "external");
    const sentinel = path.join(external, "sentinel.txt");
    await mkdir(external);
    await writeFile(sentinel, "safe", "utf8");
    let linked = false;
    try {
      await expect(
        generateAssetRelease({
          sourceRoot: fixture.sourceRoot,
          generatedRoot: fixture.generatedRoot,
          report,
          hooks: {
            onPhase: async (phase) => {
              if (phase === "DERIVATIVE_WRITTEN" && !linked) {
                linked = true;
                const thumbnail = path.join(
                  await activeStageRelease(fixture.generatedRoot),
                  ...basePath.split("/"),
                  "thumbnail",
                );
                await symlink(
                  external,
                  thumbnail,
                  process.platform === "win32" ? "junction" : "dir",
                );
              }
            },
          },
        }),
      ).rejects.toMatchObject({ code: "GENERATION_STAGE_CLEANUP_REFUSED" });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "EPERM" || code === "EACCES") {
        context.skip("Host does not permit directory-link creation.");
        return;
      }
      throw error;
    }
    expect(await readFile(sentinel, "utf8")).toBe("safe");
    await expect(readFile(path.join(external, "top.png"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readdir(path.join(fixture.generatedRoot, "releases"))).toEqual([]);
  });

  it("rejects a promotion-parent junction swap and preserves its target", async (context) => {
    const fixture = await setupFixture();
    const external = path.join(path.dirname(fixture.generatedRoot), "external-release");
    const sentinel = path.join(external, "sentinel.txt");
    await mkdir(external);
    await writeFile(sentinel, "safe", "utf8");
    let linked = false;
    try {
      await expect(
        generateAssetRelease({
          sourceRoot: fixture.sourceRoot,
          generatedRoot: fixture.generatedRoot,
          report: await acceptedReport(fixture.sourceRoot),
          hooks: {
            onPhase: async (phase) => {
              if (phase === "RELEASE_PROMOTION_START" && !linked) {
                linked = true;
                const releases = path.join(fixture.generatedRoot, "releases");
                const displaced = path.join(
                  fixture.generatedRoot,
                  "releases-displaced",
                );
                await rename(releases, displaced);
                await symlink(
                  external,
                  releases,
                  process.platform === "win32" ? "junction" : "dir",
                );
              }
            },
          },
        }),
      ).rejects.toMatchObject({ code: "GENERATED_PATH_LINK_FORBIDDEN" });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "EPERM" || code === "EACCES") {
        context.skip("Host does not permit directory-link creation.");
        return;
      }
      throw error;
    }
    expect(await readFile(sentinel, "utf8")).toBe("safe");
    expect(await readdir(external)).toEqual(["sentinel.txt"]);
  });

  it("refuses an ordinary stage-release replacement before promotion", async () => {
    const fixture = await setupFixture();
    let replacementSentinel: string | undefined;
    await expect(
      generateAssetRelease({
        sourceRoot: fixture.sourceRoot,
        generatedRoot: fixture.generatedRoot,
        report: await acceptedReport(fixture.sourceRoot),
        hooks: {
          onPhase: async (phase) => {
            if (phase !== "RELEASE_PROMOTION_START") {
              return;
            }
            const release = await activeStageRelease(fixture.generatedRoot);
            await rename(release, `${release}-owned`);
            await mkdir(release);
            replacementSentinel = path.join(release, "foreign.txt");
            await writeFile(replacementSentinel, "safe", "utf8");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "GENERATION_STAGE_CLEANUP_REFUSED" });
    expect(replacementSentinel).toBeDefined();
    expect(await readFile(replacementSentinel ?? "", "utf8")).toBe("safe");
    expect(await readdir(path.join(fixture.generatedRoot, "releases"))).toEqual([]);
  });

  it("refuses a whole-stage replacement even when the owned release is moved back", async () => {
    const fixture = await setupFixture();
    let replacementMarker: string | undefined;
    await expect(
      generateAssetRelease({
        sourceRoot: fixture.sourceRoot,
        generatedRoot: fixture.generatedRoot,
        report: await acceptedReport(fixture.sourceRoot),
        hooks: {
          onPhase: async (phase) => {
            if (phase !== "RELEASE_PROMOTION_START") {
              return;
            }
            const stages = await readdir(
              path.join(fixture.generatedRoot, ".staging"),
            );
            const token = stages[0] ?? "";
            const stage = path.join(fixture.generatedRoot, ".staging", token);
            const displaced = `${stage}-owned`;
            await rename(stage, displaced);
            await mkdir(stage);
            replacementMarker = path.join(stage, ".owned-stage");
            await writeFile(replacementMarker, token, "utf8");
            await rename(path.join(displaced, "release"), path.join(stage, "release"));
          },
        },
      }),
    ).rejects.toMatchObject({ code: "GENERATION_STAGE_CLEANUP_REFUSED" });
    expect(replacementMarker).toBeDefined();
    expect(await readFile(replacementMarker ?? "", "utf8")).not.toBe("");
    expect(await readdir(path.join(fixture.generatedRoot, "releases"))).toEqual([]);
  });

  it("never replaces a destination introduced at the promotion boundary", async () => {
    const fixture = await setupFixture();
    let foreignSentinel: string | undefined;
    await expect(
      generateAssetRelease({
        sourceRoot: fixture.sourceRoot,
        generatedRoot: fixture.generatedRoot,
        report: await acceptedReport(fixture.sourceRoot),
        hooks: {
          onPhase: async (phase) => {
            if (phase !== "RELEASE_PROMOTION_START") {
              return;
            }
            const stageRelease = await activeStageRelease(fixture.generatedRoot);
            const stagedCatalog = GeneratedCatalogSchema.parse(
              JSON.parse(await readFile(path.join(stageRelease, "catalog.json"), "utf8")),
            );
            const destination = path.join(
              fixture.generatedRoot,
              stagedCatalog.releasePath,
            );
            await mkdir(destination);
            foreignSentinel = path.join(destination, "foreign.txt");
            await writeFile(foreignSentinel, "safe", "utf8");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "GENERATED_RELEASE_CONTENT_MISMATCH" });
    expect(foreignSentinel).toBeDefined();
    expect(await readFile(foreignSentinel ?? "", "utf8")).toBe("safe");
    await expect(
      readFile(path.join(fixture.generatedRoot, "catalog.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a complete orphan after post-promotion pointer failure and reuses it", async () => {
    const fixture = await setupFixture();
    const report = await acceptedReport(fixture.sourceRoot);
    const failAt = (target: GenerationPhase) => (phase: GenerationPhase): void => {
      if (phase === target) {
        throw new GenerationError("GENERATION_PUBLICATION_FAILED", 1);
      }
    };
    await expect(
      generateAssetRelease({
        sourceRoot: fixture.sourceRoot,
        generatedRoot: fixture.generatedRoot,
        report,
        hooks: { onPhase: failAt("ROOT_CATALOG_REPLACE_START") },
      }),
    ).rejects.toMatchObject({ code: "GENERATION_PUBLICATION_FAILED" });
    await expect(
      readFile(path.join(fixture.generatedRoot, "catalog.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(path.join(fixture.generatedRoot, "releases"))).toHaveLength(1);

    const recovered = await generateAssetRelease({
      sourceRoot: fixture.sourceRoot,
      generatedRoot: fixture.generatedRoot,
      report: await acceptedReport(fixture.sourceRoot),
    });
    expect(recovered.reusedRelease).toBe(true);
    expect(await readFile(path.join(fixture.generatedRoot, "catalog.json"), "utf8")).toBe(
      canonicalJson(recovered.catalog),
    );
  });

  it("keeps an existing root catalog byte-identical after a later pointer failure", async () => {
    const fixture = await setupFixture();
    await generateAssetRelease({
      sourceRoot: fixture.sourceRoot,
      generatedRoot: fixture.generatedRoot,
      report: await acceptedReport(fixture.sourceRoot),
    });
    const previousPointer = await readFile(
      path.join(fixture.generatedRoot, "catalog.json"),
    );
    await writeAssetFixture(fixture.sourceRoot, {
      slot: "bottom",
      id: "bottom-fixture-001",
    });
    await expect(
      generateAssetRelease({
        sourceRoot: fixture.sourceRoot,
        generatedRoot: fixture.generatedRoot,
        report: await acceptedReport(fixture.sourceRoot),
        hooks: {
          onPhase: (phase) => {
            if (phase === "ROOT_CATALOG_REPLACE_START") {
              throw new GenerationError("GENERATION_PUBLICATION_FAILED", 1);
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: "GENERATION_PUBLICATION_FAILED" });
    expect(await readFile(path.join(fixture.generatedRoot, "catalog.json"))).toEqual(
      previousPointer,
    );
  }, 15_000);

  it("publishes nothing when failure is injected before promotion", async () => {
    const fixture = await setupFixture();
    const report = await acceptedReport(fixture.sourceRoot);
    await expect(
      generateAssetRelease({
        sourceRoot: fixture.sourceRoot,
        generatedRoot: fixture.generatedRoot,
        report,
        hooks: {
          onPhase: (phase) => {
            if (phase === "RELEASE_PROMOTION_START") {
              throw new GenerationError("GENERATION_PUBLICATION_FAILED", 1);
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: "GENERATION_PUBLICATION_FAILED" });
    expect(await readdir(path.join(fixture.generatedRoot, "releases"))).toEqual([]);
  });

  it("serializes conflicting publishers and rejects the losing version on retry", async () => {
    const workspace = await makeTemporaryDirectory();
    const firstSource = path.join(workspace, "source-a");
    const secondSource = path.join(workspace, "source-b");
    const generatedRoot = path.join(workspace, "generated");
    await mkdir(firstSource);
    await mkdir(secondSource);
    await writeAssetFixture(firstSource);
    const secondFixture = await writeAssetFixture(secondSource);
    await writeFile(
      secondFixture.manifestPath,
      `${await readFile(secondFixture.manifestPath, "utf8")}\n`,
    );
    const firstReport = await acceptedReport(firstSource);
    const secondReport = await acceptedReport(secondSource);

    let signalLocked: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseLock: (() => void) | undefined;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const winner = generateAssetRelease({
      sourceRoot: firstSource,
      generatedRoot,
      report: firstReport,
      hooks: {
        onPhase: async (phase) => {
          if (phase === "SOURCE_RECHECK_START") {
            signalLocked?.();
            await holdLock;
          }
        },
      },
    });
    await locked;
    await expect(
      generateAssetRelease({
        sourceRoot: secondSource,
        generatedRoot,
        report: secondReport,
      }),
    ).rejects.toMatchObject({ code: "GENERATION_LOCK_UNAVAILABLE" });
    releaseLock?.();
    await expect(winner).resolves.toBeDefined();

    await expect(
      generateAssetRelease({
        sourceRoot: secondSource,
        generatedRoot,
        report: secondReport,
      }),
    ).rejects.toMatchObject({ code: "PUBLISHED_VERSION_IMMUTABLE" });
  });
});
