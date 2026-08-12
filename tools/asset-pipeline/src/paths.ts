import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

/** Stable diagnostics for untrusted source-manifest paths. */
export type AssetPathErrorCode =
  | "SOURCE_PATH_ABSOLUTE"
  | "SOURCE_PATH_DRIVE_QUALIFIED"
  | "SOURCE_PATH_UNC"
  | "SOURCE_PATH_BACKSLASH"
  | "SOURCE_PATH_EMPTY_SEGMENT"
  | "SOURCE_PATH_DOT_SEGMENT"
  | "SOURCE_PATH_TRAVERSAL"
  | "SOURCE_PATH_CHARACTER_INVALID"
  | "SOURCE_PATH_NOT_PNG"
  | "SOURCE_FILE_NOT_FOUND"
  | "SOURCE_FILE_NOT_REGULAR"
  | "SOURCE_FILE_SYMLINK_FORBIDDEN"
  | "SOURCE_FILE_UNREADABLE"
  | "SOURCE_FILE_OUTSIDE_MANIFEST"
  | "REPORT_PATH_OUTSIDE_SOURCE_ROOT";

export class AssetPathError extends Error {
  public constructor(
    public readonly code: AssetPathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AssetPathError";
  }
}

/**
 * Compares Unicode scalar values directly. It intentionally does not use
 * localeCompare, whose result can vary with host locale and ICU data.
 */
export const compareCodePoint = (left: string, right: string): number => {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const leftPoint = leftPoints[index]?.codePointAt(0);
    const rightPoint = rightPoints[index]?.codePointAt(0);
    if (leftPoint === undefined || rightPoint === undefined) {
      continue;
    }
    if (leftPoint !== rightPoint) {
      return leftPoint < rightPoint ? -1 : 1;
    }
  }

  if (leftPoints.length === rightPoints.length) {
    return 0;
  }
  return leftPoints.length < rightPoints.length ? -1 : 1;
};

const isDriveQualified = (value: string): boolean => /^[A-Za-z]:/u.test(value);

const isUncPath = (value: string): boolean =>
  value.startsWith("\\\\") || value.startsWith("//");

/** Validates the portable forward-slash relative path contract. */
export const assertPortableRelativePath = (value: string): string => {
  if (isUncPath(value)) {
    throw new AssetPathError("SOURCE_PATH_UNC", "UNC source paths are not allowed.");
  }
  if (isDriveQualified(value)) {
    throw new AssetPathError(
      "SOURCE_PATH_DRIVE_QUALIFIED",
      "Drive-qualified source paths are not allowed.",
    );
  }
  if (path.posix.isAbsolute(value) || value.startsWith("\\")) {
    throw new AssetPathError(
      "SOURCE_PATH_ABSOLUTE",
      "Absolute source paths are not allowed.",
    );
  }
  if (value.includes("\\")) {
    throw new AssetPathError(
      "SOURCE_PATH_BACKSLASH",
      "Source paths must use forward slashes.",
    );
  }
  if (
    /[<>:"|?*]/u.test(value) ||
    Array.from(value).some((character) => character.charCodeAt(0) < 0x20)
  ) {
    throw new AssetPathError(
      "SOURCE_PATH_CHARACTER_INVALID",
      "Source paths must use portable filename characters.",
    );
  }

  for (const segment of value.split("/")) {
    if (segment === "") {
      throw new AssetPathError(
        "SOURCE_PATH_EMPTY_SEGMENT",
        "Source paths cannot contain empty segments.",
      );
    }
    if (segment === ".") {
      throw new AssetPathError(
        "SOURCE_PATH_DOT_SEGMENT",
        "Source paths cannot contain current-directory segments.",
      );
    }
    if (segment === "..") {
      throw new AssetPathError(
        "SOURCE_PATH_TRAVERSAL",
        "Source paths cannot contain traversal segments.",
      );
    }
  }

  return value;
};

export const assertPortableRelativePngPath = (value: string): string => {
  assertPortableRelativePath(value);
  if (!value.endsWith(".png")) {
    throw new AssetPathError(
      "SOURCE_PATH_NOT_PNG",
      "Source paths must name a lowercase .png file.",
    );
  }
  return value;
};

const isContained = (rootPath: string, targetPath: string): boolean => {
  const relativePath = path.relative(rootPath, targetPath);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

/**
 * Produces portable report paths and refuses to serialize paths outside the
 * declared source root.
 */
export const toSourceRootRelativePosixPath = (
  sourceRoot: string,
  sourcePath: string,
): string => {
  const rootPath = path.resolve(sourceRoot);
  const targetPath = path.resolve(sourcePath);
  if (!isContained(rootPath, targetPath)) {
    throw new AssetPathError(
      "REPORT_PATH_OUTSIDE_SOURCE_ROOT",
      "Report paths must remain inside the declared source root.",
    );
  }
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
};

export interface ContainedSourceFile {
  readonly absolutePath: string;
  readonly manifestRelativePath: string;
}

/**
 * Resolves a manifest-declared PNG after validating both lexical and realpath
 * containment. This prevents a valid-looking path or file symlink escaping the
 * asset version directory.
 */
export const resolveContainedSourceFile = async (
  manifestDirectory: string,
  declaredSourcePath: string,
): Promise<ContainedSourceFile> => {
  const portablePath = assertPortableRelativePngPath(declaredSourcePath);
  let manifestRealPath: string;
  try {
    manifestRealPath = await realpath(manifestDirectory);
  } catch {
    throw new AssetPathError(
      "SOURCE_FILE_UNREADABLE",
      "The manifest directory could not be resolved.",
    );
  }

  const candidatePath = path.resolve(
    manifestRealPath,
    ...portablePath.split("/"),
  );

  let sourceRealPath: string;
  try {
    sourceRealPath = await realpath(candidatePath);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "ENOENT") {
      throw new AssetPathError(
        "SOURCE_FILE_NOT_FOUND",
        "The declared source file does not exist.",
      );
    }
    throw new AssetPathError(
      "SOURCE_FILE_UNREADABLE",
      "The declared source file could not be resolved.",
    );
  }

  if (!isContained(manifestRealPath, sourceRealPath)) {
    throw new AssetPathError(
      "SOURCE_FILE_OUTSIDE_MANIFEST",
      "The declared source file resolves outside its manifest directory.",
    );
  }

  const candidateStats = await lstat(candidatePath);
  if (candidateStats.isSymbolicLink()) {
    throw new AssetPathError(
      "SOURCE_FILE_SYMLINK_FORBIDDEN",
      "Source files must not be symbolic links.",
    );
  }

  const sourceStats = await lstat(sourceRealPath);
  if (!sourceStats.isFile()) {
    throw new AssetPathError(
      "SOURCE_FILE_NOT_REGULAR",
      "The declared source path must resolve to a regular file.",
    );
  }

  return {
    absolutePath: sourceRealPath,
    manifestRelativePath: toSourceRootRelativePosixPath(
      manifestRealPath,
      sourceRealPath,
    ),
  };
};
