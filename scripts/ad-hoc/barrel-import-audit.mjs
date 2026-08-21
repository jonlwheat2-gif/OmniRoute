#!/usr/bin/env node
// Ad-hoc audit: enumerate every import statement from the "@/shared/components"
// barrel by scanning statement-by-statement (handles multiline imports).
// Run: node scripts/ad-hoc/barrel-import-audit.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const BARREL = "@/shared/components";

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(p);
  }
}
walk(SRC);

let singleLine = 0;
let multiline = 0;
let aliased = 0;
let defaultImport = 0;
let typeOnly = 0;
let reexport = 0;
let total = 0;
const typeOnlyFiles = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!src.includes(BARREL)) continue;

  // Re-exports of the barrel (export * from / export { x } from)
  const re = src.match(/export\s+(?:\*\s+as\s+\w+\s+)?(?:{[^}]*}\s+)?from\s+["']@\/shared\/components["']/g);
  if (re) reexport += re.length;

  // Scan import statements one at a time: from "import" to the terminating
  // ";" or the end of the statement line (imports can be multiline).
  let idx = 0;
  while (true) {
    const start = src.indexOf("import", idx);
    if (start === -1) break;
    // Skip "import type" vs "import {": find the from-clause for THIS statement
    let fromIdx = src.indexOf('from "@/shared/components"', start);
    if (fromIdx === -1) break;
    // Ensure this from belongs to the same statement: no other statement's
    // terminator (;\n) between start and fromIdx except within this one.
    const stmtEnd = src.indexOf(";", start);
    if (stmtEnd !== -1 && stmtEnd < fromIdx) {
      idx = start + 6;
      continue;
    }
    const spec = src.slice(start + 6, fromIdx).trim();
    const isType = spec.startsWith("type ");
    if (isType) {
      typeOnly++;
      typeOnlyFiles.push(file);
      idx = fromIdx + 1;
      continue;
    }
    if (spec.startsWith("{")) {
      const inner = spec.slice(1, spec.lastIndexOf("}"));
      if (/\bas\b/.test(inner)) {
        aliased++;
      } else if (inner.includes("\n")) {
        multiline++;
      } else {
        singleLine++;
      }
    } else if (/^[A-Za-z_$][\w$]*$/.test(spec)) {
      defaultImport++;
    } else {
      multiline++;
    }
    total++;
    idx = fromIdx + 1;
  }
}

console.log(`Files scanned: ${files.length}`);
console.log(`Total barrel imports: ${total}`);
console.log(`Single-line named: ${singleLine}`);
console.log(`Multiline named: ${multiline}`);
console.log(`Aliased: ${aliased}`);
console.log(`Default: ${defaultImport}`);
console.log(`Type-only: ${typeOnly}`);
console.log(`Re-exports: ${reexport}`);
if (typeOnlyFiles.length) {
  console.log("\n--- type-only files ---");
  [...new Set(typeOnlyFiles)].forEach((f) => console.log(`  ${f}`));
}
