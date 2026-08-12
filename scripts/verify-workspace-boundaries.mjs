import { readFile, readdir } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import process from "node:process";

import ts from "typescript";

const workspaceRoot = process.cwd();

const packageRules = [
  {
    name: "@editorial-doll/studio",
    directory: "apps/studio",
    allowedInternal: new Set([
      "@editorial-doll/catalog",
      "@editorial-doll/design-system",
      "@editorial-doll/domain",
    ]),
    allowedExternal: new Set(["react", "react-dom"]),
    allowedDev: new Set([
      "@types/react",
      "@types/react-dom",
      "@vitejs/plugin-react",
      "vite",
    ]),
  },
  {
    name: "@editorial-doll/domain",
    directory: "packages/domain",
    allowedInternal: new Set(),
    allowedExternal: new Set(["zod"]),
    allowedDev: new Set(),
  },
  {
    name: "@editorial-doll/catalog",
    directory: "packages/catalog",
    allowedInternal: new Set(["@editorial-doll/domain"]),
    allowedExternal: new Set(),
    allowedDev: new Set(),
  },
  {
    name: "@editorial-doll/render-engine",
    directory: "packages/render-engine",
    allowedInternal: new Set(["@editorial-doll/domain"]),
    allowedExternal: new Set(["zod"]),
    allowedDev: new Set(),
  },
  {
    name: "@editorial-doll/persistence",
    directory: "packages/persistence",
    allowedInternal: new Set(["@editorial-doll/domain"]),
    allowedExternal: new Set(),
    allowedDev: new Set(),
  },
  {
    name: "@editorial-doll/design-system",
    directory: "packages/design-system",
    allowedInternal: new Set(),
    allowedExternal: new Set(),
    allowedDev: new Set(),
  },
  {
    name: "@editorial-doll/asset-pipeline",
    directory: "tools/asset-pipeline",
    allowedInternal: new Set(["@editorial-doll/domain"]),
    allowedExternal: new Set(["sharp", "zod"]),
    allowedDev: new Set(),
    allowNodeBuiltins: true,
  },
];

const ruleByName = new Map(packageRules.map((rule) => [rule.name, rule]));
const nodeBuiltins = new Set(
  builtinModules.flatMap((name) => [name, name.replace(/^node:/u, "")]),
);

const dependencyNameOf = (specifier) => {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? `${segments[0]}/${segments[1] ?? ""}`
    : (segments[0] ?? specifier);
};

const isWithin = (candidate, parent) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const violationForImport = (rule, filePath, specifier, sourceKind = "src") => {
  const packageRoot = path.resolve(workspaceRoot, rule.directory);
  const isTestFile = sourceKind !== "src";

  if (specifier.startsWith(".")) {
    const resolved = path.resolve(path.dirname(filePath), specifier);
    return isWithin(resolved, packageRoot)
      ? undefined
      : `cross-package relative import ${specifier}`;
  }

  if (specifier.startsWith("/") || path.isAbsolute(specifier)) {
    return `absolute import ${specifier}`;
  }

  const dependencyName = dependencyNameOf(specifier);
  if (nodeBuiltins.has(dependencyName) || specifier.startsWith("node:")) {
    return isTestFile || rule.allowNodeBuiltins === true
      ? undefined
      : `forbidden Node runtime import ${specifier}`;
  }
  if (isTestFile && dependencyName === "vitest") {
    return undefined;
  }
  if (sourceKind === "e2e" && dependencyName === "@playwright/test") {
    return undefined;
  }
  if (dependencyName.startsWith("@editorial-doll/")) {
    if (dependencyName === rule.name) {
      if (sourceKind === "src") {
        return `forbidden self-package import ${specifier}`;
      }
      const allowedSelfImports = new Set([
        rule.name,
        ...(rule.name === "@editorial-doll/render-engine"
          ? [`${rule.name}/browser`]
          : []),
      ]);
      return allowedSelfImports.has(specifier)
        ? undefined
        : `undeclared self-package subpath import ${specifier}`;
    }
    if (specifier !== dependencyName) {
      return `workspace subpath import ${specifier}`;
    }
    return rule.allowedInternal.has(dependencyName)
      ? undefined
      : `forbidden workspace import ${specifier}`;
  }

  return rule.allowedExternal.has(dependencyName)
    ? undefined
    : `undeclared or forbidden external import ${specifier}`;
};

