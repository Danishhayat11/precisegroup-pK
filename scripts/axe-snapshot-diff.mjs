#!/usr/bin/env node
/**
 * Snapshot + diff axe-core violations for the /dashboard KPI surface.
 *
 * Reads the per-test JSONs written by `tests/a11y/dashboard-kpi-axe.spec.ts`
 * under ./axe-results/, filters to KPI-scope files (suite: kpi-region /
 * kpi-card), and writes a normalized, deterministic snapshot per test to
 *
 *   .axe-snapshots/current/<suite>__<label>.json
 *
 * If a baseline exists at
 *
 *   .axe-snapshots/baseline/<suite>__<label>.json
 *
 * we produce a per-test diff of the violation set (added / removed /
 * unchanged) plus a summary at:
 *
 *   .axe-snapshots/diff.json
 *   .axe-snapshots/diff.md   (GitHub-flavoured markdown, uploadable as an
 *                             artifact and appended to the Job Summary)
 *
 * The comparison key is `${violation.id}::${node.target.join(">")}` so
 * moving/renaming a card surfaces cleanly instead of being masked by an
 * unchanged violation count.
 *
 * Exit code is always 0 — this is a reporting tool, not a gate. The axe
 * spec itself is what fails a run on new violations; this script explains
 * what changed since the last run.
 */
import { mkdir, readdir, readFile, writeFile, rm, cp, stat } from "node:fs/promises";
import path from "node:path";

const CWD = process.cwd();
const RESULTS_DIR = path.join(CWD, "axe-results");
const SNAP_DIR = path.join(CWD, ".axe-snapshots");
const CURRENT_DIR = path.join(SNAP_DIR, "current");
const BASELINE_DIR = path.join(SNAP_DIR, "baseline");
const DIFF_JSON = path.join(SNAP_DIR, "diff.json");
const DIFF_MD = path.join(SNAP_DIR, "diff.md");

const KPI_SUITES = new Set(["kpi-region", "kpi-card"]);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function loadResults() {
  if (!(await exists(RESULTS_DIR))) return [];
  const files = (await readdir(RESULTS_DIR)).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(await readFile(path.join(RESULTS_DIR, f), "utf8"));
      if (!KPI_SUITES.has(raw.suite)) continue;
      out.push(raw);
    } catch (err) {
      console.warn(`skip ${f}: ${err.message}`);
    }
  }
  return out;
}

function normalize(raw) {
  const violations = (raw.violations ?? [])
    .map((v) => ({
      id: v.id,
      impact: v.impact ?? null,
      help: v.help ?? "",
      helpUrl: v.helpUrl ?? "",
      nodes: (v.nodes ?? [])
        .map((n) => ({
          target: Array.isArray(n.target) ? n.target.map(String) : [String(n.target ?? "")],
          failureSummary: n.failureSummary ?? "",
        }))
        .sort((a, b) => a.target.join(">").localeCompare(b.target.join(">"))),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    project: raw.project ?? "default",
    projectRaw: raw.projectRaw ?? raw.project ?? "default",
    suite: raw.suite,
    label: raw.label,
    url: raw.url,
    violationCount: violations.length,
    violations,
  };
}

function safeName(project, suite, label) {
  return `${project}__${suite}__${label}`.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 200);
}

function keysForSnapshot(snap) {
  const keys = new Set();
  for (const v of snap.violations) {
    for (const n of v.nodes) {
      keys.add(`${v.id} :: ${n.target.join(" > ")}`);
    }
    if (v.nodes.length === 0) keys.add(`${v.id} :: (no nodes)`);
  }
  return keys;
}

function diffOne(baseline, current) {
  const bKeys = baseline ? keysForSnapshot(baseline) : new Set();
  const cKeys = current ? keysForSnapshot(current) : new Set();
  const added = [...cKeys].filter((k) => !bKeys.has(k)).sort();
  const removed = [...bKeys].filter((k) => !cKeys.has(k)).sort();
  const unchanged = [...cKeys].filter((k) => bKeys.has(k)).sort();
  return { added, removed, unchanged };
}

async function loadSnapshotDir(dir) {
  const out = new Map();
  if (!(await exists(dir))) return out;
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const snap = JSON.parse(await readFile(path.join(dir, f), "utf8"));
      out.set(f.replace(/\.json$/, ""), snap);
    } catch (err) {
      console.warn(`skip baseline ${f}: ${err.message}`);
    }
  }
  return out;
}

