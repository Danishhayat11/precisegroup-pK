import { describe, it, expect } from "vitest";
import {
  validateDate,
  parseExcelSerial,
  parseDateString,
  crossFieldIssues,
} from "../dateValidation";
import { validateSheet, quarantineToCsv } from "../excelQuarantine";

describe("dateValidation", () => {
  it("parses Excel serial numbers", () => {
    // 45658 = 2025-01-01
    const d = parseExcelSerial(45658);
    expect(d?.toISOString().slice(0, 10)).toBe("2025-01-01");
  });

  it("parses DD-MMM-YYYY", () => {
    expect(parseDateString("15-Jan-2025")?.toISOString().slice(0, 10)).toBe("2025-01-15");
    expect(parseDateString("01 Feb 2024")?.toISOString().slice(0, 10)).toBe("2024-02-01");
  });

  it("parses ISO and day-first slash forms", () => {
    expect(parseDateString("2024-05-10")?.toISOString().slice(0, 10)).toBe("2024-05-10");
    expect(parseDateString("10/05/2024")?.toISOString().slice(0, 10)).toBe("2024-05-10");
  });

  it("rejects garbage", () => {
    expect(validateDate("not a date").iso).toBeNull();
    expect(validateDate("not a date").issue).toBe("unparseable");
    expect(validateDate(-5).iso).toBeNull();
  });

  it("flags before_epoch and future_beyond_horizon", () => {
    expect(validateDate("1980-01-01").issue).toBe("before_epoch");
    expect(validateDate("2999-01-01").issue).toBe("future_beyond_horizon");
  });

  it("accepts empty as null without issue", () => {
    expect(validateDate(null)).toEqual({ iso: null, raw: null });
    expect(validateDate("")).toEqual({ iso: null, raw: "" });
  });

  it("detects cross-field inconsistencies", () => {
    const issues = crossFieldIssues({
      booking_date: "2024-09-01",
      first_installment_due: "2024-08-15",
    });
    expect(issues).toContain("first_installment_due < booking_date");
  });
});

describe("validateSheet", () => {
  it("quarantines rows with bad dates and returns normalized clean rows", () => {
    const rows = [
      { booking_date: "01-Jan-2025", first_installment_due: "15-Feb-2025" },
      { booking_date: "not a date", first_installment_due: "15-Feb-2025" },
      { booking_date: "2024-09-01", first_installment_due: "2024-08-15" }, // cross-field
    ];
    const rep = validateSheet("bookings", rows);
    expect(rep.totals.input).toBe(3);
    expect(rep.totals.clean).toBe(1);
    expect(rep.totals.quarantined).toBe(2);
    expect(rep.clean[0].booking_date).toBe("2025-01-01");
    expect(rep.quarantined[1].reasons.some((r) => r.includes("cross-field"))).toBe(true);
  });

  it("emits CSV with header and reasons", () => {
    const rep = validateSheet("bookings", [{ booking_date: "bogus" }]);
    const csv = quarantineToCsv(rep.quarantined);
    expect(csv).toMatch(/sheet,rowIndex,reasons/);
    expect(csv).toMatch(/unparseable/);
  });
});