const nonLiteralDynamicImport = Symbol("non-literal-dynamic-import");

const importSpecifiers = (source, filePath) => {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = [];

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0];
      if (
        node.arguments.length === 1 &&
        argument !== undefined &&
        (ts.isStringLiteral(argument) ||
          ts.isNoSubstitutionTemplateLiteral(argument))
      ) {
        specifiers.push(argument.text);
      } else {
        specifiers.push(nonLiteralDynamicImport);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
};

const importViolationsForSource = (rule, filePath, source, sourceKind) => {
  const sourceViolations = [];
  for (const specifier of importSpecifiers(source, filePath)) {
    if (specifier === nonLiteralDynamicImport) {
      if (sourceKind === "src") {
        sourceViolations.push("non-literal dynamic import");
      }
      continue;
    }

    const violation = violationForImport(rule, filePath, specifier, sourceKind);
    if (violation !== undefined) {
      sourceViolations.push(violation);
    }
  }
  return sourceViolations;
};

const collectSourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectSourceFiles(entryPath);
      }
      return entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)
        ? [entryPath]
        : [];
    }),
  );
  return nested.flat().sort();
};

const violations = [];

for (const rule of packageRules) {
  const packageRoot = path.resolve(workspaceRoot, rule.directory);
  const manifestPath = path.join(packageRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const productionDependencies = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  };

  for (const dependencyName of Object.keys(productionDependencies).sort()) {
    if (dependencyName.startsWith("@editorial-doll/")) {
      if (!ruleByName.has(dependencyName)) {
        violations.push(`${rule.name}: unknown workspace dependency ${dependencyName}`);
      } else if (!rule.allowedInternal.has(dependencyName)) {
        violations.push(`${rule.name}: forbidden workspace dependency ${dependencyName}`);
      }
    } else if (!rule.allowedExternal.has(dependencyName)) {
      violations.push(`${rule.name}: forbidden production dependency ${dependencyName}`);
    }
  }

  for (const dependencyName of Object.keys(manifest.devDependencies ?? {}).sort()) {
    if (dependencyName.startsWith("@editorial-doll/")) {
      if (!ruleByName.has(dependencyName)) {
        violations.push(
          `${rule.name}: unknown workspace development dependency ${dependencyName}`,
        );
      } else if (!rule.allowedInternal.has(dependencyName)) {
        violations.push(
          `${rule.name}: forbidden workspace development dependency ${dependencyName}`,
        );
      }
    } else if (!rule.allowedDev.has(dependencyName)) {
      violations.push(
        `${rule.name}: forbidden development dependency ${dependencyName}`,
      );
    }
  }

  for (const directoryName of ["src", "test", "e2e"]) {
    const sourceRoot = path.join(packageRoot, directoryName);
    let sourceFiles = [];
    try {
      sourceFiles = await collectSourceFiles(sourceRoot);
    } catch (error) {
      if (!(error instanceof Error) || !Reflect.has(error, "code") || error.code !== "ENOENT") {
        throw error;
      }
    }

    for (const filePath of sourceFiles) {
      const source = await readFile(filePath, "utf8");
      for (const violation of importViolationsForSource(
        rule,
        filePath,
        source,
        directoryName,
      )) {
        violations.push(
          `${path.relative(workspaceRoot, filePath)}: ${violation}`,
        );
      }
    }
  }
}

const domainRule = ruleByName.get("@editorial-doll/domain");
if (domainRule === undefined) {
  throw new Error("Domain boundary rule is missing.");
}

const probePath = path.resolve(workspaceRoot, "packages/domain/src/probe.ts");
const negativeProbes = [
  "../../catalog/src/index.js",
  "@editorial-doll/catalog",
  "@editorial-doll/domain/internal",
  "fs",
  "node:fs/promises",
];
for (const specifier of negativeProbes) {
  if (violationForImport(domainRule, probePath, specifier) === undefined) {
    violations.push(`boundary verifier self-test accepted ${specifier}`);
  }
}

