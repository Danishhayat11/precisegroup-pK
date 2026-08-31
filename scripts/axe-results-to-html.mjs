#!/usr/bin/env node
/**
 * Aggregate every axe-core result JSON dropped into ./axe-results by the
 * a11y specs into a single, self-contained HTML report at
 * ./axe-report/index.html.
 *
 * The report is a static HTML file with inline CSS and inline JSON — no
 * external assets, so it renders identically when downloaded from a CI
 * artifact zip.
 *
 * Section per suite → card per test with:
 *   - test URL + timestamp + engine version
 *   - violation count badge (red / green)
 *   - each violation: id, impact, description, help URL, offending
 *     nodes with the exact CSS target selector and the axe failure
 *     summary
 *
 * Exit codes:
 *   0 — report written (regardless of violation count)
 *   0 — no input files (report is skipped, message printed)
 *   1 — hard I/O failure
 */
import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CWD = process.cwd();
const IN_DIR = path.join(CWD, "axe-results");
const OUT_DIR = path.join(CWD, "axe-report");
const OUT_FILE = path.join(OUT_DIR, "index.html");

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function impactColor(impact) {
  switch (impact) {
    case "critical":
      return "#b91c1c";
    case "serious":
      return "#c2410c";
    case "moderate":
      return "#a16207";
    case "minor":
      return "#4d7c0f";
    default:
      return "#475569";
  }
}

function renderViolation(v) {
  const nodes = (v.nodes ?? [])
    .map(
      (n) => `
        <li class="node">
          <div class="node-target"><code>${esc((n.target ?? []).join(" "))}</code></div>
          ${n.failureSummary ? `<pre class="node-summary">${esc(n.failureSummary)}</pre>` : ""}
          ${n.html ? `<details><summary>offending HTML</summary><pre>${esc(n.html)}</pre></details>` : ""}
        </li>`,
    )
    .join("");
  return `
    <div class="violation" style="border-left-color:${impactColor(v.impact)}">
      <div class="v-head">
        <span class="v-id"><code>${esc(v.id)}</code></span>
        <span class="v-impact" style="background:${impactColor(v.impact)}">${esc(v.impact ?? "unknown")}</span>
      </div>
      <div class="v-help">${esc(v.help ?? "")}</div>
      ${v.description ? `<div class="v-desc">${esc(v.description)}</div>` : ""}
      ${v.helpUrl ? `<div class="v-link"><a href="${esc(v.helpUrl)}" target="_blank" rel="noopener">${esc(v.helpUrl)}</a></div>` : ""}
      <ul class="nodes">${nodes}</ul>
    </div>`;
}

function renderTest(t) {
  const vcount = (t.violations ?? []).length;
  const badgeClass = vcount === 0 ? "badge-ok" : "badge-fail";
  const badgeText = vcount === 0 ? "0 violations" : `${vcount} violation${vcount === 1 ? "" : "s"}`;
  return `
    <section class="test">
      <header class="test-head">
        <h3>${esc(t.label)}</h3>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </header>
      <dl class="test-meta">
        <dt>URL</dt><dd><code>${esc(t.url ?? "")}</code></dd>
        <dt>Captured</dt><dd>${esc(t.timestamp ?? "")}</dd>
        <dt>Engine</dt><dd>${esc(t.testEngine?.name ?? "axe-core")} ${esc(t.testEngine?.version ?? "")}</dd>
      </dl>
      ${
        vcount === 0
          ? `<p class="no-violations">No axe-core violations for the scoped region.</p>`
          : `<div class="violations">${(t.violations ?? []).map(renderViolation).join("")}</div>`
      }
    </section>`;
}

function renderSuite(suite, tests) {
  const total = tests.reduce((s, t) => s + (t.violations?.length ?? 0), 0);
  return `
    <section class="suite">
      <header class="suite-head">
        <h3>${esc(suite)}</h3>
        <span class="badge ${total === 0 ? "badge-ok" : "badge-fail"}">
          ${total === 0 ? "clean" : `${total} total violation${total === 1 ? "" : "s"}`}
        </span>
      </header>
      ${tests.map(renderTest).join("")}
    </section>`;
}

