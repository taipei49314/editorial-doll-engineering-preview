#!/usr/bin/env node

import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  GenerationError,
  generateAssetRelease,
  generatorFingerprint,
} from "./generation.js";
import {
  GenerationFileError,
  assertGenerationPathsSeparated,
  atomicallyReplaceSafeRegularFile,
  isInsideOrEqual,
  resolveFutureRealPath,
} from "./generation-fs.js";
import {
  REPORT_SCHEMA_VERSION,
  canonicalJson,
  type ValidationReport,
} from "./report.js";
import { inspectManifest, validateSourceTree } from "./validation.js";

const HELP = `editorial-asset — validate Editorial Doll source assets

Usage:
  editorial-asset doctor --input <source-root> [--json]
  editorial-asset inspect <manifest> [--json]
  editorial-asset validate --input <source-root> [--report <file>] [--json]
  editorial-asset generate --input <source-root> --output <generated-root> [--report <file>] [--json]
  editorial-asset --help

Commands:
  doctor    Verify the local runtime and readable source root.
  inspect   Validate one asset envelope and its declared PNG parts.
  validate  Validate a source tree and optionally write a canonical report.
  generate  Validate and publish an immutable generated-asset release.

Options:
  --input <path>   Source root for doctor, validate, or generate.
  --output <path>  Generated root for generate; never implicit.
  --report <path>  Atomically write the canonical validation report.
  --json           Emit one machine-readable JSON value to stdout.
  -h, --help       Show this help.
`;

export interface CliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

class CliError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode: 1 | 2 = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

type ParsedArguments =
  | {
      readonly command: "doctor";
      readonly json: boolean;
      readonly input: string;
    }
  | {
      readonly command: "inspect";
      readonly json: boolean;
      readonly manifest: string;
    }
  | {
      readonly command: "validate";
      readonly json: boolean;
      readonly input: string;
      readonly report?: string;
    }
  | {
      readonly command: "generate";
      readonly json: boolean;
      readonly input: string;
      readonly output: string;
      readonly report?: string;
    };

const readOption = (
  arguments_: readonly string[],
  index: number,
  option: string,
): string => {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new CliError("CLI_OPTION_VALUE_MISSING", `${option} requires a value.`);
  }
  return value;
};

const parseArguments = (arguments_: readonly string[]): ParsedArguments => {
  const json = arguments_.includes("--json");
  const filtered = arguments_.filter((argument) => argument !== "--json");
  const command = filtered[0];

  if (
    command !== "doctor" &&
    command !== "inspect" &&
    command !== "validate" &&
    command !== "generate"
  ) {
    throw new CliError(
      "CLI_COMMAND_INVALID",
      "Choose doctor, inspect, validate, or generate.",
    );
  }

  let input: string | undefined;
  let output: string | undefined;
  let report: string | undefined;
  const positional: string[] = [];

  for (let index = 1; index < filtered.length; index += 1) {
    const argument = filtered[index];
    if (argument === "--input") {
      if (input !== undefined) {
        throw new CliError("CLI_OPTION_DUPLICATE", "--input may appear only once.");
      }
      input = readOption(filtered, index, "--input");
      index += 1;
    } else if (argument === "--output") {
      if (output !== undefined) {
        throw new CliError("CLI_OPTION_DUPLICATE", "--output may appear only once.");
      }
      output = readOption(filtered, index, "--output");
      index += 1;
    } else if (argument === "--report") {
      if (report !== undefined) {
        throw new CliError("CLI_OPTION_DUPLICATE", "--report may appear only once.");
      }
      report = readOption(filtered, index, "--report");
      index += 1;
    } else if (argument?.startsWith("-")) {
      throw new CliError("CLI_OPTION_UNKNOWN", `Unknown option: ${argument}.`);
    } else if (argument !== undefined) {
      positional.push(argument);
    }
  }

  if (command === "inspect") {
    if (
      input !== undefined ||
      output !== undefined ||
      report !== undefined ||
      positional.length !== 1
    ) {
      throw new CliError(
        "CLI_ARGUMENT_INVALID",
        "inspect requires exactly one manifest and no --input/--report option.",
      );
    }
    const manifest = positional[0];
    if (manifest === undefined) {
      throw new CliError("CLI_ARGUMENT_INVALID", "inspect requires a manifest.");
    }
    return { command, json, manifest };
  }

  if (positional.length > 0 || input === undefined) {
    throw new CliError(
      "CLI_ARGUMENT_INVALID",
      `${command} requires --input and accepts no positional paths.`,
    );
  }
  if (command === "doctor" && (report !== undefined || output !== undefined)) {
    throw new CliError(
      "CLI_ARGUMENT_INVALID",
      "doctor does not accept --report or --output.",
    );
  }

  if (command === "doctor") {
    return { command, json, input };
  }
  if (command === "validate" && output !== undefined) {
    throw new CliError("CLI_ARGUMENT_INVALID", "validate does not accept --output.");
  }
  if (command === "generate") {
    if (output === undefined) {
      throw new CliError(
        "CLI_ARGUMENT_INVALID",
        "generate requires explicit --input and --output paths.",
      );
    }
    return report === undefined
      ? { command, json, input, output }
      : { command, json, input, output, report };
  }
  return report === undefined
    ? { command, json, input }
    : { command, json, input, report };
};

