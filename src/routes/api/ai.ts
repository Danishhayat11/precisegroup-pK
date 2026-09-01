
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { validateToolArgs } from "@/lib/erpBotValidation";
import { assertToolSchemas } from "@/lib/aiToolSchemas";
import {
  isToolsRelatedError,
  nextRetryTools,
  MAX_TOOLS_RETRY_ATTEMPTS,
} from "@/lib/aiGatewayRetry";
import { buildToolTrace } from "@/lib/erpBotTrace";

const MAX_BODY_BYTES = 8 * 1024 * 1024; // allow image attachments
const ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
// Upgraded to Gemini 2.5 Pro for deeper multi-step reasoning, richer error
// detection, and OpenAI-grade guided mentorship. Rounds bumped so the model
// can chain 8–16 tool calls (search → drill-in → cross-check → propose).
const MODEL = process.env.PRECISE_ASSISTANT_MODEL || "google/gemini-2.5-pro";
const MAX_TOOL_ROUNDS = 16;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  tool_call_id?: string;
  tool_calls?: any;
};

async function getAuthedSupabase(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return { error: "Unauthorized" as const, status: 401 };
  const token = authHeader.slice(7).trim();
  if (!token || token.split(".").length !== 3)
    return { error: "Unauthorized" as const, status: 401 };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { error: "Auth not configured" as const, status: 500 };
  const supabase = createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { error: "Unauthorized" as const, status: 401 };
  // Resolve roles for role-gated tools.
  const { data: rolesData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.claims.sub);
  const roles = (rolesData ?? []).map((r: any) => String(r.role));
  const isAdmin = roles.includes("admin");
  return { supabase, userId: data.claims.sub as string, roles, isAdmin };
}

/* ───────────────── ERP TOOLS ─────────────────
   These let the assistant pull any data on demand instead of relying on
   a fixed snapshot. RLS applies (user's bearer token is forwarded).      */

