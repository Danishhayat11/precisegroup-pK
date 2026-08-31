/**
 * Persistent conversation memory for the Precise Assistant.
 *
 * The bot lives across many turns — the user says "log a payment for him",
 * "open that ledger", "same booking as before" — and we need a durable
 * ledger of the ERP entities the conversation has touched so the model can:
 *
 *   1. Resolve pronouns / demonstratives to concrete IDs.
 *   2. Recognise when an incoming reference is AMBIGUOUS (multiple bookings
 *      match "Adil", no focus set, or a "the receipt" mention with several
 *      candidates in memory) and ask ONE crisp follow-up before acting.
 *
 * The memory is pure state: a list of Entity records plus a `focus` pointer
 * for the current subject. Extraction happens against raw markdown text
 * (user turns + assistant replies), so no server round-trip is needed to
 * keep it in sync. `renderMemoryForPrompt` produces the block that gets
 * injected into the system prompt on every request; the same shape is
 * persisted in localStorage per user (see assistantMemoryStore.ts).
 *
 * This module is pure (no I/O, no DOM) and unit-testable.
 */

export type EntityKind = "booking" | "receipt" | "client" | "cnic" | "unit" | "document";

export type Entity = {
  kind: EntityKind;
  id: string; // canonical identifier (uppercased where relevant)
  label?: string; // human-friendly label ("Adil Khan", "Unit 305")
  aliases?: string[]; // alt names / short forms the user has used
  firstSeenAt: number;
  lastSeenAt: number;
  mentions: number;
};

export type MemoryFocus = { kind: EntityKind; id: string } | null;

export type ConversationMemory = {
  version: 1;
  entities: Entity[];
  focus: MemoryFocus;
  updatedAt: number;
};

export const EMPTY_MEMORY: ConversationMemory = {
  version: 1,
  entities: [],
  focus: null,
  updatedAt: 0,
};

const MAX_ENTITIES = 40;

// ── ERP identifier shapes ─────────────────────────────────────────
// booking_id: BK-<PROJECT>-##### (e.g. BK-MA-00015). Project code is 2-4 alpha.
const RX_BOOKING = /\bBK-[A-Z]{2,4}-\d{3,6}\b/gi;
// receipt_no: R-#### or RCT-#### (short numeric receipts).
const RX_RECEIPT = /\b(?:R|RCT)-\d{3,8}\b/gi;
// Pakistani CNIC: 5-7-1 with dashes.
const RX_CNIC = /\b\d{5}-\d{7}-\d\b/g;
// Unit tokens must appear next to the word "Unit" to avoid false positives
// on generic tokens like "MA-105" that overlap other IDs.
const RX_UNIT = /\bUnit(?:\s+No\.?)?\s+([A-Z0-9][A-Z0-9-]{1,10})\b/gi;
// Document IDs are UUIDs; only pick them up when preceded by "document" so
// arbitrary UUIDs in URLs don't pollute memory.
const RX_DOC =
  /\bdocument(?:\s+id)?[:\s]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;
