import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const sourceRoot = path.resolve("packages/domain/src");
const forbidden = [
  ["React", /\breact\b/iu],
  ["Zustand", /\bzustand\b/iu],
  ["Dexie", /\bdexie\b/iu],
  ["window", /\bwindow\b/u],
  ["document", /\bdocument\b/u],
  ["Canvas", /\bcanvas\b/iu],
  ["localStorage", /\blocalStorage\b/u],
  ["sessionStorage", /\bsessionStorage\b/u],
  ["indexedDB", /\bindexedDB\b/u],
  ["globalThis", /\bglobalThis\b/u],
  ["fetch", /\bfetch\b/u],
  ["WebSocket", /\bWebSocket\b/u],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/u],
  ["process", /\bprocess\b/u],
  ["Buffer", /\bBuffer\b/u],
  ["crypto", /\bcrypto\b/u],
  ["Date.now", /\bDate\.now\s*\(/u],
  ["implicit current date", /\bnew\s+Date\s*\(\s*\)/u],
  ["Math.random", /\bMath\.random\s*\(/u],
  ["randomUUID", /\brandomUUID\s*\(/u],
  ["performance.now", /\bperformance\.now\s*\(/u],
  ["timer", /\bset(?:Timeout|Interval)\s*\(/u],
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
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) {
      violations.push(`${path.relative(process.cwd(), filePath)}: ${label}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Domain purity violations found:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log("Domain purity scan passed.");
}
