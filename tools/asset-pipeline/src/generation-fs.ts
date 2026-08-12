import { createHash, randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

import { compareCodePoint } from "./paths.js";

export type GenerationFileErrorCode =
  | "GENERATED_PATH_LINK_FORBIDDEN"
  | "GENERATED_PATH_TYPE_INVALID"
  | "GENERATED_PATH_OUTSIDE_ROOT"
  | "GENERATED_RELEASE_CONTENT_MISMATCH"
  | "GENERATION_LOCK_UNAVAILABLE"
  | "GENERATION_LOCK_RELEASE_REFUSED"
  | "GENERATION_STAGE_CLEANUP_REFUSED"
  | "SOURCE_OUTPUT_OVERLAP"
  | "REPORT_PATH_OVERLAP";

export class GenerationFileError extends Error {
  public constructor(public readonly code: GenerationFileErrorCode) {
    super(code);
    this.name = "GenerationFileError";
  }
}

export interface FileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

const identityOf = (stats: Stats): FileIdentity => ({
  device: BigInt(stats.dev),
  inode: BigInt(stats.ino),
});

const sameIdentity = (left: FileIdentity, right: Stats): boolean =>
  left.device === BigInt(right.dev) && left.inode === BigInt(right.ino);

const errorCodeOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;

export const isInsideOrEqual = (
  parentPath: string,
  candidatePath: string,
): boolean => {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};

export const resolveFutureRealPath = async (
  candidatePath: string,
): Promise<string> => {
  const missingSegments: string[] = [];
  let cursor = path.resolve(candidatePath);
  while (true) {
    try {
      const existingRealPath = await realpath(cursor);
      return path.join(existingRealPath, ...missingSegments.reverse());
    } catch (error) {
      const parent = path.dirname(cursor);
      if (errorCodeOf(error) !== "ENOENT" || parent === cursor) {
        throw error;
      }
      missingSegments.push(path.basename(cursor));
      cursor = parent;
    }
  }
};

export const assertGenerationPathsSeparated = async (
  sourceRoot: string,
  generatedRoot: string,
  reportPath?: string,
): Promise<void> => {
  const source = path.resolve(sourceRoot);
  const generated = path.resolve(generatedRoot);
  const [sourceReal, generatedReal] = await Promise.all([
    resolveFutureRealPath(source),
    resolveFutureRealPath(generated),
  ]);

  if (
    isInsideOrEqual(source, generated) ||
    isInsideOrEqual(generated, source) ||
    isInsideOrEqual(sourceReal, generatedReal) ||
    isInsideOrEqual(generatedReal, sourceReal)
  ) {
    throw new GenerationFileError("SOURCE_OUTPUT_OVERLAP");
  }

  if (reportPath === undefined) {
    return;
  }
  const report = path.resolve(reportPath);
  const reportReal = await resolveFutureRealPath(report);
  if (
    isInsideOrEqual(source, report) ||
    isInsideOrEqual(generated, report) ||
    isInsideOrEqual(sourceReal, reportReal) ||
    isInsideOrEqual(generatedReal, reportReal)
  ) {
    throw new GenerationFileError("REPORT_PATH_OVERLAP");
  }
};

const pathSegments = (absolutePath: string): readonly string[] => {
  const parsed = path.parse(absolutePath);
  const relative = absolutePath.slice(parsed.root.length);
  return [parsed.root, ...relative.split(path.sep).filter(Boolean)];
};

const assertExistingDirectoryChainSafe = async (
  candidatePath: string,
): Promise<void> => {
  const segments = pathSegments(path.resolve(candidatePath));
  let cursor = segments[0];
  if (cursor === undefined) {
    throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
  }

  for (const segment of segments.slice(1)) {
    cursor = path.join(cursor, segment);
    let stats: Stats;
    try {
      stats = await lstat(cursor);
    } catch (error) {
      if (errorCodeOf(error) === "ENOENT") {
        return;
      }
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new GenerationFileError("GENERATED_PATH_LINK_FORBIDDEN");
    }
    if (!stats.isDirectory()) {
      throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
    }
  }
};

export const ensureGeneratedRoot = async (
  generatedRoot: string,
): Promise<string> => {
  const absoluteRoot = path.resolve(generatedRoot);
  await assertExistingDirectoryChainSafe(absoluteRoot);
  await mkdir(absoluteRoot, { recursive: true });
  await assertExistingDirectoryChainSafe(absoluteRoot);
  const stats = await lstat(absoluteRoot);
  if (stats.isSymbolicLink()) {
    throw new GenerationFileError("GENERATED_PATH_LINK_FORBIDDEN");
  }
  if (!stats.isDirectory()) {
    throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
  }
  return realpath(absoluteRoot);
};

const ensureOwnedDirectory = async (
  directory: string,
  generatedRoot: string,
): Promise<void> => {
  if (!isInsideOrEqual(generatedRoot, directory)) {
    throw new GenerationFileError("GENERATED_PATH_OUTSIDE_ROOT");
  }
  await assertExistingDirectoryChainSafe(directory);
  await mkdir(directory, { recursive: true });
  await assertExistingDirectoryChainSafe(directory);
};

export interface OwnedStage {
  readonly generatedRoot: string;
  readonly path: string;
  readonly releasePath: string;
  readonly releasesPath: string;
  readonly token: string;
  readonly identity: FileIdentity;
  readonly releaseIdentity: FileIdentity;
  readonly releasesIdentity: FileIdentity;
  readonly ownedDirectories: Map<string, FileIdentity>;
  readonly ownedFiles: Map<string, FileIdentity>;
  releasePromoted: boolean;
}

export const createOwnedStage = async (
  generatedRoot: string,
): Promise<OwnedStage> => {
  const safeRoot = await ensureGeneratedRoot(generatedRoot);
  const stagingRoot = path.join(safeRoot, ".staging");
  const releasesRoot = path.join(safeRoot, "releases");
  await ensureOwnedDirectory(stagingRoot, safeRoot);
  await ensureOwnedDirectory(releasesRoot, safeRoot);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const token = randomBytes(16).toString("hex");
    const stagePath = path.join(stagingRoot, token);
    try {
      await mkdir(stagePath, { recursive: false });
      const stats = await lstat(stagePath);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
      }
      const marker = path.join(stagePath, ".owned-stage");
      const markerIdentity = await writeNewFile(marker, Buffer.from(token, "utf8"));
      const releasePath = path.join(stagePath, "release");
      await mkdir(releasePath, { recursive: false });
      const releaseStats = await lstat(releasePath);
      const releasesStats = await lstat(releasesRoot);
      const ownedDirectories = new Map<string, FileIdentity>([
        [path.resolve(stagePath), identityOf(stats)],
        [path.resolve(releasePath), identityOf(releaseStats)],
      ]);
      const ownedFiles = new Map<string, FileIdentity>([
        [path.resolve(marker), markerIdentity],
      ]);
      return {
        generatedRoot: safeRoot,
        path: stagePath,
        releasePath,
        releasesPath: releasesRoot,
        token,
        identity: identityOf(stats),
        releaseIdentity: identityOf(releaseStats),
        releasesIdentity: identityOf(releasesStats),
        ownedDirectories,
        ownedFiles,
        releasePromoted: false,
      };
    } catch (error) {
      if (errorCodeOf(error) !== "EEXIST") {
        throw error;
      }
    }
  }
  throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
};