function renderMd(summary, perTest, byProject, hadBaseline) {
  const lines = [];
  lines.push("# KPI axe-core snapshot diff");
  lines.push("");
  if (!hadBaseline) {
    lines.push("> No previous baseline found — this run establishes the initial snapshot.");
    lines.push("");
  }
  lines.push(`- Tests compared: **${summary.tests}**`);
  lines.push(`- Violations added: **${summary.added}**`);
  lines.push(`- Violations removed: **${summary.removed}**`);
  lines.push(`- Violations unchanged: **${summary.unchanged}**`);
  lines.push("");

  lines.push("## Per-browser totals");
  lines.push("");
  lines.push("| Browser project | Tests | Added | Removed | Unchanged |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const [project, pSum] of byProject) {
    lines.push(
      `| \`${project}\` | ${pSum.tests} | ${pSum.added} | ${pSum.removed} | ${pSum.unchanged} |`,
    );
  }
  lines.push("");

  lines.push("## Per-test");
  lines.push("");
  lines.push("| Browser | Test | Added | Removed | Unchanged |");
  lines.push("| --- | --- | ---: | ---: | ---: |");
  for (const t of perTest) {
    lines.push(
      `| \`${t.project}\` | \`${t.suite}\` / ${t.label} | ${t.diff.added.length} | ${t.diff.removed.length} | ${t.diff.unchanged.length} |`,
    );
  }
  lines.push("");

  const changed = perTest.filter((t) => t.diff.added.length || t.diff.removed.length);
  if (changed.length === 0) {
    lines.push("_No changes vs baseline._");
    return lines.join("\n") + "\n";
  }
  // Group change details by browser so a WebKit-only regression reads as
  // a single WebKit section instead of being scattered across the report.
  const changedByProject = new Map();
  for (const t of changed) {
    if (!changedByProject.has(t.project)) changedByProject.set(t.project, []);
    changedByProject.get(t.project).push(t);
  }
  for (const [project, tests] of changedByProject) {
    lines.push(`## Changes in \`${project}\``);
    lines.push("");
    for (const t of tests) {
      lines.push(`### ${t.suite} — ${t.label}`);
      lines.push("");
      if (t.diff.added.length) {
        lines.push("**Added (new violations):**");
        lines.push("");
        for (const k of t.diff.added) lines.push(`- \`${k}\``);
        lines.push("");
      }
      if (t.diff.removed.length) {
        lines.push("**Removed (fixed since baseline):**");
        lines.push("");
        for (const k of t.diff.removed) lines.push(`- \`${k}\``);
        lines.push("");
      }
    }
  }
  return lines.join("\n") + "\n";
}

async function main() {
  await mkdir(CURRENT_DIR, { recursive: true });
  // Fresh current snapshot every run.
  await rm(CURRENT_DIR, { recursive: true, force: true });
  await mkdir(CURRENT_DIR, { recursive: true });

  const results = await loadResults();
  if (results.length === 0) {
    console.log("no KPI axe results — nothing to snapshot");
    await writeFile(
      DIFF_MD,
      "# KPI axe-core snapshot diff\n\n_No KPI axe results were produced by this run._\n",
    );
    await writeFile(
      DIFF_JSON,
      JSON.stringify(
        { tests: 0, added: 0, removed: 0, unchanged: 0, perProject: {}, perTest: [] },
        null,
        2,
      ),
    );
    return;
  }

  const current = new Map();
  for (const raw of results) {
    const snap = normalize(raw);
    const name = safeName(snap.project, snap.suite, snap.label);
    current.set(name, snap);
    await writeFile(path.join(CURRENT_DIR, `${name}.json`), JSON.stringify(snap, null, 2));
  }

  const baseline = await loadSnapshotDir(BASELINE_DIR);
  const hadBaseline = baseline.size > 0;

  const perTest = [];
  const summary = { tests: 0, added: 0, removed: 0, unchanged: 0 };
  const perProject = new Map();
  const names = new Set([...current.keys(), ...baseline.keys()]);
  for (const name of [...names].sort()) {
    const c = current.get(name);
    const b = baseline.get(name);
    const diff = diffOne(b, c);
    const project = (c ?? b).project ?? "default";
    perTest.push({
      name,
      project,
      suite: (c ?? b).suite,
      label: (c ?? b).label,
      presentInCurrent: !!c,
      presentInBaseline: !!b,
      diff,
    });
    summary.tests += 1;
    summary.added += diff.added.length;
    summary.removed += diff.removed.length;
    summary.unchanged += diff.unchanged.length;
    if (!perProject.has(project)) {
      perProject.set(project, { tests: 0, added: 0, removed: 0, unchanged: 0 });
    }
    const p = perProject.get(project);
    p.tests += 1;
    p.added += diff.added.length;
    p.removed += diff.removed.length;
    p.unchanged += diff.unchanged.length;
  }
  const sortedByProject = new Map([...perProject.entries()].sort(([a], [b]) => a.localeCompare(b)));

  await writeFile(
    DIFF_JSON,
    JSON.stringify(
      { ...summary, hadBaseline, perProject: Object.fromEntries(sortedByProject), perTest },
      null,
      2,
    ),
  );
  await writeFile(DIFF_MD, renderMd(summary, perTest, sortedByProject, hadBaseline));

  // Promote current → baseline for the next run's cache save.
  await rm(BASELINE_DIR, { recursive: true, force: true });
  await cp(CURRENT_DIR, BASELINE_DIR, { recursive: true });

  console.log(
    `axe snapshot diff: tests=${summary.tests} added=${summary.added} ` +
      `removed=${summary.removed} unchanged=${summary.unchanged} baseline=${hadBaseline ? "yes" : "no"}`,
  );
}

main().catch((err) => {
  console.error("axe-snapshot-diff failed:", err);
  process.exit(1);
});