function renderProject(project, bySuiteMap) {
  const suites = [...bySuiteMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = suites.reduce(
    (s, [, tests]) => s + tests.reduce((ss, t) => ss + (t.violations?.length ?? 0), 0),
    0,
  );
  const testCount = suites.reduce((s, [, tests]) => s + tests.length, 0);
  return `
    <section class="project">
      <header class="project-head">
        <h2>Browser: <code>${esc(project)}</code></h2>
        <span class="badge ${total === 0 ? "badge-ok" : "badge-fail"}">
          ${total === 0 ? `${testCount} tests · clean` : `${testCount} tests · ${total} violation${total === 1 ? "" : "s"}`}
        </span>
      </header>
      ${suites
        .map(([suite, tests]) =>
          renderSuite(
            suite,
            tests.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? "")),
          ),
        )
        .join("")}
    </section>`;
}

const CSS = `
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .subtitle { color: #475569; margin-bottom: 24px; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0 24px; }
  .summary .card { background: white; padding: 12px 16px; border-radius: 8px;
                   box-shadow: 0 1px 2px rgba(15,23,42,0.06); min-width: 140px; }
  .summary .k { font-size: 12px; text-transform: uppercase; color: #64748b; letter-spacing: 0.04em; }
  .summary .v { font-size: 20px; font-weight: 600; margin-top: 4px; }
  .project { background: #eef2ff; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;
             box-shadow: 0 1px 3px rgba(15,23,42,0.06); }
  .project-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .project-head h2 { margin: 0; font-size: 18px; }
  .suite { background: white; border-radius: 10px; padding: 16px 20px; margin-bottom: 12px;
           box-shadow: 0 1px 3px rgba(15,23,42,0.06); }
  .suite-head, .test-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .suite-head h3 { margin: 0; font-size: 15px; }
  .test { border-top: 1px solid #e2e8f0; padding: 14px 0; }
  .test:first-of-type { border-top: none; }
  .test-meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 8px 0 12px; font-size: 12px; color: #475569; }
  .test-meta dt { font-weight: 600; }
  .badge { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .badge-ok   { background: #dcfce7; color: #14532d; }
  .badge-fail { background: #fee2e2; color: #7f1d1d; }
  .no-violations { color: #14532d; margin: 0; }
  .violation { border-left: 4px solid #b91c1c; background: #fff7f7; padding: 10px 14px;
               border-radius: 0 6px 6px 0; margin: 10px 0; }
  .v-head { display: flex; gap: 10px; align-items: center; }
  .v-impact { color: white; font-size: 11px; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; }
  .v-help { font-weight: 600; margin-top: 4px; }
  .v-desc { color: #475569; margin-top: 2px; }
  .v-link a { color: #1d4ed8; word-break: break-all; }
  .nodes { list-style: none; padding: 0; margin: 10px 0 0; }
  .node { background: white; border: 1px solid #fecaca; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; }
  .node-target { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
  .node-summary { margin: 6px 0 0; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; color: #7f1d1d; }
  details { margin-top: 6px; }
  details pre { max-height: 220px; overflow: auto; background: #f1f5f9; padding: 8px; border-radius: 4px; font-size: 11px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
`;

async function main() {
  let entries;
  try {
    entries = await readdir(IN_DIR);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log(`[axe-report] no ${IN_DIR} directory — nothing to render.`);
      return;
    }
    throw err;
  }

  const jsonFiles = entries.filter((f) => f.endsWith(".json"));
  if (jsonFiles.length === 0) {
    console.log(`[axe-report] no .json files in ${IN_DIR} — nothing to render.`);
    return;
  }

  // Two-level grouping: project → suite → tests. Files written before we
  // started stamping `project` (or from ad-hoc runs) fall into "default".
  const byProject = new Map();
  for (const f of jsonFiles) {
    const full = path.join(IN_DIR, f);
    try {
      const raw = await readFile(full, "utf8");
      const data = JSON.parse(raw);
      const project = data.project || "default";
      const suite = data.suite || "unknown";
      if (!byProject.has(project)) byProject.set(project, new Map());
      const bySuite = byProject.get(project);
      if (!bySuite.has(suite)) bySuite.set(suite, []);
      bySuite.get(suite).push(data);
    } catch (err) {
      console.warn(`[axe-report] skipping ${f}: ${err.message}`);
    }
  }

  const projects = [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b));
  let totalTests = 0;
  let totalViolations = 0;
  const perProjectSummary = projects.map(([project, bySuite]) => {
    let tests = 0;
    let violations = 0;
    for (const [, ts] of bySuite) {
      tests += ts.length;
      for (const t of ts) violations += t.violations?.length ?? 0;
    }
    totalTests += tests;
    totalViolations += violations;
    return { project, tests, violations };
  });

  const projectCards = perProjectSummary
    .map(
      (p) => `
        <div class="card">
          <div class="k">${esc(p.project)}</div>
          <div class="v" style="color:${p.violations === 0 ? "#14532d" : "#7f1d1d"}">${p.violations}</div>
          <div class="k" style="margin-top:2px">${p.tests} test${p.tests === 1 ? "" : "s"}</div>
        </div>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>axe-core report — dashboard KPI (${totalViolations} violation${totalViolations === 1 ? "" : "s"})</title>
<style>${CSS}</style>
</head>
<body>
<h1>axe-core accessibility report</h1>
<div class="subtitle">
  Generated ${esc(new Date().toISOString())} from <code>${esc(path.relative(CWD, IN_DIR))}</code>
</div>
<div class="summary">
  <div class="card"><div class="k">browsers</div><div class="v">${projects.length}</div></div>
  <div class="card"><div class="k">tests</div><div class="v">${totalTests}</div></div>
  <div class="card"><div class="k">total violations</div>
    <div class="v" style="color:${totalViolations === 0 ? "#14532d" : "#7f1d1d"}">${totalViolations}</div>
  </div>
  ${projectCards}
</div>
${projects.map(([project, bySuite]) => renderProject(project, bySuite)).join("")}
</body>
</html>`;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, html);
  const size = (await stat(OUT_FILE)).size;
  console.log(
    `[axe-report] wrote ${OUT_FILE} — ${projects.length} browser(s), ${totalTests} test(s), ${totalViolations} violation(s), ${size} bytes`,
  );
}

// Only auto-run when invoked as a script, not when imported.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[axe-report] failed:", err);
    process.exit(1);
  });
}
