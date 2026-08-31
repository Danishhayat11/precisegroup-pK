/**
 * Curated list of security scan findings the project has reviewed.
 *
 * This mirrors the state the Lovable security scanners hold server-side
 * (see the project's security memory). It is intentionally hand-maintained
 * so the in-app "Security Issues Review" panel can render a stable,
 * auditable snapshot without requiring runtime access to the scanner API.
 *
 * When a scan surfaces a NEW finding, add an entry here with an initial
 * `status: "pending"` and a real justification once the team decides on
 * ignore vs. fix. When a finding is resolved (fix landed, scanner clears
 * it), either remove the entry or flip status to `"fixed"` and keep the
 * historical justification for the audit trail.
 */
export type SecurityFindingStatus = "pending" | "ignored" | "fixed";

export type SecurityFinding = {
  /** Stable scanner identifier — same string the scanner uses server-side. */
  id: string;
  /** Which scanner surfaced it. */
  scanner:
    | "supabase"
    | "supabase_lov"
    | "agent_security"
    | "supply_chain"
    | "connector_security_scan";
  /** Short human-readable title. */
  name: string;
  /** One-line description of the risk. */
  description: string;
  /** Severity tier reported by the scanner. */
  level: "info" | "warn" | "error";
  /** Current review outcome — drives the badge and CTA in the panel. */
  status: SecurityFindingStatus;
  /**
   * Why the current status was chosen. Required for `ignored` and `fixed`
   * so reviewers always see the reasoning behind a resolved finding.
   */
  justification: string;
  /** Optional deep-link to remediation docs. */
  link?: string;
  /** When the review decision was recorded (ISO date). */
  reviewedAt: string;
};

export const SECURITY_FINDINGS: readonly SecurityFinding[] = [
  {
    id: "SUPA_anon_security_definer_function_executable",
    scanner: "supabase",
    name: "Public Can Execute SECURITY DEFINER Function",
    description:
      "Two SECURITY DEFINER functions in the public API schema grant EXECUTE to anon: client_get_payment_by_token and client_add_note_by_token.",
    level: "warn",
    status: "ignored",
    justification:
      "By design. Both functions back the anonymous client-note share flow at /client-note/$token and are gated by an unguessable UUID stored on payments.public_note_token. The read function returns NULL if the token does not match; the write function additionally validates name/body length and caps open client notes at 5 per payment. No other SECURITY DEFINER function in `public` grants anon EXECUTE.",
    link: "https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable",
    reviewedAt: "2026-07-03",
  },
];

export function countByStatus(findings: readonly SecurityFinding[]) {
  const acc: Record<SecurityFindingStatus, number> = { pending: 0, ignored: 0, fixed: 0 };
  for (const f of findings) acc[f.status] += 1;
  return acc;
}