// Client name: "**Adil Khan**" bolded markdown next to a booking is our
// most reliable cue. We link name → nearest booking_id in the same block.
const RX_BOLD_NAME = /\*\*([A-Z][A-Za-z' .]{2,40})\*\*/g;

function upsert(
  mem: ConversationMemory,
  kind: EntityKind,
  id: string,
  label?: string,
  alias?: string,
): ConversationMemory {
  const norm = id.trim();
  if (!norm) return mem;
  const canonical = kind === "cnic" ? norm : norm.toUpperCase();
  const now = Date.now();
  const idx = mem.entities.findIndex((e) => e.kind === kind && e.id === canonical);
  if (idx >= 0) {
    const prev = mem.entities[idx];
    const nextAliases =
      alias && alias !== prev.label
        ? Array.from(new Set([...(prev.aliases ?? []), alias]))
        : prev.aliases;
    const nextLabel = prev.label ?? label;
    const updated: Entity = {
      ...prev,
      label: nextLabel,
      aliases: nextAliases,
      lastSeenAt: now,
      mentions: prev.mentions + 1,
    };
    const next = mem.entities.slice();
    next[idx] = updated;
    return { ...mem, entities: next, updatedAt: now };
  }
  const entity: Entity = {
    kind,
    id: canonical,
    label,
    aliases: alias ? [alias] : undefined,
    firstSeenAt: now,
    lastSeenAt: now,
    mentions: 1,
  };
  return { ...mem, entities: [...mem.entities, entity], updatedAt: now };
}

/**
 * Extract ERP entities from any markdown / plain-text turn. Both user
 * questions and assistant answers are fed through this so the memory
 * grows on both sides of the conversation.
 */
export function extractEntities(memory: ConversationMemory, text: string): ConversationMemory {
  if (!text) return memory;
  let mem = memory;

  // 1. Bold client names bound to a nearby booking_id in the same paragraph.
  //    We pass over the text once collecting booking positions, then map
  //    each bold name to the closest booking within 200 chars.
  const bookings: Array<{ id: string; index: number }> = [];
  for (const m of text.matchAll(RX_BOOKING)) {
    bookings.push({ id: m[0].toUpperCase(), index: m.index ?? 0 });
    mem = upsert(mem, "booking", m[0]);
  }

  for (const m of text.matchAll(RX_BOLD_NAME)) {
    const name = m[1].trim();
    if (!name || name.length < 3) continue;
    // Skip obvious non-names (all-caps section headers etc.)
    if (/^[A-Z\s]+$/.test(name) && name.split(" ").length < 2) continue;
    const pos = m.index ?? 0;
    const nearest = bookings
      .map((b) => ({ id: b.id, dist: Math.abs(b.index - pos) }))
      .sort((a, b) => a.dist - b.dist)[0];
    if (nearest && nearest.dist < 200) {
      // Attach the client name as the booking's label.
      const idx = mem.entities.findIndex((e) => e.kind === "booking" && e.id === nearest.id);
      if (idx >= 0 && !mem.entities[idx].label) {
        const next = mem.entities.slice();
        next[idx] = { ...next[idx], label: name };
        mem = { ...mem, entities: next };
      }
      mem = upsert(mem, "client", name, name);
    }
  }

  for (const m of text.matchAll(RX_RECEIPT)) mem = upsert(mem, "receipt", m[0]);
  for (const m of text.matchAll(RX_CNIC)) mem = upsert(mem, "cnic", m[0]);
  for (const m of text.matchAll(RX_UNIT)) mem = upsert(mem, "unit", m[1], `Unit ${m[1]}`);
  for (const m of text.matchAll(RX_DOC)) mem = upsert(mem, "document", m[1]);

  // Focus follows the most recently mentioned booking; falls back to
  // receipt, then client. First mention in the newest text wins.
  const firstBooking = [...text.matchAll(RX_BOOKING)][0];
  if (firstBooking) {
    mem = { ...mem, focus: { kind: "booking", id: firstBooking[0].toUpperCase() } };
  } else if (!mem.focus) {
    const firstReceipt = [...text.matchAll(RX_RECEIPT)][0];
    if (firstReceipt)
      mem = { ...mem, focus: { kind: "receipt", id: firstReceipt[0].toUpperCase() } };
  }

  return pruneMemory(mem);
}

/**
 * Detect ambiguous references in a fresh user message given the current
 * memory. Returns a human-readable prompt the assistant can quote when it
 * needs the user to disambiguate. Empty array ⇒ nothing ambiguous.
 */
export function detectAmbiguity(memory: ConversationMemory, userText: string): string[] {
  const issues: string[] = [];
  const lower = userText.toLowerCase();

  const bookings = memory.entities.filter((e) => e.kind === "booking");
  const receipts = memory.entities.filter((e) => e.kind === "receipt");
  const clients = memory.entities.filter((e) => e.kind === "client");

  // Bare pronouns / demonstratives with no focus set.
  const pronounRx =
    /\b(him|her|them|that\s+client|the\s+client|this\s+client|that\s+booking|the\s+booking|same\s+booking|same\s+client|the\s+guy|that\s+guy)\b/;
  if (pronounRx.test(lower) && !memory.focus && bookings.length > 1) {
    issues.push(
      `You referred to a client/booking without naming one, and I have ${bookings.length} bookings in memory (${bookings
        .slice(-3)
        .map((b) => (b.label ? `${b.label} — ${b.id}` : b.id))
        .join(", ")}). Which one do you mean?`,
    );
  }

  // Ambiguous receipt references when several are in memory.
  const receiptRx = /\b(the|that|last|previous)\s+(receipt|payment)\b/;
  if (receiptRx.test(lower) && receipts.length > 1) {
    issues.push(
      `Multiple receipts are in memory (${receipts
        .slice(-4)
        .map((r) => r.id)
        .join(", ")}). Which receipt do you mean?`,
    );
  }

  // First-name-only mention when >1 client shares that first name.
  if (clients.length > 1) {
    const firstNameCounts = new Map<string, string[]>();
    for (const c of clients) {
      const first = (c.label ?? c.id).split(/\s+/)[0].toLowerCase();
      if (!firstNameCounts.has(first)) firstNameCounts.set(first, []);
      firstNameCounts.get(first)!.push(c.label ?? c.id);
    }
    for (const [first, matches] of firstNameCounts.entries()) {
      if (matches.length < 2) continue;
      const wordRx = new RegExp(`\\b${first}\\b`, "i");
      // Use non-global copies for presence checks — calling `.test()` on
      // the `/g` regexes advances their lastIndex and would poison the
      // next `matchAll` (silent regression: bookings/CNICs "disappear"
      // from extraction depending on prior detectAmbiguity calls).
      const hasBooking = new RegExp(RX_BOOKING.source, "i").test(userText);
      const hasCnic = new RegExp(RX_CNIC.source).test(userText);
      if (wordRx.test(userText) && !hasBooking && !hasCnic) {
        issues.push(
          `"${first}" matches ${matches.length} clients in memory (${matches.join(", ")}). Which one — please confirm by booking_id or CNIC.`,
        );
      }
    }
  }

  return issues;
}

/**
 * Trim memory to the most-relevant MAX_ENTITIES so the prompt stays small.
 * Ranking = mentions desc, then lastSeenAt desc. Focus entity always kept.
 */
export function pruneMemory(memory: ConversationMemory): ConversationMemory {
  if (memory.entities.length <= MAX_ENTITIES) return memory;
  const focusKey = memory.focus ? `${memory.focus.kind}:${memory.focus.id}` : null;
  const sorted = memory.entities.slice().sort((a, b) => {
    const aFocus = focusKey === `${a.kind}:${a.id}` ? 1 : 0;
    const bFocus = focusKey === `${b.kind}:${b.id}` ? 1 : 0;
    if (aFocus !== bFocus) return bFocus - aFocus;
    if (a.mentions !== b.mentions) return b.mentions - a.mentions;
    return b.lastSeenAt - a.lastSeenAt;
  });
  return { ...memory, entities: sorted.slice(0, MAX_ENTITIES) };
}

/**
 * Render the memory as a markdown block for the model. Kept compact — one
 * line per entity, grouped by kind, with the current focus called out.
 */
export function renderMemoryForPrompt(memory: ConversationMemory): string {
  if (memory.entities.length === 0) return "";
  const byKind = new Map<EntityKind, Entity[]>();
  for (const e of memory.entities) {
    if (!byKind.has(e.kind)) byKind.set(e.kind, []);
    byKind.get(e.kind)!.push(e);
  }
  const lines: string[] = ["## PERSISTENT CONVERSATION MEMORY"];
  if (memory.focus) {
    const f = memory.entities.find(
      (e) => e.kind === memory.focus!.kind && e.id === memory.focus!.id,
    );
    lines.push(
      `Current focus → ${memory.focus.kind}: ${f?.label ? `${f.label} (${memory.focus.id})` : memory.focus.id}`,
    );
  } else {
    lines.push("Current focus → (none set — ask if the user references an entity ambiguously)");
  }
  const order: EntityKind[] = ["booking", "client", "receipt", "cnic", "unit", "document"];
  for (const kind of order) {
    const arr = byKind.get(kind);
    if (!arr || !arr.length) continue;
    const items = arr
      .slice()
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, 10)
      .map((e) => (e.label && e.label !== e.id ? `${e.id} (${e.label})` : e.id));
    lines.push(`- ${kind}s: ${items.join(", ")}`);
  }
  lines.push(
    "RULES: (1) Prefer these IDs when the user's request is short or uses pronouns/demonstratives. " +
      '(2) If the user\'s reference is AMBIGUOUS — bare pronoun with no focus, a first-name that matches multiple clients, or "the receipt/payment" with multiple candidates — STOP and ask ONE crisp follow-up naming the concrete options before calling any tool. ' +
      "(3) Never invent an ID that is not in this memory or in a tool result.",
  );
  return lines.join("\n");
}
