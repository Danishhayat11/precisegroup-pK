#!/usr/bin/env node
// Enforce that every `supabase.rpc("...")` call in src/ references a name
// listed in src/integrations/supabase/approvedRpc.ts. Fails CI otherwise.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const allowlistSource = readFileSync("src/integrations/supabase/approvedRpc.ts", "utf8");
const approved = new Set(
  Array.from(allowlistSource.matchAll(/"([a-zA-Z_][a-zA-Z0-9_]*)"/g))
    .map((m) => m[1])
    // Trim helper strings; only names that look like SQL identifiers matter.
    .filter((n) => n && !["ok", "error"].includes(n)),
);

const grep = execSync(
  `grep -RIn --include='*.ts' --include='*.tsx' -oE 'rpc\\(\\s*"[a-zA-Z_][a-zA-Z0-9_]*"' src || true`,
  { encoding: "utf8" },
);

const violations = [];
for (const line of grep.split("\n")) {
  if (!line) continue;
  const m = line.match(/^([^:]+):(\d+):.*rpc\(\s*"([^"]+)"/);
  if (!m) continue;
  const [, file, lineNo, name] = m;
  // Ignore the allowlist file itself.
  if (file.endsWith("approvedRpc.ts") || file.endsWith("serverRpc.ts")) continue;
  if (!approved.has(name)) {
    violations.push({ file, line: lineNo, name });
  }
}

if (violations.length > 0) {
  console.error("\n❌ Unapproved supabase.rpc() calls detected:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  →  rpc("${v.name}")`);
  }
  console.error(
    "\nAdd the name to src/integrations/supabase/approvedRpc.ts only if the DB function is intentionally exposed to authenticated users AND enforces its own role/tenant checks. Otherwise, move the call to a server function that uses supabaseAdmin.\n",
  );
  process.exit(1);
}

// Second guard: server-function handlers must go through `callServerRpc`
// rather than `context.supabase.rpc(...)` — otherwise the compile-time
// allowlist is bypassed on the server side.
const serverGrep = execSync(
  `grep -RIn --include='*.functions.ts' --include='*.functions.tsx' -oE 'context\\.supabase\\.rpc\\(' src || true`,
  { encoding: "utf8" },
);
const serverViolations = serverGrep
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const m = l.match(/^([^:]+):(\d+):/);
    return m ? { file: m[1], line: m[2] } : null;
  })
  .filter(Boolean);

if (serverViolations.length > 0) {
  console.error(
    "\n❌ Server functions must call RPCs through `callServerRpc(context.supabase, ...)`:\n",
  );
  for (const v of serverViolations) {
    console.error(`  ${v.file}:${v.line}  →  context.supabase.rpc(...)`);
  }
  console.error(
    "\nImport { callServerRpc } from '@/integrations/supabase/serverRpc' and route the call through it so the approved-RPC allowlist is enforced on the server as well.\n",
  );
  process.exit(1);
}

// Third guard: client-side code (anything under src/ that is not a
// server-function/server-only module, the RPC wrappers, or a test) must
// never call `supabase.rpc(` directly. It has to go through `callRpc`
// so the runtime allowlist and revoked-mapping layer apply.
const clientGrep = execSync(
  `grep -RIn --include='*.ts' --include='*.tsx' -E '(^|[^.[:alnum:]_])supabase\\.rpc\\(' src || true`,
  { encoding: "utf8" },
);

const clientViolations = [];
for (const line of clientGrep.split("\n")) {
  if (!line) continue;
  const m = line.match(/^([^:]+):(\d+):/);
  if (!m) continue;
  const [, file, lineNo] = m;
  if (
    file.endsWith("approvedRpc.ts") ||
    file.endsWith("serverRpc.ts") ||
    file.endsWith(".functions.ts") ||
    file.endsWith(".functions.tsx") ||
    file.endsWith(".server.ts") ||
    file.endsWith(".server.tsx") ||
    file.includes("/__tests__/") ||
    /\.(test|spec)\.(ts|tsx)$/.test(file)
  ) {
    continue;
  }
  clientViolations.push({ file, line: lineNo });
}

if (clientViolations.length > 0) {
  console.error("\n❌ Client-side code must call RPCs through `callRpc(supabase, ...)`:\n");
  for (const v of clientViolations) {
    console.error(`  ${v.file}:${v.line}  →  supabase.rpc(...)`);
  }
  console.error(
    "\nImport { callRpc } from '@/integrations/supabase/approvedRpc' and route the call through it so the approved-RPC allowlist, revoked-mapping layer, and audit logging apply. Server-function handlers use { callServerRpc } from '@/integrations/supabase/serverRpc' instead.\n",
  );
  process.exit(1);
}

console.log(
  `✅ All supabase.rpc() calls reference approved names (${approved.size} approved), no server function bypasses callServerRpc, and no client-side code bypasses callRpc.`,
);