// Wrapped in `assertToolSchemas` so any stray comma / undefined hole /
// missing name / duplicate throws at module load, long before the value
// is sent to the AI gateway. Full ruleset in src/lib/aiToolSchemas.ts.
const TOOL_SCHEMAS = assertToolSchemas([
  {
    type: "function",
    function: {
      name: "search_bookings",
      description:
        "Search bookings by client name, CNIC, mobile, unit number, or booking_id. Returns up to 15 matches with key financials.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Free-text search (name, unit, cnic, mobile, booking_id)",
          },
          status: {
            type: "string",
            description: "Optional booking_status filter (e.g. Active, Cancelled, Possessed)",
          },
          limit: { type: "number", description: "Max rows (default 15, max 30)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_booking_detail",
      description:
        "Full detail for a single booking including financials, overdue, contact, project, unit, address.",
      parameters: {
        type: "object",
        properties: { booking_id: { type: "string" } },
        required: ["booking_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_payments",
      description:
        "Get payment history. Filter by booking_id OR date range OR mode (Cash/Bank/Adjustment).",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string" },
          from: { type: "string", description: "ISO date YYYY-MM-DD" },
          to: { type: "string", description: "ISO date YYYY-MM-DD" },
          mode: { type: "string", description: "Cash | Bank | Adjustment" },
          limit: { type: "number", description: "Default 25, max 100" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ledger",
      description:
        "Installment ledger rows for a booking with due date, due amount, paid, balance, status, days overdue.",
      parameters: {
        type: "object",
        properties: { booking_id: { type: "string" } },
        required: ["booking_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_overdue_clients",
      description:
        "Top overdue clients sorted by overdue amount. Optional minimum days overdue filter.",
      parameters: {
        type: "object",
        properties: {
          min_days: {
            type: "number",
            description: "Only show installments overdue >= this many days",
          },
          risk_level: { type: "string", description: "HIGH or MEDIUM" },
          limit: { type: "number", description: "Default 15" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_portfolio_kpis",
      description:
        "Live portfolio KPIs: total sell value, cash received, adjustments, pending, overdue, counts.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_adjustments",
      description:
        "List adjustment entries (optionally filtered by booking_id) with approved value and reason.",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string" },
          limit: { type: "number", description: "Default 25" },
        },
      },
    },
  },

  // ── ANNOTATE (immediate, logged) ─────────────────────────
  {
    type: "function",
    function: {
      name: "add_payment_comment",
      description:
        "Attach a comment/note to a payment receipt. Immediate, safe — does not change any financial figure. Use for context, follow-ups, or edit requests flagged for admins.",
      parameters: {
        type: "object",
        properties: {
          receipt_no: { type: "string" },
          comment_text: { type: "string" },
          kind: { type: "string", description: "note | edit_request (default note)" },
        },
        required: ["receipt_no", "comment_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_document_reviewed",
      description:
        "Mark a booking_documents row as reviewed by the current user. Adds a review timestamp; never mutates content.",
      parameters: {
        type: "object",
        properties: { document_id: { type: "string" } },
        required: ["document_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rollback_erp_action",
      description:
        "Undo a previous ERP change the assistant made in this session. Pass the action_id from a prior tool result's _diff block. Only the user who made the original change can roll it back, and each action can only be reverted once.",
      parameters: {
        type: "object",
        properties: {
          action_id: {
            type: "string",
            description:
              "The uuid returned as _diff.action_id from a prior add_payment_comment or mark_document_reviewed call.",
          },
          reason: {
            type: "string",
            description:
              "Short human justification, e.g. 'wrong receipt' or 'user typo'. Required for the audit trail.",
          },
        },
        required: ["action_id", "reason"],
      },
    },
  },
  // ── PROPOSE (never executes; returns a proposal payload for UI confirmation) ─
  {
    type: "function",
    function: {
      name: "propose_log_payment",
      description:
        "Propose a new payment to log. ALWAYS requires user confirmation in the UI — this only builds a proposal, never writes.",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string" },
          amount: { type: "number" },
          payment_date: { type: "string", description: "YYYY-MM-DD" },
          payment_mode: { type: "string" },
          payment_head: { type: "string" },
          account: { type: "string" },
          cheque_txn_no: { type: "string" },
          remarks: { type: "string" },
          evidence_image_ref: {
            type: "string",
            description: "Reference to a slip image the user attached, if any",
          },
        },
        required: ["booking_id", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_split_payment",
      description:
        "Propose a single payment split across multiple heads/ledger rows. UI must confirm before anything is written.",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string" },
          total_amount: { type: "number" },
          payment_date: { type: "string" },
          payment_mode: { type: "string" },
          allocations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                head_label: {
                  type: "string",
                  description: "e.g. Possession, Installment 3, Down Payment",
                },
                amount: { type: "number" },
                installment_term_no: {
                  type: "number",
                  description: "Optional — term_no of the ledger row this slice targets",
                },
              },
              required: ["head_label", "amount"],
            },
          },
          remarks: { type: "string" },
        },
        required: ["booking_id", "total_amount", "allocations"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_bulk_reminders",
      description:
        "Propose a batch of WhatsApp/SMS reminders for overdue clients. UI confirms; nothing is sent by this tool.",
      parameters: {
        type: "object",
        properties: {
          risk_level: { type: "string", description: "HIGH | MEDIUM | ALL" },
          min_days: { type: "number" },
          message_template: { type: "string" },
        },
      },
    },
  },
  // ── ADMIN-ONLY PROPOSALS ─────────────────────────────────
  {
    type: "function",
    function: {
      name: "propose_edit_payment",
      description:
        "Admin-only. Propose an edit to an existing payment. Requires a reason and UI confirmation.",
      parameters: {
        type: "object",
        properties: {
          receipt_no: { type: "string" },
          fields: {
            type: "object",
            description:
              "Object of fields to change (amount, payment_date, payment_mode, payment_head, remarks)",
          },
          reason: { type: "string" },
        },
        required: ["receipt_no", "fields", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_restructure_plan",
      description:
        "Admin-only. Propose a new installment schedule for a booking. Only future/unpaid rows are affected; UI confirms.",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string" },
          new_schedule: {
            type: "array",
            items: {
              type: "object",
              properties: {
                term_no: { type: "number" },
                due_date: { type: "string" },
                due_amount: { type: "number" },
                particulars: { type: "string" },
              },
              required: ["due_date", "due_amount"],
            },
          },
          reason: { type: "string" },
        },
        required: ["booking_id", "new_schedule", "reason"],
      },
    },
  },
]);

const ADMIN_ONLY_TOOLS = new Set(["propose_edit_payment", "propose_restructure_plan"]);

const BOOKING_COLS =
  "booking_id,client_name,cnic,mobile,project_name,unit_id,floor,total_contract_value,cash_received,adjustment_credit,remaining_balance,current_overdue_count,total_overdue_amount,risk_level,booking_status,address";

/**
 * Append a row to erp_action_log so the UI can render a before/after
 * diff card and offer one-click rollback. Silent on failure — the audit
 * log is best-effort and MUST NOT block the primary write from returning.
 */
async function logAction(
  supabase: ReturnType<typeof createClient>,
  ctx: { userId: string },
  row: {
    tool_name: string;
    target_kind: string;
    target_id: string;
    args: unknown;
    before_state: unknown;
    after_state: unknown;
  },
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("erp_action_log")
      .insert({
        user_id: ctx.userId,
        tool_name: row.tool_name,
        target_kind: row.target_kind,
        target_id: row.target_id,
        args: row.args as any,
        before_state: row.before_state as any,
        after_state: row.after_state as any,
      } as any)
      .select("id")
      .maybeSingle();
    if (error) return null;
    return (data as any)?.id ?? null;
  } catch {
    return null;
  }
}

async function executeTool(
  name: string,
  args: any,
  supabase: ReturnType<typeof createClient>,
  ctx: { isAdmin: boolean; userId: string },
): Promise<any> {
  const adminOnly = ADMIN_ONLY_TOOLS.has(name);
  if (adminOnly && !ctx.isAdmin) {
    const result = {
      error: "admin_required",
      message: `${name} requires Admin role. Suggest add_payment_comment(kind="edit_request") instead so an admin can review.`,
    };
    return withTrace(name, args, { isAdmin: ctx.isAdmin, adminOnly, gateBlocked: false }, result);
  }
  // Validation gate — blocks every mutating / proposing tool when the
  // model omits required fields or supplies contradictory inputs.
  // Read-only lookups (search_bookings, get_*, etc.) skip the gate
  // because `validateToolArgs` returns { ok: true } for un-gated names.
  const gate = validateToolArgs(name, args);
  if ("error" in gate) {
    return withTrace(
      name,
      args,
      {
        isAdmin: ctx.isAdmin,
        adminOnly,
        gateBlocked: true,
        gateHint: gate.hint,
        gateMissing: gate.missing,
        gateInconsistencies: gate.inconsistencies,
      },
      gate,
    );
  }
  const result = await runToolBody(name, args, supabase, ctx);
  return withTrace(name, args, { isAdmin: ctx.isAdmin, adminOnly, gateBlocked: false }, result);
}

function withTrace(
  name: string,
  args: any,
  tctx: Parameters<typeof buildToolTrace>[2],
  result: any,
) {
  const trace = buildToolTrace(name, args, tctx, result);
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...result, _trace: trace };
  }
  return { value: result, _trace: trace };
}

async function runToolBody(
  name: string,
  args: any,
  supabase: ReturnType<typeof createClient>,
  ctx: { isAdmin: boolean; userId: string },
): Promise<any> {
  try {
    switch (name) {
      case "search_bookings": {
        const q = String(args?.query ?? "").trim();
        const limit = Math.min(Math.max(Number(args?.limit ?? 15), 1), 30);
        if (!q) return { error: "query is required" };
        let qb = supabase.from("bookings").select(BOOKING_COLS).limit(limit);
        // Escaping commas and parentheses prevents user input from injecting
        // extra filter clauses into the PostgREST `.or()` string.
        const escaped = q.replace(/([,()])/g, "\\$1");
        const term = `%${escaped}%`;
        qb = qb.or(
          `client_name.ilike.${term},cnic.ilike.${term},mobile.ilike.${term},unit_id.ilike.${term},booking_id.ilike.${term}`,
        );
        if (args?.status) qb = qb.eq("booking_status", args.status);
        const { data, error } = await qb;
        if (error) return { error: error.message };
        return { count: data?.length ?? 0, rows: data ?? [] };
      }
      case "get_booking_detail": {
        const id = String(args?.booking_id ?? "");
        if (!id) return { error: "booking_id required" };
        const { data, error } = await supabase
          .from("bookings")
          .select("*")
          .eq("booking_id", id)
          .maybeSingle();
        if (error) return { error: error.message };
        if (!data) return { error: "Booking not found" };
        return data;
      }
      case "get_payments": {
        const limit = Math.min(Math.max(Number(args?.limit ?? 25), 1), 100);
        let qb = supabase
          .from("payments")
          .select(
            "receipt_no,booking_id,payment_date,client_name,amount,payment_mode,payment_head,account,non_cash_adjustment,remarks",
          )
          .order("payment_date", { ascending: false })
          .limit(limit);
        if (args?.booking_id) qb = qb.eq("booking_id", args.booking_id);
        if (args?.from) qb = qb.gte("payment_date", args.from);
        if (args?.to) qb = qb.lte("payment_date", args.to);
        if (args?.mode) {
          if (String(args.mode).toLowerCase() === "adjustment")
            qb = qb.eq("non_cash_adjustment", true);
          else qb = qb.ilike("payment_mode", String(args.mode));
        }
        const { data, error } = await qb;
        if (error) return { error: error.message };
        return { count: data?.length ?? 0, rows: data ?? [] };
      }
      case "get_ledger": {
        const id = String(args?.booking_id ?? "");
        if (!id) return { error: "booking_id required" };
        const { data, error } = await supabase
          .from("installment_ledger")
          .select(
            "term_no,particulars,due_date,due_amount,paid_amount,paid_date,running_balance,status,days_overdue,aging_level",
          )
          .eq("booking_id", id)
          .order("term_no", { ascending: true });
        if (error) return { error: error.message };
        return { count: data?.length ?? 0, rows: data ?? [] };
      }
      case "get_overdue_clients": {
        const limit = Math.min(Math.max(Number(args?.limit ?? 15), 1), 50);
        let qb = supabase
          .from("bookings")
          .select(
            "booking_id,client_name,mobile,unit_id,project_name,total_overdue_amount,current_overdue_count,risk_level,remaining_balance",
          )
          .gt("total_overdue_amount", 0)
          .order("total_overdue_amount", { ascending: false })
          .limit(limit);
        if (args?.risk_level) qb = qb.eq("risk_level", String(args.risk_level).toUpperCase());
        const { data, error } = await qb;
        if (error) return { error: error.message };
        let rows = data ?? [];
        if (args?.min_days) {
          const minDays = Number(args.min_days);
          const ids = rows.map((r: any) => r.booking_id);
          if (ids.length) {
            const { data: led } = await supabase
              .from("installment_ledger")
              .select("booking_id,days_overdue")
              .in("booking_id", ids)
              .gte("days_overdue", minDays);
            const keep = new Set((led ?? []).map((l: any) => l.booking_id));
            rows = rows.filter((r: any) => keep.has(r.booking_id));
          }
        }
        return { count: rows.length, rows };
      }
      case "get_portfolio_kpis": {
        // Walk all bookings with .range() so PostgREST's 1000-row cap can't
        // silently truncate the portfolio aggregation.
        const cols =
          "total_contract_value,cash_received,adjustment_credit,remaining_balance,total_overdue_amount,current_overdue_count,booking_status,risk_level";
        const PAGE = 1000;
        const rows: any[] = [];
        for (let from = 0; from < 200_000; from += PAGE) {
          const { data, error } = await supabase
            .from("bookings")
            .select(cols)
            .order("booking_id", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) return { error: error.message };
          const page = data ?? [];
          rows.push(...page);
          if (page.length < PAGE) break;
        }
        const sum = (k: string) => rows.reduce((s, r: any) => s + Number(r[k] ?? 0), 0);
        return {
          activeBookings: rows.filter(
            (r: any) => (r.booking_status ?? "").toLowerCase() !== "cancelled",
          ).length,
          totalSellValue: sum("total_contract_value"),
          totalCashReceived: sum("cash_received"),
          totalAdjustmentAllowed: sum("adjustment_credit"),
          totalReceived: sum("cash_received") + sum("adjustment_credit"),
          totalPending: sum("remaining_balance"),
          totalOverdue: sum("total_overdue_amount"),
          overdueClientCount: rows.filter((r: any) => Number(r.total_overdue_amount ?? 0) > 0)
            .length,
          highRiskCount: rows.filter((r: any) => r.risk_level === "HIGH").length,
          mediumRiskCount: rows.filter((r: any) => r.risk_level === "MEDIUM").length,
          scannedBookings: rows.length,
        };
      }
      case "get_adjustments": {
        const limit = Math.min(Math.max(Number(args?.limit ?? 25), 1), 100);
        let qb = supabase.from("adjustments").select("*").limit(limit);
        if (args?.booking_id) qb = qb.eq("booking_id", args.booking_id);
        const { data, error } = await qb;
        if (error) return { error: error.message };
        return { count: data?.length ?? 0, rows: data ?? [] };
      }
      // ── ANNOTATE (execute immediately) ─────────────────
      case "add_payment_comment": {
        const receipt_no = String(args?.receipt_no ?? "").trim();
        const comment_text = String(args?.comment_text ?? "").trim();
        const kind = String(args?.kind ?? "note").trim();
        if (!receipt_no || !comment_text) return { error: "receipt_no and comment_text required" };
        const { data: pay } = await supabase
          .from("payments")
          .select("booking_id")
          .eq("receipt_no", receipt_no)
          .maybeSingle();
        // Snapshot the receipt's current comment ledger BEFORE the insert
        // so rollback has a diff to compare against.
        const { data: existingBefore } = await supabase
          .from("payment_comments")
          .select("id,kind,body,created_at")
          .eq("payment_receipt_no", receipt_no)
          .order("created_at", { ascending: false })
          .limit(3);
        const beforeState = {
          receipt_no,
          existing_comment_count: (existingBefore ?? []).length,
          most_recent_comments: existingBefore ?? [],
        };
        const { data: inserted, error } = await supabase
          .from("payment_comments")
          .insert({
            payment_receipt_no: receipt_no,
            booking_id: (pay as any)?.booking_id ?? null,
            body: comment_text,
            kind,
            created_by: ctx.userId,
            company_id: (pay as any)?.company_id ?? "",
            source: "ai_assistant",
            status: "open",
          } as any)
          .select("id,payment_receipt_no,kind,body,created_at")
          .maybeSingle();
        if (error) return { error: error.message };
        const commentId = (inserted as any)?.id ?? null;
        const afterState = { comment_id: commentId, kind, comment_text, receipt_no };
        const actionId = await logAction(supabase, ctx, {
          tool_name: name,
          target_kind: "payment_comment",
          target_id: String(commentId ?? receipt_no),
          args,
          before_state: beforeState,
          after_state: afterState,
        });
        return {
          ok: true,
          receipt_no,
          kind,
          message: "Comment added.",
          _diff: {
            action_id: actionId,
            tool: name,
            target: `Receipt ${receipt_no}`,
            before: beforeState,
            after: afterState,
            rollback_hint: "Deletes the newly-added comment row.",
          },
        };
      }
      case "mark_document_reviewed": {
        const id = String(args?.document_id ?? "").trim();
        if (!id) return { error: "document_id required" };
        // Capture whatever review state existed on the row before we stamp it.
        const { data: docBefore } = await supabase
          .from("booking_documents")
          .select("id,status,updated_at")
          .eq("id", id)
          .maybeSingle();
        const beforeState = {
          document_id: id,
          status: (docBefore as any)?.status ?? null,
          updated_at: (docBefore as any)?.updated_at ?? null,
        };
        const now = new Date().toISOString();
        const { error } = await (supabase.from("booking_documents") as any)
          .update({ status: "reviewed", updated_at: now })
          .eq("id", id);
        if (error) return { error: error.message };
        const afterState = { document_id: id, status: "reviewed", updated_at: now };
        const actionId = await logAction(supabase, ctx, {
          tool_name: name,
          target_kind: "booking_document",
          target_id: id,
          args,
          before_state: beforeState,
          after_state: afterState,
        });
        return {
          ok: true,
          document_id: id,
          _diff: {
            action_id: actionId,
            tool: name,
            target: `Document ${id}`,
            before: beforeState,
            after: afterState,
            rollback_hint: beforeState.status
              ? "Restores the previous document status."
              : "Clears document status back to null.",
          },
        };
      }
      case "rollback_erp_action": {
        const actionId = String(args?.action_id ?? "").trim();
        const reason = String(args?.reason ?? "").trim();
        if (!actionId) return { error: "action_id is required" };
        if (reason.length < 3) return { error: "reason is required (min 3 chars)" };
        // RLS scopes this to rows the caller owns, so we cannot roll back
        // someone else's action even by guessing the id.
        const { data: row, error: loadErr } = await supabase
          .from("erp_action_log")
          .select("id,tool_name,target_kind,target_id,args,before_state,after_state,rolled_back_at")
          .eq("id", actionId)
          .maybeSingle();
        if (loadErr) return { error: loadErr.message };
        if (!row) return { error: "action_id not found for this user" };
        if ((row as any).rolled_back_at)
          return { error: "This action has already been rolled back." };
        const before = (row as any).before_state ?? {};
        const after = (row as any).after_state ?? {};
        const targetKind = String((row as any).target_kind);
        let reverted: Record<string, unknown> = {};
        try {
          if (targetKind === "payment_comment") {
            const commentId = String(after?.comment_id ?? (row as any).target_id ?? "");
            if (!commentId) return { error: "cannot rollback: original comment_id missing" };
            const { error: delErr } = await supabase
              .from("payment_comments")
              .delete()
              .eq("id", commentId);
            if (delErr) return { error: `rollback failed: ${delErr.message}` };
            reverted = { deleted_comment_id: commentId };
          } else if (targetKind === "booking_document") {
            const { error: updErr } = await (supabase.from("booking_documents") as any)
              .update({
                reviewed_at: before?.reviewed_at ?? null,
                reviewed_by: before?.reviewed_by ?? null,
              })
              .eq("id", String(before?.document_id ?? (row as any).target_id));
            if (updErr) return { error: `rollback failed: ${updErr.message}` };
            reverted = {
              restored_document_id: before?.document_id,
              reviewed_at: before?.reviewed_at ?? null,
            };
          } else {
            return { error: `Rollback not supported for target_kind="${targetKind}"` };
          }
        } catch (e: any) {
          return { error: `rollback failed: ${e?.message ?? e}` };
        }
        const { error: markErr } = await (supabase.from("erp_action_log") as any)
          .update({
            rolled_back_at: new Date().toISOString(),
            rollback_reason: reason,
            rollback_by: ctx.userId,
          })
          .eq("id", actionId);
        if (markErr)
          return { error: `rollback executed but audit update failed: ${markErr.message}` };
        return {
          ok: true,
          rolled_back: true,
          action_id: actionId,
          tool: (row as any).tool_name,
          reverted,
          reason,
        };
      }
      // ── PROPOSALS (never write; return proposal for UI confirm) ─
      case "propose_log_payment":
      case "propose_split_payment":
      case "propose_bulk_reminders":
      case "propose_edit_payment":
      case "propose_restructure_plan": {
        return {
          proposed: true,
          action: name.replace(/^propose_/, ""),
          admin_only: ADMIN_ONLY_TOOLS.has(name),
          payload: args,
          note: "This is a proposal only. The user must confirm it in the app before anything is written.",
        };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}

function systemForMode(mode: string, snapshot: any, roleCtx?: { isAdmin: boolean }) {
  const ctx = JSON.stringify(snapshot ?? {}, null, 2);
  const isAdmin = !!roleCtx?.isAdmin;

  if (mode === "assistant") {
    return `You are **Precise Assistant** — the AI brain of the Precise Realtors & Builders ERP (Manal Arcade, B-17 Islamabad).
You are simultaneously a CA-grade real-estate accountant, a Pakistani property-law advisor (Transfer of Property Act, Registration Act, Stamp Act, Islamabad CDA by-laws, sales-tax on immovable property, withholding under section 236C/236K), an ERP data analyst, and a patient senior mentor.

Behave like a world-class OpenAI-grade assistant:
  • Think end-to-end. Never stop at the surface — chain multiple tool calls until you have a defensible answer.
  • Catch user mistakes BEFORE executing. If the user's request is ambiguous, inconsistent, arithmetically wrong, financially risky, legally shaky, or violates a business rule, STOP and explain the issue in one short paragraph, show the correct interpretation, and ask a single clarifying question. Do NOT silently "do your best" on a broken instruction.
  • Teach as you work. When you take a non-trivial action, briefly explain WHY in one line ("Using FIFO because no manual allocation on file"). New users should learn the ERP just by talking to you.
  • Volunteer next steps. After every answer, propose 1–3 concrete follow-ups the user is likely to want ("Want me to draft the reminder?", "Shall I open the ledger?", "Want the 90-day cashflow forecast?").
  • Be exhaustive on request. When the user says "explain fully / walk me through / step by step", produce a numbered, exhaustive walkthrough covering: inputs used, tool calls made, formula, edge cases considered, alternatives rejected, and the final answer.
  • EVERY tool response now includes a "_trace" field with numbered steps ({phase, action, assumption, verification, outcome}). Read it. When the user asks "why?", "how do you know?", "explain your reasoning", or when a tool is BLOCKED, quote the relevant trace steps verbatim as a numbered list — each line as "Step N (phase): <assumption>. Verified: <verification>." Never fabricate reasoning that the trace does not support. Do not leak the raw _trace JSON — render it as prose.

You have LIVE TOOL ACCESS to the ERP database. ALWAYS use tools to look up the latest data — NEVER fabricate client names, booking IDs, units, receipts, or numbers. If a tool returns 0 rows, say so honestly and suggest a broader search.

USER ROLE: ${isAdmin ? "Admin" : "Staff"}. ${
      isAdmin
        ? "You may propose admin-only actions (propose_edit_payment, propose_restructure_plan). Still require confirmation via the proposal card."
        : "You MUST NOT call propose_edit_payment or propose_restructure_plan. If the user asks, respond: 'Plan restructuring / payment edits need Admin access. I can flag this for an admin as a comment — want me to?' and offer add_payment_comment(kind=\"edit_request\") instead."
    }

CURRENCY: PKR with commas (e.g. PKR 1,234,567). Summaries use Pakistani words — Lac and Crore — never Million/Billion.

READ TOOLS (immediate):
  • search_bookings, get_booking_detail, get_payments, get_ledger
  • get_overdue_clients, get_portfolio_kpis, get_adjustments
ANNOTATE TOOLS (immediate, logged, safe — never change financials):
  • add_payment_comment(receipt_no, comment_text, kind?)
  • mark_document_reviewed(document_id)
PROPOSAL TOOLS (never execute — build a proposal the user confirms in the app):
  • propose_log_payment, propose_split_payment, propose_bulk_reminders
  • propose_edit_payment, propose_restructure_plan   (ADMIN only)

BUSINESS RULES — always ground answers in these AND flag when the user's ask contradicts them:
  1. FIFO ALLOCATION: cash payments clear the OLDEST unpaid ledger row first, unless the payment was manually split across specific heads via payment_allocations.
  2. ADJUSTMENT CREDIT (asset-based down payment) is applied as a lump sum up front and is NEVER mixed into the FIFO cash sequence.
  3. OVERDUE = an installment whose due_date has passed AND remains unpaid. Never label a client overdue based on total remaining balance alone.
  4. TOTAL RECEIVED formula = cash_received + adjustment_credit − commission_paid.
  5. When asked to EXPLAIN a balance or status, walk through the FIFO logic in plain language using the client's actual receipts and ledger rows.
  6. Never log a payment greater than the remaining balance without warning the user of the overpayment and asking how to allocate the excess.
  7. Never propose editing a payment older than 30 days without stating the audit implication.

CONVERSATION MEMORY: A separate system message titled "PERSISTENT CONVERSATION MEMORY" may be present. Treat it as ground truth for entities the user has already referenced (booking_ids, receipt_nos, client names, CNICs, units, documents) and honour its "Current focus". When a user turn uses a pronoun ("him", "her", "that client", "the receipt"), a demonstrative ("this booking", "same one"), or a bare first name, resolve it against memory. If — and ONLY if — the memory block also contains an "AMBIGUITY DETECTED" section, or you cannot resolve the reference to a single entity with confidence, STOP and ask ONE crisp follow-up question that names 2–4 concrete candidate entities (with booking_id / receipt_no) for the user to pick from. Do NOT call any tool until the user answers. Never fabricate an ID that is not in memory or in a tool result.

MISTAKE-GUIDANCE PATTERNS (use verbatim tone, adapt content):
  • Wrong client match: "I found 3 clients matching 'Adil' — you probably mean Adil Khan (BK-MA-00015). Confirm before I proceed?"
  • Amount mismatch on slip vs stated: "The slip reads PKR 4,50,000 but you said 5,00,000. Which is correct? I'll use the slip unless you say otherwise."
  • Duplicate payment risk: "A payment of PKR X on the same date already exists (Receipt R-####). Are you logging a second one, or is this the same?"
  • Overdue math check: "Days overdue is calculated from due_date, not booking_date — that's why the number differs from what you expected."
  • Legal ask without doc: "A legal notice needs a signed booking form on file — I don't see one uploaded for this booking. Want me to flag Document Center?"

MULTI-STEP REASONING: for open-ended analytical questions ("which clients deserve a restructure vs a legal notice?") chain multiple READ tools in one turn — get_overdue_clients, then get_payments + get_ledger for each candidate — before answering with a ranked recommendation and the reasoning. Do not answer such questions from a single tool call.

VISION: when the user attaches an image (bank slip, cheque, transfer screenshot), read it directly: extract amount, date, reference number, bank name, account. Cross-check the extracted amount against the client's outstanding ledger and flag mismatches. Then call propose_log_payment (or propose_split_payment) pre-filled with the extracted values, with evidence_image_ref: "user-attached-image". Confirm extracted numbers to the user in plain text before AND after the proposal.

ANSWERING:
  • If the user names a client/unit/CNIC, FIRST call search_bookings, then drill in.
  • For "top defaulters" → get_overdue_clients. For company-wide → get_portfolio_kpis.
  • Render lists as compact markdown tables.
  • WhatsApp drafts: start "Assalam o Alaikum", real numbers, end "— Precise Realtors & Builders", inside a fenced code block.
  • Legal notices: reference actual booking_id + unit, suggest matching Document Center template.
  • Never reveal "adjustment realized" in client-facing drafts.
  • Default to concise (tables + bullets). Expand into full step-by-step ONLY when asked or when the user is clearly learning / troubleshooting.

PROPOSAL OUTPUT FORMAT: after any propose_* tool returns, ALWAYS include a fenced block using the language tag \`proposal\` containing the exact JSON the tool returned (action, admin_only, payload). Then add a short plain-language summary of what will change, why it's correct, and any risk the user should know. The app renders this fence as a confirmation card with an Open button — do not describe buttons in prose.

DIFF & ROLLBACK FORMAT: after ANY tool response that includes a \`_diff\` field (add_payment_comment, mark_document_reviewed, or rollback_erp_action), ALWAYS emit a fenced block with the language tag \`diff\` containing the exact _diff JSON (action_id, tool, target, before, after, rollback_hint). The app renders this fence as a before/after card with a one-click **Undo** button — do NOT describe the button in prose. After the fence, add 1–2 sentences summarising what changed and inviting the user to undo if it was a mistake. When the user asks to undo, revert, or roll back a specific change, call rollback_erp_action with the action_id from the most recent matching diff fence in this conversation and a short reason quoting the user's justification.

VALIDATION FAILURE FORMAT: whenever a tool response is \`{ "error": "validation_failed", ... }\`, ALWAYS emit a fenced block with the language tag \`validation\` containing the exact JSON (tool, missing, inconsistencies, hint) and NOTHING else inside the fence. The app renders this fence as a red-bordered card listing the missing fields, inconsistencies, and next-step hint — do NOT paraphrase the fields in prose or hide them behind a generic apology. After the fence, add ONE short sentence asking the user for the specific missing values (quote the field names verbatim). Do NOT retry the same tool until the user supplies them.

Example:
\`\`\`validation
{"tool":"propose_log_payment","missing":["amount","paid_on"],"inconsistencies":[],"hint":"Ask the user for: amount, paid_on. Do NOT retry propose_log_payment until every required field is confirmed."}
\`\`\`
Could you share the **amount** and **paid_on** date for this payment?


Example:
\`\`\`proposal
{"action":"log_payment","admin_only":false,"payload":{"booking_id":"BK-MA-00015","amount":500000,"paid_on":"2026-06-30","mode":"bank","reference":"TRX88291","bank":"Al Habib"}}
\`\`\`
I extracted PKR 5,00,000 from the slip dated 30-Jun-2026 (Ref TRX88291, Al Habib Bank). Under FIFO this will clear Installment 3 (PKR 3,50,000 overdue by 42 days) and PKR 1,50,000 of Installment 4. Open the card to review and log against Adil (BK-MA-00015).

INITIAL DASHBOARD CONTEXT (hint only — trust tools for real numbers):
${ctx}`;
  }

  const base = `You are the AI analyst inside the Precise Realtors & Builders ERP for Manal Arcade.
Currency: PKR. Use Pakistani Lac/Crore. Answer only from the snapshot below.

Dashboard snapshot:
${ctx}`;

  switch (mode) {
    case "insights":
      return `${base}

Write 4 short bullets (max 18 words each): headline recoveries · worst overdue client · one action this week · positive trend. Markdown only.`;
    case "forecast":
      return `${base}

Return a SHORT risk forecast: one-line portfolio risk (Low/Moderate/Elevated/High) with reasoning, then a markdown table of top 5 likely-to-slip clients (Client, Unit, Overdue PKR, 30-day Risk, Why).`;
    case "draft":
      return `${base}

Draft a firm WhatsApp reminder (English + 1 line Urdu courtesy) under 90 words for the snapshot "target" client. Include unit, overdue count, PKR amount. End "— Precise Realtors & Builders". Plain text.`;
    default:
      return `${base}\n\nChat mode — concise answers, never invent data.`;
  }
}

async function callGatewayOnce(messages: Msg[], tools: any[] | undefined, stream: boolean) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured.");
  const body: any = { model: MODEL, messages, stream };
  // Defensive: drop any nullish/holey entries so a stray array hole
  // in TOOL_SCHEMAS can never poison the gateway request.
  const cleanTools = Array.isArray(tools)
    ? tools.filter((t) => t && typeof t === "object" && (t as any).function?.name)
    : undefined;
  if (cleanTools && cleanTools.length) body.tools = cleanTools;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

function errResponse(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function safeJsonForLog(value: unknown, max = 4000): unknown {
  try {
    const s = JSON.stringify(value);
    if (!s) return null;
    return s.length > max ? { _truncated: true, preview: s.slice(0, max) } : JSON.parse(s);
  } catch {
    return { _unserializable: true };
  }
}

async function logToolCall(
  supabase: any,
  userId: string,
  row: {
    request_id: string;
    round: number;
    tool_name: string | null;
    tool_args?: unknown;
    tool_result?: unknown;
    success: boolean;
    error_message?: string | null;
    duration_ms?: number | null;
    gateway_status?: number | null;
    retry_strategy?: string | null;
  },
) {
  try {
    await supabase.from("ai_tool_call_log").insert({
      user_id: userId,
      request_id: row.request_id,
      round: row.round,
      tool_name: row.tool_name,
      tool_args: row.tool_args !== undefined ? safeJsonForLog(row.tool_args) : null,
      tool_result: row.tool_result !== undefined ? safeJsonForLog(row.tool_result) : null,
      success: row.success,
      error_message: row.error_message ?? null,
      duration_ms: row.duration_ms ?? null,
      gateway_status: row.gateway_status ?? null,
      gateway_model: MODEL,
      retry_strategy: row.retry_strategy ?? null,
      in_flight: false,
      completed_at: new Date().toISOString(),
    });
  } catch (err) {
    // Never let logging failure break the chat flow.
    console.warn("[ai] logToolCall failed", err);
  }
}

/**
 * Two-phase tool-call logging. `startToolCall` inserts a row with
 * `in_flight=true` the moment the tool is dispatched, so the AI
 * Diagnostics page's "In-flight" filter can surface tool calls that are
 * still running (long-running RPCs, network stalls, or crashes that
 * never reach the completion path). On completion, `finishToolCall`
 * updates that same row with the result / duration / final status and
 * flips `in_flight=false` + sets `completed_at`.
 *
 * Both helpers swallow their own errors — telemetry must never take
 * down the chat.
 */
async function startToolCall(
  supabase: any,
  userId: string,
  row: {
    request_id: string;
    round: number;
    tool_name: string | null;
    tool_args?: unknown;
    retry_strategy?: string | null;
  },
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("ai_tool_call_log")
      .insert({
        user_id: userId,
        request_id: row.request_id,
        round: row.round,
        tool_name: row.tool_name,
        tool_args: row.tool_args !== undefined ? safeJsonForLog(row.tool_args) : null,
        success: true, // provisional; overwritten in finishToolCall
        gateway_model: MODEL,
        retry_strategy: row.retry_strategy ?? null,
        in_flight: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    return (data as any)?.id ?? null;
  } catch (err) {
    console.warn("[ai] startToolCall failed", err);
    return null;
  }
}

async function finishToolCall(
  supabase: any,
  userId: string,
  id: string | null,
  patch: {
    request_id: string;
    round: number;
    tool_name: string | null;
    tool_args?: unknown;
    tool_result?: unknown;
    success: boolean;
    error_message?: string | null;
    duration_ms?: number | null;
    gateway_status?: number | null;
    retry_strategy?: string | null;
  },
) {
  // Fallback path — if the pending insert failed we still want a terminal
  // row, so record it as a single-shot completed entry.
  if (!id) {
    await logToolCall(supabase, userId, patch);
    return;
  }
  try {
    await supabase
      .from("ai_tool_call_log")
      .update({
        tool_result: patch.tool_result !== undefined ? safeJsonForLog(patch.tool_result) : null,
        success: patch.success,
        error_message: patch.error_message ?? null,
        duration_ms: patch.duration_ms ?? null,
        gateway_status: patch.gateway_status ?? null,
        retry_strategy: patch.retry_strategy ?? null,
        in_flight: false,
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);
  } catch (err) {
    console.warn("[ai] finishToolCall failed", err);
  }
}

async function handleAssistantWithTools(
  messages: Msg[],
  supabase: any,
  ctx: { isAdmin: boolean; userId: string },
): Promise<Response> {
  const working: Msg[] = [...messages];
  const requestId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Tools-retry ladder: attempt 0 = full schemas; if the gateway rejects
    // with a tools-related 4xx we retry with a sanitized list; if that
    // still fails we drop tools entirely so the model can at least reply
    // from context. See src/lib/aiGatewayRetry.ts for the ruleset.
    let attempt = 0;
    let strategyUsed: string = "primary";
    let toolsPayload: any[] | undefined = TOOL_SCHEMAS as any[];
    let res = await callGatewayOnce(working, toolsPayload, false);

    while (!res.ok && attempt < MAX_TOOLS_RETRY_ATTEMPTS) {
      const errText = await res.text();
      if (res.status === 429) return errResponse(429, "Rate limit reached. Try again shortly.");
      if (res.status === 402)
        return errResponse(402, "AI credits exhausted. Top up the workspace.");
      if (!isToolsRelatedError(res.status, errText)) {
        await logToolCall(supabase, ctx.userId, {
          request_id: requestId,
          round,
          tool_name: null,
          success: false,
          error_message: `Gateway ${res.status}: ${errText.slice(0, 400)}`,
          gateway_status: res.status,
          retry_strategy: strategyUsed,
        });
        return errResponse(502, `Gateway error ${res.status}: ${errText.slice(0, 200)}`);
      }
      attempt++;
      const next = nextRetryTools(attempt, TOOL_SCHEMAS);
      if (next.strategy === "stop") {
        await logToolCall(supabase, ctx.userId, {
          request_id: requestId,
          round,
          tool_name: null,
          success: false,
          error_message: `Gateway ${res.status}: ${errText.slice(0, 400)}`,
          gateway_status: res.status,
          retry_strategy: strategyUsed,
        });
        return errResponse(502, `Gateway error ${res.status}: ${errText.slice(0, 200)}`);
      }
      console.warn(
        `[ai] gateway tools error (status ${res.status}); retrying with ${next.strategy}`,
        { dropped: next.dropped, hint: errText.slice(0, 200) },
      );
      // Log the failed attempt so the diagnostics page shows retry history.
      await logToolCall(supabase, ctx.userId, {
        request_id: requestId,
        round,
        tool_name: null,
        success: false,
        error_message: `Gateway ${res.status}: ${errText.slice(0, 400)} → retrying with ${next.strategy}`,
        gateway_status: res.status,
        retry_strategy: strategyUsed,
      });
      strategyUsed = next.strategy;
      toolsPayload = next.tools as any[] | undefined;
      res = await callGatewayOnce(working, toolsPayload, false);
    }

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) return errResponse(429, "Rate limit reached. Try again shortly.");
      if (res.status === 402)
        return errResponse(402, "AI credits exhausted. Top up the workspace.");
      await logToolCall(supabase, ctx.userId, {
        request_id: requestId,
        round,
        tool_name: null,
        success: false,
        error_message: `Gateway ${res.status}: ${text.slice(0, 400)}`,
        gateway_status: res.status,
        retry_strategy: strategyUsed,
      });
      return errResponse(502, `Gateway error ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const msg = json?.choices?.[0]?.message;
    if (!msg) {
      await logToolCall(supabase, ctx.userId, {
        request_id: requestId,
        round,
        tool_name: null,
        success: false,
        error_message: "Empty response from model",
        gateway_status: res.status,
        retry_strategy: strategyUsed,
      });
      return errResponse(502, "Empty response from model");
    }
    const toolCalls = msg.tool_calls as any[] | undefined;
    if (toolCalls && toolCalls.length) {
      working.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls } as Msg);
      for (const tc of toolCalls) {
        const name = tc.function?.name ?? null;
        let args: any = {};
        try {
          args = JSON.parse(tc.function?.arguments ?? "{}");
        } catch {
          /* keep empty */
        }
        // Insert the "in-flight" row BEFORE dispatching the tool so a
        // long-running / stalled / crashed handler still shows up in the
        // AI Diagnostics "In-flight" filter instead of vanishing.
        const pendingId = await startToolCall(supabase, ctx.userId, {
          request_id: requestId,
          round,
          tool_name: name,
          tool_args: args,
          retry_strategy: strategyUsed,
        });
        const start = Date.now();
        let result: any;
        let success = true;
        let errMsg: string | null = null;
        try {
          result = await executeTool(name, args, supabase, ctx);
          if (result && typeof result === "object" && "error" in result && result.error) {
            success = false;
            errMsg = String(result.error).slice(0, 400);
          }
        } catch (err) {
          success = false;
          errMsg = err instanceof Error ? err.message.slice(0, 400) : "unknown tool error";
          result = { error: errMsg };
        }
        const duration = Date.now() - start;
        await finishToolCall(supabase, ctx.userId, pendingId, {
          request_id: requestId,
          round,
          tool_name: name,
          tool_args: args,
          tool_result: result,
          success,
          error_message: errMsg,
          duration_ms: duration,
          gateway_status: res.status,
          retry_strategy: strategyUsed,
        });
        working.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result).slice(0, 18000),
        });
      }
      continue;
    }
    const text: string = msg.content ?? "";
    // Log the final assistant reply as a synthetic "reply" entry so the
    // diagnostics page can show which request produced which answer.
    await logToolCall(supabase, ctx.userId, {
      request_id: requestId,
      round,
      tool_name: "_final_reply",
      tool_result: { preview: text.slice(0, 2000) },
      success: true,
      gateway_status: res.status,
      retry_strategy: strategyUsed,
    });
    return new Response(JSON.stringify({ text }), {
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({
      text: "_I was unable to complete the lookup after several attempts. Please rephrase or narrow the question._",
    }),
    { headers: { "content-type": "application/json" } },
  );
}

async function handleStreamingChat(messages: Msg[]): Promise<Response> {
  const upstream = await callGatewayOnce(messages, undefined, true);
  if (!upstream.ok) {
    const text = await upstream.text();
    if (upstream.status === 429) return errResponse(429, "Rate limit reached. Try again shortly.");
    if (upstream.status === 402) return errResponse(402, "AI credits exhausted.");
    return errResponse(502, `Gateway error ${upstream.status}: ${text.slice(0, 200)}`);
  }
  if (!upstream.body) return errResponse(502, "No stream body");
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const out = new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        } catch {
          /* ignore */
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
  return new Response(out, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

const ALLOWED_METHODS = "POST, OPTIONS";

// Explicit CORS allowlist for the Admin AI API. The wildcard "*" is not
// permitted here because this endpoint is admin-only, forwards the caller's
// Supabase bearer token, and can trigger AI-gateway spend. Origins may be
// overridden or extended per-deploy via the ADMIN_AI_CORS_ORIGINS env var
// (comma-separated absolute origins, no trailing slash).
const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "https://precisegroup-pk.lovable.app",
  "https://id-preview--f005784b-c144-4b0f-ab61-e934f9e0b5ac.lovable.app",
  "https://project--f005784b-c144-4b0f-ab61-e934f9e0b5ac.lovable.app",
  "https://project--f005784b-c144-4b0f-ab61-e934f9e0b5ac-dev.lovable.app",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

function getAllowedOrigins(): Set<string> {
  const extra = (process.env.ADMIN_AI_CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set<string>([...DEFAULT_ALLOWED_ORIGINS, ...extra]);
}

function corsHeadersFor(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "access-control-allow-methods": ALLOWED_METHODS,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "Origin, Access-Control-Request-Headers",
  };
  const origin = request.headers.get("origin");
  if (origin && getAllowedOrigins().has(origin)) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

function methodNotAllowed(request: Request) {
  return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
    status: 405,
    headers: {
      "content-type": "application/json",
      allow: ALLOWED_METHODS,
      "cache-control": "no-store",
      ...corsHeadersFor(request),
    },
  });
}

export const Route = createFileRoute("/api/ai")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, {
          status: 204,
          headers: {
            allow: ALLOWED_METHODS,
            "cache-control": "no-store",
            ...corsHeadersFor(request),
          },
        }),

      GET: async ({ request }) => methodNotAllowed(request),
      PUT: async ({ request }) => methodNotAllowed(request),
      PATCH: async ({ request }) => methodNotAllowed(request),
      DELETE: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => {
        const auth = await getAuthedSupabase(request);
        if ("error" in auth && auth.error) return errResponse(auth.status ?? 401, auth.error);
        if (!("supabase" in auth)) return errResponse(401, "Unauthorized");
        // Admin-only endpoint: reading + drafting via the AI Assistant is
        // gated to admins server-side, not just in the UI. Non-admins get 403.
        if (!auth.isAdmin) return errResponse(403, "Admin only");

        // CI-only deterministic error injection. Gated by a constant-time
        // comparison against AI_TEST_FORCE_SECRET — when the env var is
        // unset/empty the header is ignored entirely, so production traffic
        // cannot exercise this path. Only the upstream-error statuses the
        // handler itself surfaces are forgeable here.
        const forceSecret = process.env.AI_TEST_FORCE_SECRET ?? "";
        const sentSecret = request.headers.get("x-ai-test-force-secret") ?? "";
        if (forceSecret && sentSecret) {
          const a = new TextEncoder().encode(forceSecret);
          const b = new TextEncoder().encode(sentSecret);
          let diff = a.length ^ b.length;
          for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a[i] ^ b[i];
          if (diff === 0) {
            const forced = request.headers.get("x-ai-test-force-status") ?? "";
            if (forced === "429") return errResponse(429, "Rate limit reached.");
            if (forced === "402") return errResponse(402, "AI credits exhausted.");
            if (forced === "502") return errResponse(502, "Gateway error 500: forced");
          }
        }

        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return errResponse(413, "Payload too large");
        let body: any;
        try {
          body = JSON.parse(raw);
        } catch {
          return errResponse(400, "Invalid JSON");
        }
        // Body must be a plain JSON object (not null, array, or primitive).
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          return errResponse(400, "Request body must be a JSON object");
        }

        const ALLOWED_MODES = ["insights", "forecast", "draft", "chat", "assistant"] as const;
        const rawMode = body?.mode;
        // Default unset/empty mode to "insights"; reject anything else that
        // isn't an allowed string with 400 + canonical {error:"Invalid mode"}.
        const mode =
          rawMode === undefined || rawMode === null || rawMode === ""
            ? "insights"
            : String(rawMode);
        if (!ALLOWED_MODES.includes(mode as any)) return errResponse(400, "Invalid mode");

        // Required-field validation per mode → 422 with canonical JSON error.
        const useHistory = mode === "chat" || mode === "assistant";
        const hasInstruction =
          typeof body?.instruction === "string" && body.instruction.trim().length > 0;
        const validMessages =
          Array.isArray(body?.messages) &&
          body.messages.some(
            (m: any) =>
              m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.length > 0,
          );
        if (useHistory && !validMessages && !hasInstruction) {
          return errResponse(422, "messages array is required");
        }
        if (!useHistory) {
          const snap = body?.snapshot;
          const hasSnapshot =
            snap !== undefined && snap !== null && typeof snap === "object" && !Array.isArray(snap);
          if (!hasSnapshot && !hasInstruction) {
            return errResponse(422, "snapshot or instruction is required");
          }
        }

        const snapshot = body?.snapshot ?? {};
        const sys = systemForMode(mode, snapshot, { isAdmin: (auth as any).isAdmin ?? false });

        const messages: Msg[] = [{ role: "system", content: sys }];
        // Persistent conversation memory — a compact ledger of ERP entities
        // the client has been tracking across turns (booking_ids, receipts,
        // clients, focus, plus any ambiguities the client has already
        // detected). Injected as a separate system message so it can be
        // updated per-turn without editing the main prompt.
        if (typeof body?.memoryContext === "string" && body.memoryContext.trim().length > 0) {
          messages.push({ role: "system", content: body.memoryContext.slice(0, 4000) });
        }
        if (useHistory && Array.isArray(body?.messages)) {
          const msgArr = body.messages as any[];
          for (let i = 0; i < msgArr.length; i++) {
            const m = msgArr[i];
            if (
              !m ||
              (m.role !== "user" && m.role !== "assistant") ||
              typeof m.content !== "string"
            )
              continue;
            // Attach image parts ONLY to the last user message (matches OpenAI multimodal shape).
            const isLastUser = i === msgArr.length - 1 && m.role === "user";
            const attachments =
              isLastUser && Array.isArray(body?.attachments) ? body.attachments : [];
            const imgs = attachments
              .filter(
                (a: any) =>
                  a && typeof a.dataUrl === "string" && a.dataUrl.startsWith("data:image/"),
              )
              .slice(0, 4)
              .map((a: any) => ({ type: "image_url" as const, image_url: { url: a.dataUrl } }));
            if (imgs.length) {
              const parts: ContentPart[] = [{ type: "text", text: m.content }, ...imgs];
              messages.push({ role: m.role, content: parts });
            } else {
              messages.push({ role: m.role, content: m.content });
            }
          }
        } else if (hasInstruction) {
          messages.push({ role: "user", content: body.instruction });
        } else {
          messages.push({ role: "user", content: "Generate the requested output now." });
        }

        try {
          if (mode === "assistant")
            return await handleAssistantWithTools(messages, auth.supabase, {
              isAdmin: auth.isAdmin,
              userId: auth.userId,
            });
          if (mode === "chat") return await handleStreamingChat(messages);
          // one-shot insights / forecast / draft
          const res = await callGatewayOnce(messages, undefined, false);
          if (!res.ok) {
            const text = await res.text();
            if (res.status === 429) return errResponse(429, "Rate limit reached.");
            if (res.status === 402) return errResponse(402, "AI credits exhausted.");
            return errResponse(502, `Gateway error ${res.status}: ${text.slice(0, 200)}`);
          }
          const json = await res.json();
          const text: string = json?.choices?.[0]?.message?.content ?? "";
          return new Response(JSON.stringify({ text }), {
            headers: { "content-type": "application/json" },
          });
        } catch (e: any) {
          return errResponse(500, e?.message ?? "Server error");
        }
      },
    },
  },
});
