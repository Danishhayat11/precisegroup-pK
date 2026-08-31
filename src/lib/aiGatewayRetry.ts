/**
 * aiGatewayRetry — helpers for recovering from tools-related failures at
 * the AI gateway.
 *
 * Failure modes seen in production:
 *   • 400 "invalid tools[N]" — one entry in the tools array is malformed
 *     (usually a schema drift the strict validator didn't catch).
 *   • 400 "tool_use_failed" / "unknown_tool" — the model referenced a tool
 *     name the gateway doesn't accept for this deployment.
 *   • 400 with generic "tools" wording — model / provider rejected the
 *     shape entirely.
 *
 * The retry ladder here is deterministic and side-effect free:
 *   1. `sanitizeToolsForRetry(tools)` — per-entry validation via the strict
 *      `validateToolSchemas` rules. Entries that fail individually are
 *      dropped, matching entries are kept. Returns the filtered list plus
 *      the list of dropped entries for logging.
 *   2. If the filtered list is empty (or still fails), the caller falls
 *      back to sending the request with `tools: undefined` — a safe
 *      default where the model must answer from context alone.
 */

import { validateToolSchemas, type ToolFunctionSchema } from "./aiToolSchemas";

const TOOLS_ERROR_HINTS = [
  "tool", // "tools[0]", "tool_use_failed", "invalid tool"
  "function", // "function.name", "invalid function schema"
  "schema", // "invalid schema", "schema validation"
  "parameters", // "invalid parameters"
];

/**
 * Heuristic: does this non-OK gateway response look like a tools-related
 * problem worth retrying with a cleaned/empty tools array?
 *
 * We only retry on 4xx client errors — 5xx / 429 / 402 are handled by
 * their own paths and re-sending different tools won't help.
 */
export function isToolsRelatedError(status: number, bodyText: string): boolean {
  if (status < 400 || status >= 500) return false;
  // 401/403 are auth issues, not schema. 429/402 are quota. Skip all of them.
  if (status === 401 || status === 402 || status === 403 || status === 429) return false;
  const lower = String(bodyText ?? "").toLowerCase();
  if (!lower) return false;
  return TOOLS_ERROR_HINTS.some((h) => lower.includes(h));
}

export interface SanitizedTools {
  tools: ToolFunctionSchema[];
  dropped: Array<{ index: number; name: string | null; reason: string }>;
}

/**
 * Per-entry sanitize: keep entries that pass strict validation on their
 * own, drop the rest. Never throws — returns an empty list when the input
 * is not an array. Duplicates are collapsed to the first occurrence.
 */
export function sanitizeToolsForRetry(tools: unknown): SanitizedTools {
  const dropped: SanitizedTools["dropped"] = [];
  if (!Array.isArray(tools)) return { tools: [], dropped };

  const kept: ToolFunctionSchema[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tools.length; i++) {
    const entry = tools[i];
    const name =
      entry && typeof entry === "object" && (entry as { function?: { name?: unknown } }).function
        ? String((entry as { function: { name?: unknown } }).function.name ?? "")
        : "";

    if (entry === undefined || entry === null) {
      dropped.push({ index: i, name: null, reason: "null or array hole" });
      continue;
    }
    if (name && seen.has(name)) {
      dropped.push({ index: i, name, reason: "duplicate tool name" });
      continue;
    }
    try {
      const [validated] = validateToolSchemas([entry]);
      kept.push(validated);
      if (validated.function.name) seen.add(validated.function.name);
    } catch (err) {
      dropped.push({
        index: i,
        name: name || null,
        reason: err instanceof Error ? err.message.split("\n")[0] : "invalid schema",
      });
    }
  }

  return { tools: kept, dropped };
}

/**
 * Decide the next tools payload to try after a failure.
 *
 *   attempt 0 → original tools (caller has already sent this)
 *   attempt 1 → sanitized tools (bad entries removed)
 *   attempt 2 → undefined (no tools — safe default, model answers from context)
 *
 * When the sanitized list is empty at attempt 1 we skip straight to the
 * safe-default attempt.
 */
export function nextRetryTools(
  attempt: number,
  original: unknown,
): {
  tools: ToolFunctionSchema[] | undefined;
  strategy: "sanitized" | "safe-default" | "stop";
  dropped: SanitizedTools["dropped"];
} {
  if (attempt === 1) {
    const { tools, dropped } = sanitizeToolsForRetry(original);
    if (tools.length === 0) return { tools: undefined, strategy: "safe-default", dropped };
    return { tools, strategy: "sanitized", dropped };
  }
  if (attempt === 2) return { tools: undefined, strategy: "safe-default", dropped: [] };
  return { tools: undefined, strategy: "stop", dropped: [] };
}

export const MAX_TOOLS_RETRY_ATTEMPTS = 2;