const assertOwnedDirectoryIdentity = async (
  directory: string,
  identity: FileIdentity,
  containmentRoot: string,
): Promise<void> => {
  const stats = await lstat(directory);
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    !sameIdentity(identity, stats)
  ) {
    throw new GenerationFileError("GENERATED_PATH_LINK_FORBIDDEN");
  }
  const resolved = await realpath(directory);
  if (!isInsideOrEqual(containmentRoot, resolved)) {
    throw new GenerationFileError("GENERATED_PATH_OUTSIDE_ROOT");
  }
};

interface DirectoryRecord {
  readonly path: string;
  readonly identity: FileIdentity;
}

const assertDirectoryRecords = async (
  records: readonly DirectoryRecord[],
  containmentRoot: string,
): Promise<void> => {
  for (const record of records) {
    await assertOwnedDirectoryIdentity(
      record.path,
      record.identity,
      containmentRoot,
    );
  }
};

const ensureOwnedStageDirectoryChain = async (
  stage: OwnedStage,
  relativeDirectory: string,
): Promise<readonly DirectoryRecord[]> => {
  const records: DirectoryRecord[] = [
    { path: stage.releasePath, identity: stage.releaseIdentity },
  ];
  await assertDirectoryRecords(records, stage.releasePath);
  let cursor = stage.releasePath;
  for (const segment of relativeDirectory.split("/").filter(Boolean)) {
    if (segment === "." || segment === ".." || segment.includes("\\")) {
      throw new GenerationFileError("GENERATED_PATH_OUTSIDE_ROOT");
    }
    cursor = path.join(cursor, segment);
    const resolvedCursor = path.resolve(cursor);
    const recordedIdentity = stage.ownedDirectories.get(resolvedCursor);
    let created = false;
    try {
      await mkdir(cursor, { recursive: false });
      created = true;
    } catch (error) {
      if (errorCodeOf(error) !== "EEXIST") {
        throw error;
      }
    }
    const stats = await lstat(cursor);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new GenerationFileError("GENERATED_PATH_LINK_FORBIDDEN");
    }
    if (!created && recordedIdentity === undefined) {
      throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
    }
    const identity = recordedIdentity ?? identityOf(stats);
    if (!sameIdentity(identity, stats)) {
      throw new GenerationFileError("GENERATED_PATH_LINK_FORBIDDEN");
    }
    stage.ownedDirectories.set(resolvedCursor, identity);
    records.push({ path: cursor, identity });
  }
  await assertDirectoryRecords(records, stage.releasePath);
  return records;
};

