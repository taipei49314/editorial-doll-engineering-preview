import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const sourceRoot = path.resolve("packages/render-engine/src");

const coreForbidden = [
  ["browser global", /\b(?:window|document|navigator|location)\b/u],
  ["DOM or Canvas type", /\b(?:HTMLCanvasElement|CanvasRenderingContext2D|ImageBitmap|OffscreenCanvas)\b/u],
  [
    "browser storage",
    /\b(?:localStorage|sessionStorage|indexedDB|caches|CacheStorage)\b/u,
  ],
  [
    "browser network",
    /\b(?:fetch|WebSocket|XMLHttpRequest|EventSource|BroadcastChannel|sendBeacon)\b/u,
  ],
  [
    "filesystem access",
    /\b(?:showOpenFilePicker|showSaveFilePicker|showDirectoryPicker|FileReader|FileSystemHandle|FileSystemFileHandle|FileSystemDirectoryHandle|FileSystemSyncAccessHandle)\b/u,
  ],
  ["Node runtime", /\b(?:process|Buffer|__dirname|__filename)\b/u],
  ["Node built-in import", /(?:from|import)\s*["']node:/u],
  ["time source", /\b(?:Date(?:\.now)?|performance\.now)\s*\(/u],
  ["implicit current date", /\bnew\s+Date\s*\(\s*\)/u],
  [
    "random source",
    /\b(?:Math\.random|crypto\.(?:randomUUID|getRandomValues))\s*\(/u,
  ],
  [
    "scheduling source",
    /\b(?:setTimeout|clearTimeout|setInterval|clearInterval|setImmediate|queueMicrotask|requestAnimationFrame|cancelAnimationFrame|requestIdleCallback|cancelIdleCallback|scheduler)\b/u,
  ],
  ["locale-sensitive behavior", /\b(?:Intl|localeCompare)\b/u],
  ["WebGL or 3D", /\b(?:WebGL|webgl|three)\b/u],
];

const browserForbidden = [
  ["window discovery", /\bwindow\b/u],
  ["document discovery", /\bdocument\b/u],
  ["navigator discovery", /\bnavigator\b/u],
  [
    "browser storage",
    /\b(?:localStorage|sessionStorage|indexedDB|caches|CacheStorage)\b/u,
  ],
  [
    "network access",
    /\b(?:fetch|WebSocket|XMLHttpRequest|EventSource|BroadcastChannel|sendBeacon)\b/u,
  ],
  [
    "filesystem access",
    /\b(?:showOpenFilePicker|showSaveFilePicker|showDirectoryPicker|FileReader|FileSystemHandle|FileSystemFileHandle|FileSystemDirectoryHandle|FileSystemSyncAccessHandle)\b/u,
  ],
  ["Node runtime", /\b(?:process|Buffer|__dirname|__filename)\b/u],
  ["Node built-in import", /(?:from|import)\s*["']node:/u],
  ["time source", /\b(?:Date(?:\.now)?|performance\.now)\s*\(/u],
  ["implicit current date", /\bnew\s+Date\s*\(\s*\)/u],
  [
    "random source",
    /\b(?:Math\.random|crypto\.(?:randomUUID|getRandomValues))\s*\(/u,
  ],
  [
    "scheduling source",
    /\b(?:setTimeout|clearTimeout|setInterval|clearInterval|setImmediate|queueMicrotask|requestAnimationFrame|cancelAnimationFrame|requestIdleCallback|cancelIdleCallback|scheduler)\b/u,
  ],
  ["locale-sensitive behavior", /\b(?:Intl|localeCompare)\b/u],
  ["WebGL or 3D", /\b(?:WebGL|webgl|three)\b/u],
  ["file encoding or download", /\b(?:toBlob|toDataURL|convertToBlob|download)\b/u],
];

const collectTypeScriptFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(entryPath);
      }

      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    }),
  );

  return nested.flat().sort();
};

const violations = [];
for (const filePath of await collectTypeScriptFiles(sourceRoot)) {
  const source = await readFile(filePath, "utf8");
  const rules = path.basename(filePath) === "browser.ts" ? browserForbidden : coreForbidden;
  for (const [label, pattern] of rules) {
    if (pattern.test(source)) {
      violations.push(`${path.relative(process.cwd(), filePath)}: ${label}`);
    }
  }
}

const puritySelfTestProbes = [
  {
    label: "browser navigator.sendBeacon",
    rules: browserForbidden,
    source: 'navigator.sendBeacon("https://invalid.example", "");',
  },
  {
    label: "browser navigator.storage",
    rules: browserForbidden,
    source: "void navigator.storage.getDirectory();",
  },
  {
    label: "browser filesystem picker",
    rules: browserForbidden,
    source: "void showOpenFilePicker();",
  },
  {
    label: "browser Cache Storage",
    rules: browserForbidden,
    source: 'void caches.open("render-probe");',
  },
  {
    label: "browser timeout scheduling",
    rules: browserForbidden,
    source: "setTimeout(() => undefined, 1);",
  },
  {
    label: "browser animation scheduling",
    rules: browserForbidden,
    source: "requestAnimationFrame(() => undefined);",
  },
  {
    label: "core microtask scheduling",
    rules: coreForbidden,
    source: "queueMicrotask(() => undefined);",
  },
  {
    label: "core callable Date current-time source",
    rules: coreForbidden,
    source: "const currentTime = Date();",
  },
  {
    label: "browser Intl.Collator locale ordering",
    rules: browserForbidden,
    source: "const collator = new Intl.Collator();",
  },
  {
    label: "core globalThis crypto random bytes",
    rules: coreForbidden,
    source: "globalThis.crypto.getRandomValues(new Uint8Array(1));",
  },
  {
    label: "browser globalThis crypto random bytes",
    rules: browserForbidden,
    source: "globalThis.crypto.getRandomValues(new Uint8Array(1));",
  },
];

for (const probe of puritySelfTestProbes) {
  if (!probe.rules.some(([, pattern]) => pattern.test(probe.source))) {
    violations.push(`render-engine purity self-test accepted ${probe.label}`);
  }
}

if (violations.length > 0) {
  console.error("Render-engine purity violations found:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log("Render-engine purity scan passed.");
}
