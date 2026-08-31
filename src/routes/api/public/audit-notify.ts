/**
 * Public webhook that receives the "responsive-audit finished" ping from
 * `scripts/run-responsive-audit.mjs` and dispatches an alert when the run
 * introduced NEW failing (device × route) combinations vs the previous run.
 *
 * Delivery channels (both optional — silently skipped when unconfigured):
 *   • Email — via the Resend connector gateway. Requires `RESEND_API_KEY`
 *     linked into the project (Standard Connectors → Resend). Recipient is
 *     `RESPONSIVE_AUDIT_NOTIFY_EMAIL`.
 *   • Slack — via the Slack connector gateway. Requires `SLACK_API_KEY`
 *     linked into the project. Target channel from
 *     `RESPONSIVE_AUDIT_NOTIFY_SLACK_CHANNEL` (channel ID or `#name`).
 *
 * Authentication: HMAC-SHA256 over the raw request body using
 * `RESPONSIVE_AUDIT_NOTIFY_SECRET`, sent as `x-audit-signature`. The
 * `/api/public/*` prefix bypasses Lovable auth, so verifying the signature
 * inside the handler is mandatory.
 *
 * Not called from the browser — only from the audit runner or an admin tool.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const FailureSchema = z.object({
  device: z.string().min(1).max(32),
  route: z.string().min(1).max(64),
  path: z.string().min(1).max(256),
  status: z.string().min(1).max(32),
  overflowPx: z.number().finite().optional(),
  previousStatus: z.string().max(32).optional(),
});

const PayloadSchema = z.object({
  runId: z.string().min(1).max(128),
  generatedAt: z.string().min(1).max(64),
  previousRunAt: z.string().max(64).optional().nullable(),
  baseUrl: z.string().url().max(512),
  publicUrl: z.string().url().max(512).optional(),
  newFailures: z.array(FailureSchema).max(500),
  totals: z
    .object({
      ok: z.number().int().nonnegative(),
      overflow: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      error: z.number().int().nonnegative(),
    })
    .optional(),
  force: z.boolean().optional(),
});

type Payload = z.infer<typeof PayloadSchema>;

function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.RESPONSIVE_AUDIT_NOTIFY_SECRET;
  if (!secret || !header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = header.trim().toLowerCase();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

function renderPlainText(p: Payload): string {
  const lines: string[] = [];
  lines.push(`Responsive audit — ${p.newFailures.length} new failing combination(s)`);
  lines.push(`Run ${p.generatedAt}${p.previousRunAt ? ` (vs ${p.previousRunAt})` : ""}`);
  lines.push(`Base: ${p.baseUrl}`);
  lines.push("");
  for (const f of p.newFailures.slice(0, 50)) {
    const overflow = typeof f.overflowPx === "number" ? ` (+${f.overflowPx}px)` : "";
    const prev = f.previousStatus ? ` [was: ${f.previousStatus}]` : "";
    lines.push(`• ${f.device} · ${f.path} — ${f.status}${overflow}${prev}`);
  }
  if (p.newFailures.length > 50) {
    lines.push(`… and ${p.newFailures.length - 50} more.`);
  }
  if (p.publicUrl) {
    lines.push("");
    lines.push(`Dashboard: ${p.publicUrl}/responsive-audit`);
  }
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(p: Payload): string {
  const rows = p.newFailures
    .slice(0, 100)
    .map((f) => {
      const overflow = typeof f.overflowPx === "number" ? `+${f.overflowPx}px` : "—";
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-transform:capitalize">${escapeHtml(f.device)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,Menlo,monospace">${escapeHtml(f.path)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(f.previousStatus ?? "absent")}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb"><strong style="color:#b91c1c">${escapeHtml(f.status)}</strong></td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${overflow}</td>
      </tr>`;
    })
    .join("");
  const overflowMore =
    p.newFailures.length > 100
      ? `<p style="color:#6b7280;font-size:13px">…and ${p.newFailures.length - 100} more.</p>`
      : "";
  const dashLink = p.publicUrl
    ? `<p><a href="${escapeHtml(p.publicUrl)}/responsive-audit" style="color:#2563eb">Open dashboard →</a></p>`
    : "";
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111827">
    <h2 style="margin:0 0 8px">Responsive audit — ${p.newFailures.length} new failing combination(s)</h2>
    <p style="color:#6b7280;font-size:13px;margin:0 0 12px">
      Run ${escapeHtml(p.generatedAt)}${p.previousRunAt ? ` — compared to ${escapeHtml(p.previousRunAt)}` : ""}<br />
      Base: ${escapeHtml(p.baseUrl)}
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="text-align:left;border-bottom:1px solid #e5e7eb">
          <th style="padding:6px 10px">Viewport</th>
          <th style="padding:6px 10px">Route</th>
          <th style="padding:6px 10px">Previous</th>
          <th style="padding:6px 10px">Current</th>
          <th style="padding:6px 10px;text-align:right">Overflow</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${overflowMore}
    ${dashLink}
  </div>`;
}

type Delivery = {
  channel: "email" | "slack";
  status: "sent" | "skipped" | "failed";
  detail?: string;
};

async function sendEmail(p: Payload): Promise<Delivery> {
  const to = process.env.RESPONSIVE_AUDIT_NOTIFY_EMAIL;
  const lovableKey = process.env.LOVABLE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!to)
    return { channel: "email", status: "skipped", detail: "RESPONSIVE_AUDIT_NOTIFY_EMAIL not set" };
  if (!lovableKey || !resendKey) {
    return { channel: "email", status: "skipped", detail: "Resend connector not linked" };
  }
  try {
    const from =
      process.env.RESPONSIVE_AUDIT_NOTIFY_FROM ?? "Responsive Audit <onboarding@resend.dev>";
    const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `[Responsive audit] ${p.newFailures.length} new failure(s)`,
        html: renderHtml(p),
        text: renderPlainText(p),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        channel: "email",
        status: "failed",
        detail: `HTTP ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return { channel: "email", status: "sent" };
  } catch (err) {
    return {
      channel: "email",
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function sendSlack(p: Payload): Promise<Delivery> {
  const channel = process.env.RESPONSIVE_AUDIT_NOTIFY_SLACK_CHANNEL;
  const lovableKey = process.env.LOVABLE_API_KEY;
  const slackKey = process.env.SLACK_API_KEY;
  if (!channel) {
    return {
      channel: "slack",
      status: "skipped",
      detail: "RESPONSIVE_AUDIT_NOTIFY_SLACK_CHANNEL not set",
    };
  }
  if (!lovableKey || !slackKey) {
    return { channel: "slack", status: "skipped", detail: "Slack connector not linked" };
  }
  try {
    const res = await fetch("https://connector-gateway.lovable.dev/slack/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": slackKey,
      },
      body: JSON.stringify({
        channel,
        text: `Responsive audit — ${p.newFailures.length} new failing combination(s)`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `🚨 ${p.newFailures.length} new responsive failure${p.newFailures.length === 1 ? "" : "s"}`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Run \`${p.generatedAt}\`${p.previousRunAt ? ` · vs \`${p.previousRunAt}\`` : ""} · ${p.baseUrl}`,
              },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: p.newFailures
                .slice(0, 20)
                .map((f) => {
                  const overflow = typeof f.overflowPx === "number" ? ` (+${f.overflowPx}px)` : "";
                  return `• *${f.device}* · \`${f.path}\` — ${f.status}${overflow}`;
                })
                .join("\n"),
            },
          },
          ...(p.newFailures.length > 20
            ? [
                {
                  type: "context" as const,
                  elements: [
                    { type: "mrkdwn" as const, text: `…and ${p.newFailures.length - 20} more.` },
                  ],
                },
              ]
            : []),
          ...(p.publicUrl
            ? [
                {
                  type: "actions" as const,
                  elements: [
                    {
                      type: "button" as const,
                      text: { type: "plain_text" as const, text: "Open dashboard" },
                      url: `${p.publicUrl}/responsive-audit`,
                    },
                  ],
                },
              ]
            : []),
        ],
      }),
    });
    const body = await res.text();
    let parsed: { ok?: boolean; error?: string } = {};
    try {
      parsed = JSON.parse(body);
    } catch {}
    if (!res.ok || !parsed.ok) {
      return {
        channel: "slack",
        status: "failed",
        detail: `HTTP ${res.status}: ${parsed.error ?? body.slice(0, 200)}`,
      };
    }
    return { channel: "slack", status: "sent" };
  } catch (err) {
    return {
      channel: "slack",
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export const Route = createFileRoute("/api/public/audit-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        if (!verifySignature(rawBody, request.headers.get("x-audit-signature"))) {
          return new Response("Invalid signature", { status: 401 });
        }
        let json: unknown;
        try {
          json = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const parsed = PayloadSchema.safeParse(json);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid payload", issues: parsed.error.issues },
            { status: 400 },
          );
        }
        const payload = parsed.data;

        // Only notify when there is something new (unless force=true).
        if (payload.newFailures.length === 0 && !payload.force) {
          return Response.json({
            dispatched: false,
            reason: "no new failures",
            newFailures: 0,
          });
        }

        const [email, slack] = await Promise.all([sendEmail(payload), sendSlack(payload)]);
        return Response.json({
          dispatched: true,
          newFailures: payload.newFailures.length,
          deliveries: [email, slack],
        });
      },
    },
  },
});
