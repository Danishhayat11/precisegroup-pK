/**
 * Pure helpers for classifying gateway-error rows and building the
 * composite `gateway_error_payload` field emitted by CSV/JSON exports
 * and the drawer's "Copy payload" button. Kept in a standalone module
 * (rather than inside the AiDiagnostics page component) so the
 * classification + payload shape can be unit-tested without spinning
 * up the whole page and its Supabase dependencies.
 */

export interface GatewayPayloadRow {
  tool_name: string | null;
  round: number;
  gateway_status: number | null;
  gateway_model: string | null;
  retry_strategy: string | null;
  error_message: string | null;
  tool_args: unknown;
  tool_result: unknown;
  success: boolean;
}

/**
 * A row is a "gateway error" if the gateway itself returned a non-2xx
 * (HTTP >= 400) OR if the tool call reported failure AND carries an
 * error_message. Success flag alone isn't enough — a successful tool
 * call with no error_message shouldn't be flagged, and an in-flight
 * row with no gateway_status shouldn't be either.
 */
export function isGatewayErrorRow(r: GatewayPayloadRow): boolean {
  return (
    (r.gateway_status != null && r.gateway_status >= 400) ||
    (r.success === false && !!r.error_message)
  );
}

export type GatewayPayloadFormat = "object" | "compact" | "pretty";

/**
 * Composite payload for gateway-error rows. Returns `null` for non-error
 * rows so downstream consumers (CSV cells, JSON fields) render an empty
 * value instead of a synthetic zero-field object.
 *
 * `format`:
 *   - "object"  → nested object (default; JSON exports keep structure)
 *   - "compact" → minified JSON string (default CSV cell shape)
 *   - "pretty"  → 2-space indented JSON string (opt-in for review)
 */
export function buildGatewayErrorPayload(
  r: GatewayPayloadRow,
  format: GatewayPayloadFormat = "object",
): unknown {
  if (!isGatewayErrorRow(r)) return null;
  const obj = {
    tool: r.tool_name,
    round: r.round,
    gateway_status: r.gateway_status,
    gateway_model: r.gateway_model,
    retry_strategy: r.retry_strategy,
    error_message: r.error_message,
    tool_args: r.tool_args,
    tool_result: r.tool_result,
  };
  if (format === "object") return obj;
  if (format === "pretty") return JSON.stringify(obj, null, 2);
  return JSON.stringify(obj);
}