export const writeOwnedStageFile = async (
  stage: OwnedStage,
  relativePath: string,
  bytes: Uint8Array,
): Promise<Buffer> => {
  const portableSegments = relativePath.split("/");
  const filename = portableSegments.pop();
  if (
    filename === undefined ||
    filename === "" ||
    filename === "." ||
    filename === ".." ||
    filename.includes("\\")
  ) {
    throw new GenerationFileError("GENERATED_PATH_OUTSIDE_ROOT");
  }
  const records = await ensureOwnedStageDirectoryChain(
    stage,
    portableSegments.join("/"),
  );
  await assertDirectoryRecords(records, stage.releasePath);
  const outputPath = path.join(records.at(-1)?.path ?? stage.releasePath, filename);
  if (stage.ownedFiles.has(path.resolve(outputPath))) {
    throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
  }
  const outputIdentity = await writeNewFile(outputPath, bytes);
  stage.ownedFiles.set(path.resolve(outputPath), outputIdentity);
  await assertDirectoryRecords(records, stage.releasePath);
  const outputStats = await lstat(outputPath);
  if (
    outputStats.isSymbolicLink() ||
    !outputStats.isFile() ||
    !sameIdentity(outputIdentity, outputStats)
  ) {
    throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
  }
  const reopened = await readStableRegularFile(outputPath);
  await assertDirectoryRecords(records, stage.releasePath);
  return reopened;
};

export const assertStageReleaseOwned = async (
  stage: OwnedStage,
): Promise<void> => {
  if (stage.releasePromoted) {
    throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
  }
  await assertOwnedDirectoryIdentity(
    stage.releasePath,
    stage.releaseIdentity,
    stage.path,
  );
};

export const assertStagePromotionParent = async (
  stage: OwnedStage,
): Promise<void> =>
  assertOwnedDirectoryIdentity(
    stage.releasesPath,
    stage.releasesIdentity,
    stage.generatedRoot,
  );

export const markStageReleasePromoted = (stage: OwnedStage): void => {
  stage.releasePromoted = true;
};

const noFollowWriteFlags = (): number => {
  const noFollow = Reflect.get(constants, "O_NOFOLLOW") as unknown;
  return (
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_EXCL |
    (typeof noFollow === "number" ? noFollow : 0)
  );
};

const noFollowReadFlags = (): string | number => {
  const noFollow = Reflect.get(constants, "O_NOFOLLOW") as unknown;
  return typeof noFollow === "number" ? constants.O_RDONLY | noFollow : "r";
};

export const writeNewFile = async (
  filePath: string,
  bytes: Uint8Array,
): Promise<FileIdentity> => {
  const handle = await open(filePath, noFollowWriteFlags(), 0o600);
  let identity: FileIdentity | undefined;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
    }
    identity = identityOf(stats);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (identity === undefined) {
    throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
  }
  const pathStats = await lstat(filePath);
  if (
    pathStats.isSymbolicLink() ||
    !pathStats.isFile() ||
    !sameIdentity(identity, pathStats)
  ) {
    throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
  }
  return identity;
};