const versionAtLeast = (
  actual: readonly number[],
  minimum: readonly number[],
): boolean => {
  for (let index = 0; index < minimum.length; index += 1) {
    const difference = (actual[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return true;
};

const doctor = async (inputPath: string): Promise<unknown> => {
  const version = process.versions.node.split(".").map(Number);
  const nodeOk =
    version[0] === 24 && versionAtLeast(version, [24, 14, 0]);
  const sourceRootOk = await stat(inputPath)
    .then((sourceStats) => sourceStats.isDirectory())
    .catch(() => false);
  const generator = generatorFingerprint();
  const sharpOk = generator.sharp === "0.35.3";
  const libvipsOk = generator.libvips !== "unknown";

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    command: "doctor",
    ok: nodeOk && sourceRootOk && sharpOk && libvipsOk,
    checks: [
      { code: "NODE_VERSION", ok: nodeOk, value: process.versions.node },
      { code: "SOURCE_ROOT_READABLE", ok: sourceRootOk },
      { code: "SHARP_VERSION", ok: sharpOk, value: generator.sharp },
      { code: "LIBVIPS_VERSION", ok: libvipsOk, value: generator.libvips },
    ],
  };
};

const reportHuman = (report: ValidationReport): string =>
  report.ok
    ? `PASS: ${report.summary.assets} assets and ${report.summary.parts} parts validated.\n`
    : `FAIL: ${report.summary.errors} validation errors.\n`;

const emitError = (error: CliError, io: CliIo, json: boolean): void => {
  if (json) {
    io.stdout(
      canonicalJson({
        schemaVersion: REPORT_SCHEMA_VERSION,
        ok: false,
        error: { code: error.code, message: error.message },
      }),
    );
  } else {
    io.stderr(`${error.code}: ${error.message}\n`);
  }
};

export const runCli = async (
  arguments_: readonly string[],
  io: CliIo,
  currentDirectory: string,
): Promise<number> => {
  const normalizedArguments =
    arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const wantsJson = normalizedArguments.includes("--json");
  if (
    normalizedArguments.length === 0 ||
    normalizedArguments.includes("--help") ||
    normalizedArguments.includes("-h")
  ) {
    io.stdout(HELP);
    return 0;
  }

  try {
    const parsed = parseArguments(normalizedArguments);
    if (parsed.command === "doctor") {
      const result = await doctor(path.resolve(currentDirectory, parsed.input));
      const ok = Reflect.get(result as object, "ok") === true;
      io.stdout(
        parsed.json
          ? canonicalJson(result)
          : ok
            ? "Editorial asset pipeline ready.\n"
            : "Editorial asset pipeline is not ready.\n",
      );
      return ok ? 0 : 2;
    }

    if (parsed.command === "validate" && parsed.report !== undefined) {
      const inputPath = path.resolve(currentDirectory, parsed.input);
      const reportPath = path.resolve(currentDirectory, parsed.report);
      const [inputRealPath, reportRealPath] = await Promise.all([
        realpath(inputPath).catch(() => inputPath),
        resolveFutureRealPath(reportPath),
      ]);
      if (
        isInsideOrEqual(inputPath, reportPath) ||
        isInsideOrEqual(inputRealPath, reportRealPath)
      ) {
        throw new CliError(
          "REPORT_PATH_INSIDE_SOURCE_ROOT",
          "The report path must remain outside the source tree.",
        );
      }
    }

    if (parsed.command === "generate") {
      const inputPath = path.resolve(currentDirectory, parsed.input);
      const outputPath = path.resolve(currentDirectory, parsed.output);
      const reportPath =
        parsed.report === undefined
          ? undefined
          : path.resolve(currentDirectory, parsed.report);
      try {
        await assertGenerationPathsSeparated(inputPath, outputPath, reportPath);
      } catch (error) {
        const code =
          error instanceof GenerationFileError
            ? error.code
            : "GENERATION_PATH_INVALID";
        throw new CliError(
          code,
          "The source, generated, and report paths do not satisfy the containment contract.",
        );
      }
      const report = await validateSourceTree(inputPath);
      if (reportPath !== undefined) {
        await atomicallyReplaceSafeRegularFile(
          reportPath,
          Buffer.from(canonicalJson(report)),
        );
      }
      if (!report.ok) {
        io.stdout(parsed.json ? canonicalJson(report) : reportHuman(report));
        return 2;
      }
      try {
        const result = await generateAssetRelease({
          sourceRoot: inputPath,
          generatedRoot: outputPath,
          report,
        });
        io.stdout(
          parsed.json
            ? result.catalogBytes.toString("utf8")
            : `PASS: generated release ${result.catalog.releaseId}.\n`,
        );
        return 0;
      } catch (error) {
        if (error instanceof GenerationError) {
          throw new CliError(
            error.code,
            "The generated release did not satisfy the publication contract.",
            error.exitCode,
          );
        }
        if (error instanceof GenerationFileError) {
          throw new CliError(
            error.code,
            "The generated filesystem did not satisfy the publication contract.",
          );
        }
        throw error;
      }
    }

    const report =
      parsed.command === "inspect"
        ? await inspectManifest(path.resolve(currentDirectory, parsed.manifest))
        : await validateSourceTree(path.resolve(currentDirectory, parsed.input));

    if (parsed.command === "validate" && parsed.report !== undefined) {
      await atomicallyReplaceSafeRegularFile(
        path.resolve(currentDirectory, parsed.report),
        Buffer.from(canonicalJson(report)),
      );
    }
    io.stdout(parsed.json ? canonicalJson(report) : reportHuman(report));
    return report.ok ? 0 : 2;
  } catch (error) {
    const cliError =
      error instanceof CliError
        ? error
        : error instanceof GenerationFileError
          ? new CliError(
              error.code,
              "The requested output path did not satisfy the no-link file contract.",
            )
        : new CliError(
            "INTERNAL_ERROR",
            "The asset pipeline could not complete the command.",
          );
    emitError(cliError, io, wantsJson);
    return cliError.exitCode;
  }
};

const mainModulePath = process.argv[1];
if (
  mainModulePath !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(mainModulePath)
) {
  const exitCode = await runCli(
    process.argv.slice(2),
    {
      stdout: (value) => process.stdout.write(value),
      stderr: (value) => process.stderr.write(value),
    },
    process.env["INIT_CWD"] ?? process.cwd(),
  );
  process.exitCode = exitCode;
}
