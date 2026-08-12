import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { compareCodePoint } from "./paths.js";

export interface SourceDiscovery {
  readonly manifestPaths: readonly string[];
  readonly pngPaths: readonly string[];
}

export type AssetDiscoveryErrorCode =
  | "SOURCE_ROOT_NOT_FOUND"
  | "SOURCE_ROOT_NOT_DIRECTORY"
  | "SOURCE_ROOT_UNREADABLE";

export class AssetDiscoveryError extends Error {
  public constructor(
    public readonly code: AssetDiscoveryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AssetDiscoveryError";
  }
}

const isPngName = (name: string): boolean => name.toLowerCase().endsWith(".png");

/**
 * Discovers source manifests and PNG candidates in deterministic order. Any
 * `_templates` directory and every directory symlink is ignored deliberately.
 */
export const discoverSourceFiles = async (
  sourceRoot: string,
): Promise<SourceDiscovery> => {
  const rootPath = path.resolve(sourceRoot);
  let rootStats: Awaited<ReturnType<typeof stat>>;
  try {
    rootStats = await stat(rootPath);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "ENOENT") {
      throw new AssetDiscoveryError(
        "SOURCE_ROOT_NOT_FOUND",
        "The declared source root does not exist.",
      );
    }
    throw new AssetDiscoveryError(
      "SOURCE_ROOT_UNREADABLE",
      "The declared source root could not be read.",
    );
  }
  if (!rootStats.isDirectory()) {
    throw new AssetDiscoveryError(
      "SOURCE_ROOT_NOT_DIRECTORY",
      "The declared source root must be a directory.",
    );
  }

  const manifestPaths: string[] = [];
  const pngPaths: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodePoint(left.name, right.name));

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const entryStats = await lstat(entryPath);
      if (entryStats.isDirectory()) {
        if (entry.name !== "_templates") {
          await walk(entryPath);
        }
        continue;
      }

      if (entryStats.isSymbolicLink()) {
        try {
          const targetStats = await stat(entryPath);
          if (targetStats.isDirectory()) {
            continue;
          }
        } catch {
          // A broken link cannot be a usable manifest or source part.
          continue;
        }
      }

      if (!entryStats.isFile() && !entryStats.isSymbolicLink()) {
        continue;
      }
      if (entry.name === "manifest.json") {
        manifestPaths.push(entryPath);
      }
      if (isPngName(entry.name)) {
        pngPaths.push(entryPath);
      }
    }
  };

  await walk(rootPath);
  manifestPaths.sort(compareCodePoint);
  pngPaths.sort(compareCodePoint);

  return Object.freeze({
    manifestPaths: Object.freeze(manifestPaths),
    pngPaths: Object.freeze(pngPaths),
  });
};