export const readStableRegularFile = async (
  filePath: string,
  maximumBytes = Number.MAX_SAFE_INTEGER,
): Promise<Buffer> => {
  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, noFollowReadFlags());
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
    }
    if (before.size > maximumBytes) {
      throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
    }
    const bytes = await handle.readFile();
    const [after, pathStats] = await Promise.all([handle.stat(), lstat(filePath)]);
    if (
      pathStats.isSymbolicLink() ||
      !pathStats.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.dev !== pathStats.dev ||
      before.ino !== pathStats.ino ||
      before.size !== after.size ||
      before.size !== bytes.byteLength
    ) {
      throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
    }
    return bytes;
  } finally {
    await handle?.close();
  }
};

const verifyOwnedStage = async (stage: OwnedStage): Promise<void> => {
  const stats = await lstat(stage.path);
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    !sameIdentity(stage.identity, stats)
  ) {
    throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
  }
  const markerPath = path.join(stage.path, ".owned-stage");
  const markerStats = await lstat(markerPath);
  const markerIdentity = stage.ownedFiles.get(path.resolve(markerPath));
  if (
    markerIdentity === undefined ||
    markerStats.isSymbolicLink() ||
    !markerStats.isFile() ||
    !sameIdentity(markerIdentity, markerStats)
  ) {
    throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
  }
  const marker = await readStableRegularFile(markerPath);
  if (marker.toString("utf8") !== stage.token) {
    throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
  }
  const resolved = await realpath(stage.path);
  if (!isInsideOrEqual(path.join(stage.generatedRoot, ".staging"), resolved)) {
    throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
  }
  const releaseStats = await lstat(stage.releasePath).catch((error: unknown) => {
    if (errorCodeOf(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (stage.releasePromoted) {
    if (releaseStats !== undefined) {
      throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
    }
  } else if (
    releaseStats === undefined ||
    releaseStats.isSymbolicLink() ||
    !releaseStats.isDirectory() ||
    !sameIdentity(stage.releaseIdentity, releaseStats)
  ) {
    throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
  }
};

interface OwnedTreeRecords {
  readonly directories: ReadonlyMap<string, FileIdentity>;
  readonly files: ReadonlyMap<string, FileIdentity>;
}

const currentOwnedTreeRecords = (stage: OwnedStage): OwnedTreeRecords => {
  const keepPath = (candidate: string): boolean =>
    !stage.releasePromoted || !isInsideOrEqual(stage.releasePath, candidate);
  return {
    directories: new Map(
      [...stage.ownedDirectories.entries()].filter(([candidate]) =>
        keepPath(candidate),
      ),
    ),
    files: new Map(
      [...stage.ownedFiles.entries()].filter(([candidate]) => keepPath(candidate)),
    ),
  };
};

const assertOwnedTree = async (
  directory: string,
  containmentRoot: string,
  records: OwnedTreeRecords,
  seenDirectories: Set<string>,
  seenFiles: Set<string>,
): Promise<void> => {
  const resolvedDirectoryPath = path.resolve(directory);
  const expectedDirectory = records.directories.get(resolvedDirectoryPath);
  const directoryStats = await lstat(directory);
  if (
    expectedDirectory === undefined ||
    directoryStats.isSymbolicLink() ||
    !directoryStats.isDirectory() ||
    !sameIdentity(expectedDirectory, directoryStats)
  ) {
    throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
  }
  seenDirectories.add(resolvedDirectoryPath);
  const directoryReal = await realpath(directory);
  if (!isInsideOrEqual(containmentRoot, directoryReal)) {
    throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareCodePoint(left.name, right.name));
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const resolvedEntryPath = path.resolve(entryPath);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
    }
    if (stats.isDirectory()) {
      await assertOwnedTree(
        entryPath,
        containmentRoot,
        records,
        seenDirectories,
        seenFiles,
      );
    } else if (stats.isFile()) {
      const expectedFile = records.files.get(resolvedEntryPath);
      if (expectedFile === undefined || !sameIdentity(expectedFile, stats)) {
        throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
      }
      seenFiles.add(resolvedEntryPath);
    } else {
      throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
    }
  }
};

export const assertOwnedStageForPromotion = async (
  stage: OwnedStage,
): Promise<void> => {
  try {
    if (stage.releasePromoted) {
      throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
    }
    await verifyOwnedStage(stage);
    const records = currentOwnedTreeRecords(stage);
    const seenDirectories = new Set<string>();
    const seenFiles = new Set<string>();
    await assertOwnedTree(
      stage.path,
      path.join(stage.generatedRoot, ".staging"),
      records,
      seenDirectories,
      seenFiles,
    );
    if (
      seenDirectories.size !== records.directories.size ||
      seenFiles.size !== records.files.size
    ) {
      throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
    }
  } catch (error) {
    if (
      error instanceof GenerationFileError &&
      error.code !== "GENERATION_STAGE_CLEANUP_REFUSED"
    ) {
      throw error;
    }
    throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
  }
};

const removeOwnedTree = async (
  directory: string,
  containmentRoot: string,
  records: OwnedTreeRecords,
): Promise<void> => {
  const resolvedDirectoryPath = path.resolve(directory);
  const expectedDirectory = records.directories.get(resolvedDirectoryPath);
  const directoryStats = await lstat(directory);
  if (
    expectedDirectory === undefined ||
    directoryStats.isSymbolicLink() ||
    !directoryStats.isDirectory() ||
    !sameIdentity(expectedDirectory, directoryStats)
  ) {
    throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
  }
  const directoryReal = await realpath(directory);
  if (!isInsideOrEqual(containmentRoot, directoryReal)) {
    throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareCodePoint(left.name, right.name));
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const resolvedEntryPath = path.resolve(entryPath);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
    }
    if (stats.isDirectory()) {
      await removeOwnedTree(entryPath, containmentRoot, records);
    } else if (stats.isFile()) {
      const expectedFile = records.files.get(resolvedEntryPath);
      if (expectedFile === undefined || !sameIdentity(expectedFile, stats)) {
        throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
      }
      await unlink(entryPath);
    } else {
      throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
    }
  }
  const beforeRemove = await lstat(directory);
  if (
    beforeRemove.isSymbolicLink() ||
    !beforeRemove.isDirectory() ||
    expectedDirectory === undefined ||
    !sameIdentity(expectedDirectory, beforeRemove)
  ) {
    throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
  }
  await rmdir(directory);
};