const testProbePath = path.resolve(
  workspaceRoot,
  "packages/domain/test/probe.test.ts",
);
if (
  violationForImport(
    domainRule,
    testProbePath,
    "../../catalog/src/index.js",
    "test",
  ) === undefined
) {
  violations.push("boundary verifier test-folder self-test accepted catalog source");
}
if (violationForImport(domainRule, testProbePath, "vitest", "test") !== undefined) {
  violations.push("boundary verifier test-folder self-test rejected Vitest");
}

const renderEngineRule = ruleByName.get("@editorial-doll/render-engine");
if (renderEngineRule === undefined) {
  throw new Error("Render-engine boundary rule is missing.");
}

const renderEngineProbePath = path.resolve(
  workspaceRoot,
  "packages/render-engine/src/probe.ts",
);
for (const specifier of [
  "@editorial-doll/catalog",
  "@editorial-doll/asset-pipeline",
  "sharp",
  "react",
  "node:fs/promises",
]) {
  if (violationForImport(renderEngineRule, renderEngineProbePath, specifier) === undefined) {
    violations.push(`render-engine boundary verifier self-test accepted ${specifier}`);
  }
}

const renderEngineE2eProbePath = path.resolve(
  workspaceRoot,
  "packages/render-engine/e2e/probe.spec.ts",
);
if (
  violationForImport(
    renderEngineRule,
    renderEngineE2eProbePath,
    "@playwright/test",
    "e2e",
  ) !== undefined
) {
  violations.push("boundary verifier e2e self-test rejected Playwright");
}
for (const publicSpecifier of [
  "@editorial-doll/render-engine",
  "@editorial-doll/render-engine/browser",
]) {
  if (
    violationForImport(
      renderEngineRule,
      renderEngineE2eProbePath,
      publicSpecifier,
      "e2e",
    ) !== undefined
  ) {
    violations.push(
      `boundary verifier e2e self-test rejected public import ${publicSpecifier}`,
    );
  }
}
if (
  violationForImport(
    renderEngineRule,
    renderEngineProbePath,
    "@editorial-doll/render-engine/browser",
    "src",
  ) === undefined
) {
  violations.push(
    "boundary verifier self-test accepted a production self-package import",
  );
}

const computedImportProbe =
  'const packageName = "@editorial-doll/catalog"; void import(packageName);';
if (
  !importViolationsForSource(
    renderEngineRule,
    renderEngineProbePath,
    computedImportProbe,
    "src",
  ).includes("non-literal dynamic import")
) {
  violations.push(
    "boundary verifier self-test accepted a production non-literal dynamic import",
  );
}

const computedTemplateImportProbe =
  'const moduleName = "catalog"; void import(`@editorial-doll/${moduleName}`);';
if (
  !importViolationsForSource(
    renderEngineRule,
    renderEngineProbePath,
    computedTemplateImportProbe,
    "src",
  ).includes("non-literal dynamic import")
) {
  violations.push(
    "boundary verifier self-test accepted a production computed template import",
  );
}

const staticDynamicImportViolations = importViolationsForSource(
  renderEngineRule,
  renderEngineProbePath,
  'void import("@editorial-doll/catalog");',
  "src",
);
if (
  staticDynamicImportViolations.includes("non-literal dynamic import") ||
  !staticDynamicImportViolations.includes(
    "forbidden workspace import @editorial-doll/catalog",
  )
) {
  violations.push(
    "boundary verifier dynamic-import self-test did not preserve literal import checks",
  );
}

for (const [sourceKind, probePathForKind] of [
  ["test", testProbePath],
  ["e2e", renderEngineE2eProbePath],
  ["config", path.resolve(workspaceRoot, "playwright.render.config.ts")],
]) {
  if (
    importViolationsForSource(
      renderEngineRule,
      probePathForKind,
      computedImportProbe,
      sourceKind,
    ).includes("non-literal dynamic import")
  ) {
    violations.push(
      `boundary verifier non-literal import self-test rejected ${sourceKind} tooling`,
    );
  }
}

if (violations.length > 0) {
  console.error("Workspace boundary violations found:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log("Workspace boundary verification passed.");
}
