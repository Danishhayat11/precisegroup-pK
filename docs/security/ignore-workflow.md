# Ignore Workflow — from review panel to security-memory

When the security scanner surfaces a finding that is not applicable to this
app, we do **not** just mute it. The rule is:

> Every ignored finding must land in the project's `security-memory` with a
> justification so the next scan automatically skips the same rule instead
> of re-flagging it.

That loop is co-owned by the reviewer (in-app) and the Lovable agent
(server-side). Neither side alone is enough — the review panel is
session-only, and the agent needs the reviewer's justification text.

## 1. Review in the app

Open `/security-review`. Each finding renders with:

- current status: **Pending**, **Ignore**, or **Fix**
- an editable **Justification** field (Textarea) — this is the text that
  will be persisted to `security-memory`.

Rules the panel enforces:

- Moving a finding to **Ignore** requires a justification of at least
  **20 characters**. The **Export decisions** button stays disabled until
  every newly-ignored finding has one.
- A banner at the top of the list summarises how many findings still need
  a justification.
- The justification is pre-filled with the previously recorded one (if any)
  so an audit trail is preserved.

## 2. Export decisions

Clicking **Export decisions** copies a JSON payload to the clipboard:

```json
{
  "generatedAt": "2026-07-03T…Z",
  "instructions": "Feed to the Lovable agent…",
  "decisions": [
    {
      "id": "SUPA_anon_security_definer_function_executable",
      "scanner": "supabase",
      "name": "Public Can Execute SECURITY DEFINER Function",
      "previous": "pending",
      "next": "ignored",
      "justification": "By design — see /client-note/$token flow…",
      "persistTo": "security-memory"
    }
  ]
}
```

The reviewer pastes this back into a Lovable chat.

## 3. Agent persists to security-memory

For every decision with `persistTo: "security-memory"` the agent runs:

1. `security--manage_security_finding` with
   `operation: "ignore"`,
   `scanner_name`, `internal_id: id`,
   `explanation: justification`.
2. `security--update_memory` to append the rule + reasoning to the project's
   security-memory document, keeping it fresh and de-duplicated.

For `persistTo: "mark-as-fixed"` the agent calls
`security--manage_security_finding` with `operation: "mark_as_fixed"` and the
same justification as the explanation.

This is why the justification field in `src/lib/security/findings.ts` is
also the source-of-truth for the panel: keeping the two in sync means a
new session — human or agent — sees the same rationale the last review
recorded, and the scanner sees it as a persistent decision.