export const cleanupOwnedStage = async (stage: OwnedStage): Promise<void> => {
  try {
    await verifyOwnedStage(stage);
    const records = currentOwnedTreeRecords(stage);
    const seenDirectories = new Set<string>();
    const seenFiles = new Set<string>();
    const containmentRoot = path.join(stage.generatedRoot, ".staging");
    await assertOwnedTree(
      stage.path,
      containmentRoot,
      records,
      seenDirectories,
      seenFiles,
    );
    if (
      seenDirectories.size !== records.directories.size ||
      seenFiles.size !== records.files.size
    ) {
      throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
    }
    await removeOwnedTree(stage.path, containmentRoot, records);
  } catch (error) {
    if (
      error instanceof GenerationFileError &&
      error.code === "GENERATION_STAGE_CLEANUP_REFUSED"
    ) {
      throw error;
    }
    throw new GenerationFileError("GENERATION_STAGE_CLEANUP_REFUSED");
  }
};

export interface PublicationLock {
  readonly token: string;
  readonly release: () => Promise<void>;
}

export interface PublicationLockHooks {
  readonly beforeReleaseQuarantine?: () => void | Promise<void>;
}

const quarantineAndRemoveOwnedLock = async (input: {
  readonly lockPath: string;
  readonly identity: FileIdentity;
  readonly token: string;
  readonly beforeQuarantine?: () => void | Promise<void>;
}): Promise<void> => {
  const assertCurrentLockOwned = async (): Promise<void> => {
    const stats = await lstat(input.lockPath);
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      !sameIdentity(input.identity, stats)
    ) {
      throw new GenerationFileError("GENERATION_LOCK_RELEASE_REFUSED");
    }
  };
  await assertCurrentLockOwned();
  await input.beforeQuarantine?.();
  await assertCurrentLockOwned();
  const quarantinePath = path.join(
    path.dirname(input.lockPath),
    `.publication.lock.${input.token}.${randomBytes(16).toString("hex")}.release`,
  );
  await rename(input.lockPath, quarantinePath);
  const quarantineStats = await lstat(quarantinePath);
  if (
    quarantineStats.isSymbolicLink() ||
    !quarantineStats.isFile() ||
    !sameIdentity(input.identity, quarantineStats)
  ) {
    // The pathname was replaced during release. Preserve what was moved; never
    // unlink a file whose identity this run cannot prove it owns.
    throw new GenerationFileError("GENERATION_LOCK_RELEASE_REFUSED");
  }
  await unlink(quarantinePath);
};

