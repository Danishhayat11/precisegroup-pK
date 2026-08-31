import { describe, it, expect } from "vitest";
import { deriveStatus, normalisePkPhone, buildReminderMessage } from "@/lib/ledgerStatus";

// Fixed anchor: 2026-07-09 local midnight. Using a Date built from Y/M/D
// avoids TZ-offset drift that ISO "2026-07-09" would introduce.
const today = () => new Date(2026, 6, 9);

describe("deriveStatus — installment classification", () => {
  it("PAID when paid >= due (fully paid)", () => {
    expect(deriveStatus(100_000, 100_000, "2026-07-01", today())).toBe("PAID");
    expect(deriveStatus(100_000, 150_000, "2026-07-01", today())).toBe("PAID");
  });

  it("OVERDUE when past due and partial (partial + overdue → OVERDUE wins)", () => {
    expect(deriveStatus(100_000, 40_000, "2026-07-01", today())).toBe("OVERDUE");
  });

  it("OVERDUE when past due with zero paid", () => {
    expect(deriveStatus(100_000, 0, "2026-07-08", today())).toBe("OVERDUE");
  });

  it("PARTIAL when some paid, not overdue, still below due", () => {
    expect(deriveStatus(100_000, 25_000, "2026-08-01", today())).toBe("PARTIAL");
  });

  describe("boundary: today", () => {
    it("today with nothing paid is DUE SOON (not OVERDUE)", () => {
      expect(deriveStatus(100_000, 0, "2026-07-09", today())).toBe("DUE SOON");
    });

    it("today fully paid is PAID", () => {
      expect(deriveStatus(100_000, 100_000, "2026-07-09", today())).toBe("PAID");
    });

    it("today partially paid classifies as PARTIAL (not OVERDUE, past=false)", () => {
      expect(deriveStatus(100_000, 40_000, "2026-07-09", today())).toBe("PARTIAL");
    });
  });

  describe("boundary: 7 days ahead", () => {
    it("exactly +7 days is DUE SOON (inclusive upper edge)", () => {
      expect(deriveStatus(100_000, 0, "2026-07-16", today())).toBe("DUE SOON");
    });

    it("+8 days is UPCOMING", () => {
      expect(deriveStatus(100_000, 0, "2026-07-17", today())).toBe("UPCOMING");
    });

    it("yesterday with zero paid is OVERDUE (lower edge)", () => {
      expect(deriveStatus(100_000, 0, "2026-07-08", today())).toBe("OVERDUE");
    });
  });

  it("UPCOMING when no due date and nothing paid", () => {
    expect(deriveStatus(100_000, 0, null, today())).toBe("UPCOMING");
  });

  it("does not mutate the caller's today Date", () => {
    const t = today();
    const before = t.getTime();
    deriveStatus(100_000, 0, "2026-07-01", t);
    expect(t.getTime()).toBe(before);
  });
});

describe("normalisePkPhone", () => {
  it("returns null for missing / non-digit input", () => {
    expect(normalisePkPhone(null)).toBeNull();
    expect(normalisePkPhone(undefined)).toBeNull();
    expect(normalisePkPhone("")).toBeNull();
    expect(normalisePkPhone("---")).toBeNull();
  });

  it("converts 0-prefixed local number to 92-prefixed wa.me digits", () => {
    expect(normalisePkPhone("0301-1234567")).toBe("923011234567");
    expect(normalisePkPhone("0301 1234567")).toBe("923011234567");
  });

  it("passes through +92-prefixed numbers as bare digits", () => {
    expect(normalisePkPhone("+92 301 1234567")).toBe("923011234567");
  });

  it("prepends 92 to bare 10-digit numbers", () => {
    expect(normalisePkPhone("3011234567")).toBe("923011234567");
  });
});

describe("buildReminderMessage — WhatsApp formatting", () => {
  const base = {
    clientName: "Ali Raza",
    bookingId: "BK-MA-00010",
    particulars: "Installment #3",
    dueDate: "2026-07-01",
    amount: 250_000,
    daysOverdue: 8,
  };

  it("includes greeting, booking id, particulars, formatted date and amount", () => {
    const msg = buildReminderMessage(base);
    expect(msg).toContain("Assalam-o-Alaikum Ali Raza,");
    expect(msg).toContain("booking BK-MA-00010");
    expect(msg).toContain("Installment: Installment #3 due 01-Jul-2026.");
    expect(msg).toContain("Amount outstanding: 250,000 (8 days overdue).");
  });

  it("appends unit id to the booking reference when provided", () => {
    const msg = buildReminderMessage({ ...base, unitId: "A-204" });
    expect(msg).toContain("booking BK-MA-00010 (Unit A-204).");
  });

  it("omits unit segment when unitId is missing or blank", () => {
    expect(buildReminderMessage({ ...base, unitId: null })).toContain("booking BK-MA-00010.");
    expect(buildReminderMessage({ ...base, unitId: "  " })).toContain("booking BK-MA-00010.");
    expect(buildReminderMessage({ ...base, unitId: null })).not.toMatch(/\(Unit/);
  });

  it("pluralises days correctly — 1 day (singular)", () => {
    const msg = buildReminderMessage({ ...base, daysOverdue: 1 });
    expect(msg).toContain("(1 day overdue)");
  });

  it("pluralises days correctly — 0 and 2 days (plural)", () => {
    expect(buildReminderMessage({ ...base, daysOverdue: 0 })).toContain("(0 days overdue)");
    expect(buildReminderMessage({ ...base, daysOverdue: 2 })).toContain("(2 days overdue)");
  });

  it("falls back to Sir/Madam when client name is missing or blank", () => {
    expect(buildReminderMessage({ ...base, clientName: null })).toContain(
      "Assalam-o-Alaikum Sir/Madam,",
    );
    expect(buildReminderMessage({ ...base, clientName: "   " })).toContain(
      "Assalam-o-Alaikum Sir/Madam,",
    );
  });

  it("falls back to generic 'Installment' when particulars are missing", () => {
    const msg = buildReminderMessage({ ...base, particulars: null });
    expect(msg).toContain("Installment: Installment due");
  });

  it("renders '—' for missing due date rather than 'Invalid Date'", () => {
    const msg = buildReminderMessage({ ...base, dueDate: null });
    expect(msg).toContain("Installment: Installment #3 due —.");
    expect(msg).not.toMatch(/Invalid Date/i);
  });

  it("uses blank-line separators between greeting, body, and call-to-action", () => {
    const lines = buildReminderMessage(base).split("\n");
    expect(lines[0]).toMatch(/^Assalam-o-Alaikum/);
    expect(lines[1]).toBe("");
    expect(lines[5]).toBe("");
    expect(lines[6]).toMatch(/^Kindly clear/);
  });
});
