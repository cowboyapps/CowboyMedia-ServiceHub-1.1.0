import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

// Usage: npx tsx script/measure-client-bundle.ts /path/to/vite-output
// Build with --manifest. Includes every transitive static JS dependency, not
// just the entry file; excludes lazy routes until they are actually opened.
type Chunk = { file: string; imports?: string[]; css?: string[]; dynamicImports?: string[] };
const directory = process.argv[2];
if (!directory) throw new Error("Provide a Vite build output directory containing .vite/manifest.json");
const manifest = JSON.parse(readFileSync(resolve(directory, ".vite/manifest.json"), "utf8")) as Record<string, Chunk>;
function closure(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  const chunk = manifest[entry];
  if (!chunk) throw new Error(`Manifest entry not found: ${entry}`);
  seen.add(entry);
  for (const dependency of chunk.imports ?? []) closure(dependency, seen);
  return seen;
}
function size(keys: Set<string>) {
  const files = [...new Set([...keys].map(key => manifest[key].file))].filter(file => file.endsWith(".js"));
  let rawBytes = 0, gzipBytes = 0;
  for (const file of files) {
    const bytes = readFileSync(resolve(directory, file));
    rawBytes += bytes.length;
    gzipBytes += gzipSync(bytes).length;
  }
  return { files, rawBytes, gzipBytes };
}
const initial = closure("index.html");
const detail = manifest["src/pages/alert-detail.tsx"];
const detailOnly = detail
  ? new Set([...closure("src/pages/alert-detail.tsx")].filter(key => !initial.has(key)))
  : new Set<string>();
console.log(JSON.stringify({
  initialJavaScript: size(initial),
  // Alerts list deliberately stays eager: the customer's highest priority.
  dashboardToAlertsAdditionalJavaScript: 0,
  alertDetailAdditionalJavaScript: size(detailOnly),
  dynamicRoutes: manifest["index.html"].dynamicImports?.length ?? 0,
}, null, 2));