export const acquirePublicationLock = async (
  generatedRoot: string,
  hooks?: PublicationLockHooks,
): Promise<PublicationLock> => {
  const safeRoot = await ensureGeneratedRoot(generatedRoot);
  const lockPath = path.join(safeRoot, ".publication.lock");
  const token = randomBytes(16).toString("hex");
  let handle: FileHandle;
  try {
    handle = await open(lockPath, noFollowWriteFlags(), 0o600);
  } catch {
    throw new GenerationFileError("GENERATION_LOCK_UNAVAILABLE");
  }
  let identity: FileIdentity | undefined;
  try {
    const lockStats = await handle.stat();
    if (!lockStats.isFile()) {
      throw new GenerationFileError("GENERATION_LOCK_RELEASE_REFUSED");
    }
    identity = identityOf(lockStats);
    await handle.writeFile(token, { encoding: "utf8" });
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    if (identity !== undefined) {
      await quarantineAndRemoveOwnedLock({ lockPath, identity, token }).catch(
        () => undefined,
      );
    }
    throw error instanceof GenerationFileError
      ? error
      : new GenerationFileError("GENERATION_LOCK_RELEASE_REFUSED");
  }
  if (identity === undefined) {
    await handle.close().catch(() => undefined);
    throw new GenerationFileError("GENERATION_LOCK_RELEASE_REFUSED");
  }
  const ownerIdentity = identity;
  let released = false;
  return {
    token,
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      try {
        const handleStats = await handle.stat();
        if (!sameIdentity(ownerIdentity, handleStats)) {
          throw new GenerationFileError("GENERATION_LOCK_RELEASE_REFUSED");
        }
        await quarantineAndRemoveOwnedLock({
          lockPath,
          identity: ownerIdentity,
          token,
          ...(hooks?.beforeReleaseQuarantine === undefined
            ? {}
            : { beforeQuarantine: hooks.beforeReleaseQuarantine }),
        });
        await handle.close();
      } catch (error) {
        await handle.close().catch(() => undefined);
        if (error instanceof GenerationFileError) {
          throw error;
        }
        throw new GenerationFileError("GENERATION_LOCK_RELEASE_REFUSED");
      }
    },
  };
};

export const hashBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const collectTreeHashes = async (
  root: string,
  directory: string,
  output: Map<string, string>,
): Promise<void> => {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new GenerationFileError("GENERATED_RELEASE_CONTENT_MISMATCH");
  }
  const resolved = await realpath(directory);
  if (!isInsideOrEqual(root, resolved)) {
    throw new GenerationFileError("GENERATED_RELEASE_CONTENT_MISMATCH");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareCodePoint(left.name, right.name));
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const entryStats = await lstat(entryPath);
    if (entryStats.isSymbolicLink()) {
      throw new GenerationFileError("GENERATED_RELEASE_CONTENT_MISMATCH");
    }
    if (entryStats.isDirectory()) {
      await collectTreeHashes(root, entryPath, output);
    } else if (entryStats.isFile()) {
      const relativePath = path.relative(root, entryPath).split(path.sep).join("/");
      output.set(relativePath, hashBytes(await readStableRegularFile(entryPath)));
    } else {
      throw new GenerationFileError("GENERATED_RELEASE_CONTENT_MISMATCH");
    }
  }
};

