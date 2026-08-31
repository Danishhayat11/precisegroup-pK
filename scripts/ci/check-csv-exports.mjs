#!/usr/bin/env node
/**
 * check-csv-exports.mjs — build-time gate for the CSV export helper contract.
 *
 * Every CSV / JSON download in the app is required to run its metadata
 * through `buildCsvMetadataHeader` (or its JSON sibling) from
 * `src/lib/csvExportMetadata.ts`, so exported files always carry the
 * reproducible source / filters / sort / pagination / columns header
 * that Import Center + Data Health rely on.
 *
 * This script fails CI when:
 *  1. Any of the three known export surfaces (Dashboard, ImportCenter,
 *     DataHealth) stops importing the helper — a common regression when
 *     someone rewrites a download in-place with raw string concatenation.
 *  2. The helper module or its parser sibling is missing.
 *
 * A dedicated typecheck pass over the whole project is run separately by
 * the `typecheck` npm script; this file is the semantic contract check.
 */
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const REQUIRED_HELPERS = ["src/lib/csvExportMetadata.ts", "src/lib/csvMetadataParser.ts"];

const EXPORT_SURFACES = [
  "src/pages/Dashboard.tsx",
  "src/pages/ImportCenter.tsx",
  "src/pages/DataHealth.tsx",
];

const REQUIRED_IMPORT = /from\s+["']@\/lib\/csvExportMetadata["']/;
const REQUIRED_SYMBOL =
  /\bbuildCsvMetadataHeader\b|\bprefixCsvWithMetadata\b|\bbuildJsonExportMetadata\b/;

const errors = [];

for (const rel of REQUIRED_HELPERS) {
  try {
    await access(path.join(ROOT, rel));
  } catch {
    errors.push(`missing helper: ${rel}`);
  }
}

for (const rel of EXPORT_SURFACES) {
  const abs = path.join(ROOT, rel);
  let src;
  try {
    src = await readFile(abs, "utf8");
  } catch (err) {
    errors.push(`cannot read ${rel}: ${err.message}`);
    continue;
  }
  if (!REQUIRED_IMPORT.test(src)) {
    errors.push(
      `${rel}: missing \`import … from "@/lib/csvExportMetadata"\` — every export surface must reuse the shared metadata helper.`,
    );
    continue;
  }
  if (!REQUIRED_SYMBOL.test(src)) {
    errors.push(
      `${rel}: imports the helper module but never calls \`buildCsvMetadataHeader\`, \`prefixCsvWithMetadata\`, or \`buildJsonExportMetadata\`.`,
    );
  }
}

if (errors.length > 0) {
  console.error("✗ CSV export helper contract check failed:");
  for (const e of errors) console.error(`  • ${e}`);
  console.error(
    "\nEvery export site MUST prepend metadata via `buildCsvMetadataHeader`\n" +
      "(or `prefixCsvWithMetadata` / `buildJsonExportMetadata`) so downloaded\n" +
      "files carry the reproducible filter/sort/pagination/columns header.",
  );
  process.exit(1);
}

console.log(
  `✓ CSV export helpers present and referenced by ${EXPORT_SURFACES.length} surfaces (${EXPORT_SURFACES.map((f) => path.basename(f)).join(", ")}).`,
);
