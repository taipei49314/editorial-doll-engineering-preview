import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const workspacePackages = [
  "@editorial-doll/catalog",
  "@editorial-doll/design-system",
  "@editorial-doll/domain",
  "@editorial-doll/persistence",
  "@editorial-doll/render-engine",
  "@editorial-doll/studio",
  "@editorial-doll/asset-pipeline",
];

const crossPackageRelativeImports = {
  group: [
    "../**",
    "@editorial-doll/*/*",
    "**/apps/**",
    "**/packages/**",
    "**/tools/**",
  ],
  message: "Import another workspace only through its public package export.",
};

const restrictedPackages = (allowed = []) =>
  workspacePackages
    .filter((name) => !allowed.includes(name))
    .map((name) => ({
      name,
      message: `The package boundary does not allow importing ${name}.`,
    }));

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
  {
    files: ["apps/studio/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "error",
        { allowConstantExport: true },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: restrictedPackages([
            "@editorial-doll/catalog",
            "@editorial-doll/design-system",
            "@editorial-doll/domain",
          ]),
          patterns: [crossPackageRelativeImports],
        },
      ],
    },
  },
  {
    files: ["packages/domain/src/**/*.ts"],
    languageOptions: {
      globals: {},
    },
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "crypto",
        "fetch",
        "WebSocket",
        "XMLHttpRequest",
        "process",
        "Buffer",
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...restrictedPackages(),
            { name: "react", message: "Domain code must remain framework-free." },
            {
              name: "react-dom",
              message: "Domain code must remain framework-free.",
            },
            { name: "zustand", message: "Domain code owns no UI state store." },
            { name: "dexie", message: "Domain code owns no persistence." },
          ],
          patterns: [
            crossPackageRelativeImports,
            {
              group: ["node:*"],
              message: "Domain code must not depend on Node runtime APIs.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Pass time in explicitly." },
        {
          object: "Math",
          property: "random",
          message: "Domain output must be deterministic.",
        },
        {
          object: "crypto",
          property: "randomUUID",
          message: "Pass identity in explicitly.",
        },
        {
          object: "performance",
          property: "now",
          message: "Pass time in explicitly.",
        },
        {
          object: "globalThis",
          property: "window",
          message: "Domain code must not use browser APIs.",
        },
        {
          object: "globalThis",
          property: "document",
          message: "Domain code must not use browser APIs.",
        },
        {
          object: "globalThis",
          property: "fetch",
          message: "Domain code must not use network APIs.",
        },
        {
          object: "globalThis",
          property: "localStorage",
          message: "Domain code must not use storage APIs.",
        },
        {
          object: "globalThis",
          property: "sessionStorage",
          message: "Domain code must not use storage APIs.",
        },
        {
          object: "globalThis",
          property: "indexedDB",
          message: "Domain code must not use storage APIs.",
        },
      ],
    },
  },
  {
    files: ["packages/catalog/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: restrictedPackages(["@editorial-doll/domain"]),
          patterns: [crossPackageRelativeImports],
        },
      ],
    },
  },
  {
    files: ["packages/render-engine/src/**/*.ts"],
    ignores: ["packages/render-engine/src/browser.ts"],
    languageOptions: {
      globals: {},
    },
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "Date",
        "Intl",
        "navigator",
        "location",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "caches",
        "showOpenFilePicker",
        "showSaveFilePicker",
        "showDirectoryPicker",
        "FileReader",
        "FileSystemHandle",
        "FileSystemFileHandle",
        "FileSystemDirectoryHandle",
        "FileSystemSyncAccessHandle",
        "crypto",
        "fetch",
        "WebSocket",
        "XMLHttpRequest",
        "EventSource",
        "BroadcastChannel",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "scheduler",
        "process",
        "Buffer",
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...restrictedPackages(["@editorial-doll/domain"]),
            { name: "sharp", message: "Render core cannot depend on image tooling." },
            { name: "react", message: "Render core must remain framework-free." },
            {
              name: "react-dom",
              message: "Render core must remain framework-free.",
            },
          ],
          patterns: [
            crossPackageRelativeImports,
            {
              group: ["node:*"],
              message: "Render core must not depend on Node runtime APIs.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Pass time in explicitly." },
        {
          object: "Math",
          property: "random",
          message: "Renderer output must be deterministic.",
        },
        {
          object: "crypto",
          property: "randomUUID",
          message: "Pass identity in explicitly.",
        },
        {
          object: "performance",
          property: "now",
          message: "Pass time in explicitly.",
        },
      ],
    },
  },
  {
    files: ["packages/render-engine/src/browser.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "Date",
        "Intl",
        "navigator",
        "location",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "caches",
        "showOpenFilePicker",
        "showSaveFilePicker",
        "showDirectoryPicker",
        "FileReader",
        "FileSystemHandle",
        "FileSystemFileHandle",
        "FileSystemDirectoryHandle",
        "FileSystemSyncAccessHandle",
        "crypto",
        "fetch",
        "WebSocket",
        "XMLHttpRequest",
        "EventSource",
        "BroadcastChannel",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "scheduler",
        "process",
        "Buffer",
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...restrictedPackages(["@editorial-doll/domain"]),
            { name: "sharp", message: "Browser renderer cannot depend on image tooling." },
            { name: "react", message: "Browser renderer must remain framework-free." },
            {
              name: "react-dom",
              message: "Browser renderer must remain framework-free.",
            },
          ],
          patterns: [
            crossPackageRelativeImports,
            {
              group: ["node:*"],
              message: "Browser renderer must not depend on Node runtime APIs.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Pass time in explicitly." },
        {
          object: "Math",
          property: "random",
          message: "Renderer output must be deterministic.",
        },
        {
          object: "crypto",
          property: "randomUUID",
          message: "Pass identity in explicitly.",
        },
        {
          object: "performance",
          property: "now",
          message: "Pass time in explicitly.",
        },
      ],
    },
  },
  {
    files: [
      "packages/persistence/src/**/*.ts",
      "tools/asset-pipeline/src/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: restrictedPackages(["@editorial-doll/domain"]),
          patterns: [crossPackageRelativeImports],
        },
      ],
    },
  },
  {
    files: ["packages/design-system/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: restrictedPackages(),
          patterns: [crossPackageRelativeImports],
        },
      ],
    },
  },
  {
    files: [
      "*.config.ts",
      "apps/studio/vite.render.config.ts",
      "scripts/**/*.mjs",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
);
