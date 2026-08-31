#!/usr/bin/env node
/**
 * Smoke test for scripts/codemods/supabase-rpc-to-callRpc.mjs. Creates
 * temp fixtures, invokes the codemod in --write mode against a sandbox
 * copy, and asserts the resulting source contains the expected wrappers
 * plus imports.
 */
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const root = mkdtempSync(join(tmpdir(), "rpc-codemod-"));
mkdirSync(join(root, "src/integrations/supabase"), { recursive: true });
mkdirSync(join(root, "src/features"), { recursive: true });

// Minimal allowlist stub for the codemod to load.
writeFileSync(
  join(root, "src/integrations/supabase/approvedRpc.ts"),
  `export const APPROVED_RPCS = ["admin_list_users", "get_widget"] as const;\n`,
);

const clientFixture = `import { supabase } from "@/integrations/supabase/client";
export async function loadUsers() {
  const { data } = await supabase.rpc("admin_list_users", { limit: 10 });
  return data;
}
`;
writeFileSync(join(root, "src/features/users.ts"), clientFixture);

const serverFixture = `import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const getWidget = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("get_widget", { id: 1 });
    return data;
  });
`;
writeFileSync(join(root, "src/features/widget.functions.ts"), serverFixture);

// Copy the codemod into the sandbox so its relative paths line up.
mkdirSync(join(root, "scripts/codemods"), { recursive: true });
cpSync(
  "scripts/codemods/supabase-rpc-to-callRpc.mjs",
  join(root, "scripts/codemods/supabase-rpc-to-callRpc.mjs"),
);

execFileSync("node", ["scripts/codemods/supabase-rpc-to-callRpc.mjs", "--write"], {
  cwd: root,
  stdio: "inherit",
});

const users = readFileSync(join(root, "src/features/users.ts"), "utf8");
assert.match(users, /callRpc\("admin_list_users"/, "client call rewritten");
assert.match(users, /from "@\/integrations\/supabase\/approvedRpc"/, "client import added");
assert.doesNotMatch(users, /supabase\.rpc\(/, "raw supabase.rpc removed");

const widget = readFileSync(join(root, "src/features/widget.functions.ts"), "utf8");
assert.match(widget, /callServerRpc\(context, "get_widget"/, "server call rewritten");
assert.match(widget, /from "@\/integrations\/supabase\/serverRpc"/, "server import added");
assert.doesNotMatch(widget, /context\.supabase\.rpc\(/, "raw context.supabase.rpc removed");

// Idempotency: second run must not change anything.
const before = readFileSync(join(root, "src/features/users.ts"), "utf8");
execFileSync("node", ["scripts/codemods/supabase-rpc-to-callRpc.mjs", "--write"], {
  cwd: root,
  stdio: "inherit",
});
const after = readFileSync(join(root, "src/features/users.ts"), "utf8");
assert.equal(before, after, "codemod is idempotent");

console.log("\n✓ supabase-rpc-to-callRpc codemod tests passed");
