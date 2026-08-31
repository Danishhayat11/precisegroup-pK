import { toast } from "sonner";

/**
 * Lead-notification placeholder.
 *
 * Right now this just surfaces an in-app toast so office users see who *would*
 * be notified. When Resend / Twilio / GatewayAPI (or any other email/SMS
 * provider) is wired up, replace the `TODO` block with the actual send call —
 * no other CRM code needs to change.
 */

export type LeadNotifyEvent = "created" | "updated" | "converted";

export type LeadNotifyPayload = {
  event: LeadNotifyEvent;
  leadName: string;
  leadId: string;
  stage?: string | null;
  assignee?: {
    id: string;
    fullName: string | null;
    email?: string | null;
    mobile?: string | null;
  } | null;
};

const EVENT_LABEL: Record<LeadNotifyEvent, string> = {
  created: "New lead assigned",
  updated: "Lead updated",
  converted: "Lead converted to Booking",
};

export function notifyAssignee(payload: LeadNotifyPayload): void {
  const { event, leadName, assignee, stage } = payload;
  const label = EVENT_LABEL[event];

  if (!assignee) {
    // Unassigned leads still trigger a subtle in-app note so the office
    // knows nobody will be pinged externally.
    toast.message(`${label}: ${leadName}`, {
      description: "No assignee set — nobody will receive an email/SMS.",
    });
    return;
  }

  const who = assignee.fullName || "assignee";
  const channels: string[] = [];
  if (assignee.email) channels.push(`email → ${assignee.email}`);
  if (assignee.mobile) channels.push(`SMS → ${assignee.mobile}`);
  const via = channels.length ? channels.join(" · ") : "no email/SMS on file";

  toast.message(`${label} · ${leadName}`, {
    description: `${who} will be notified (${via}${stage ? ` · stage: ${stage}` : ""}).`,
  });

  // ---- Email/SMS send hook -------------------------------------------------
  // TODO: replace this console line with a real send when a provider is
  // connected. Suggested wiring:
  //   • Email: server function that calls Resend / Brevo / Mailgun /
  //     Lovable Emails through the connector gateway.
  //   • SMS:   server function that calls Twilio or GatewayAPI.
  // Keep the payload shape identical so callers don't have to change.

  console.info("[notifyAssignee] would send notification", {
    event,
    leadId: payload.leadId,
    leadName,
    stage,
    to: {
      name: assignee.fullName,
      email: assignee.email ?? null,
      mobile: assignee.mobile ?? null,
    },
  });
}