export const verifyExactReleaseTree = async (
  releaseRoot: string,
  expectedHashes: ReadonlyMap<string, string>,
): Promise<void> => {
  const rootStats = await lstat(releaseRoot).catch(() => undefined);
  if (
    rootStats === undefined ||
    rootStats.isSymbolicLink() ||
    !rootStats.isDirectory()
  ) {
    throw new GenerationFileError("GENERATED_RELEASE_CONTENT_MISMATCH");
  }
  const root = await realpath(releaseRoot);
  const actual = new Map<string, string>();
  try {
    await collectTreeHashes(root, root, actual);
  } catch {
    throw new GenerationFileError("GENERATED_RELEASE_CONTENT_MISMATCH");
  }
  const expectedEntries = [...expectedHashes.entries()].sort(([left], [right]) =>
    compareCodePoint(left, right),
  );
  const actualEntries = [...actual.entries()].sort(([left], [right]) =>
    compareCodePoint(left, right),
  );
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new GenerationFileError("GENERATED_RELEASE_CONTENT_MISMATCH");
  }
};

export const atomicallyReplaceRegularFile = async (
  generatedRoot: string,
  outputPath: string,
  bytes: Uint8Array,
): Promise<void> => {
  const root = await ensureGeneratedRoot(generatedRoot);
  const absoluteOutput = path.resolve(outputPath);
  const physicalOutput = await resolveFutureRealPath(absoluteOutput);
  if (!isInsideOrEqual(root, physicalOutput)) {
    throw new GenerationFileError("GENERATED_PATH_OUTSIDE_ROOT");
  }
  await atomicallyReplaceSafeRegularFile(absoluteOutput, bytes);
};

export interface AtomicWriteHooks {
  readonly beforeTemporaryWrite?: () => void | Promise<void>;
  readonly beforeRename?: () => void | Promise<void>;
}

export const atomicallyReplaceSafeRegularFile = async (
  outputPath: string,
  bytes: Uint8Array,
  hooks?: AtomicWriteHooks,
): Promise<void> => {
  const absoluteOutput = path.resolve(outputPath);
  const parentPath = path.dirname(absoluteOutput);
  await assertExistingDirectoryChainSafe(parentPath);
  await mkdir(parentPath, { recursive: true });
  await assertExistingDirectoryChainSafe(parentPath);
  const parentStats = await lstat(parentPath);
  if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
    throw new GenerationFileError("GENERATED_PATH_LINK_FORBIDDEN");
  }
  const parentIdentity = identityOf(parentStats);
  const parentRealPath = await realpath(parentPath);
  const assertParentStable = async (): Promise<void> => {
    await assertExistingDirectoryChainSafe(parentPath);
    await assertOwnedDirectoryIdentity(
      parentPath,
      parentIdentity,
      parentRealPath,
    );
  };
  await assertParentStable();
  const existing = await lstat(absoluteOutput).catch((error: unknown) => {
    if (errorCodeOf(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (
    existing !== undefined &&
    (existing.isSymbolicLink() || !existing.isFile())
  ) {
    throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
  }
  const temporaryPath = path.join(
    parentPath,
    `.${path.basename(absoluteOutput)}.${randomBytes(16).toString("hex")}.tmp`,
  );
  let temporaryIdentity: FileIdentity | undefined;
  try {
    await hooks?.beforeTemporaryWrite?.();
    await assertParentStable();
    temporaryIdentity = await writeNewFile(temporaryPath, bytes);
    await assertParentStable();
    await hooks?.beforeRename?.();
    await assertParentStable();
    const temporaryStats = await lstat(temporaryPath);
    if (
      temporaryStats.isSymbolicLink() ||
      !temporaryStats.isFile() ||
      !sameIdentity(temporaryIdentity, temporaryStats)
    ) {
      throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
    }
    await rename(temporaryPath, absoluteOutput);
    await assertParentStable();
    const outputStats = await lstat(absoluteOutput);
    if (
      outputStats.isSymbolicLink() ||
      !outputStats.isFile() ||
      !sameIdentity(temporaryIdentity, outputStats)
    ) {
      throw new GenerationFileError("GENERATED_PATH_TYPE_INVALID");
    }
  } catch (error) {
    if (temporaryIdentity !== undefined) {
      await assertParentStable()
        .then(async () => {
          const temporaryStats = await lstat(temporaryPath);
          if (
            !temporaryStats.isSymbolicLink() &&
            temporaryStats.isFile() &&
            sameIdentity(temporaryIdentity as FileIdentity, temporaryStats)
          ) {
            await unlink(temporaryPath);
          }
        })
        .catch(() => undefined);
    }
    throw error;
  }
};
