import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Letterhead, Footer, DocBody } from "@/pages/Documents";

/**
 * Renders every Manal Heights document type from Documents.tsx and asserts
 * headers, footers, and metadata carry the Manal Heights brand — with no
 * leaked "Manal Arcade" text anywhere in the output.
 *
 * The context mirrors what Documents.tsx builds in `ctx` (line ~193) for a
 * Manal Heights booking (isHeights: true).
 */

const heightsCtx = {
  ref: "PRB/MA/MH-AP-101/2026-001",
  today: "14-07-2026",
  deadline: "29-07-2026",
  title: "Mr.",
  name: "TEST CLIENT",
  father: "S/O Test",
  cnic: "12345-1234567-1",
  address: "Islamabad",
  unitNo: "MH-AP-101",
  unitType: "Apartment",
  floor: "1st",
  project: "Manal Heights",
  isHeights: true,
  projectAddress: "Manal Heights, B-17 Multi Gardens, Islamabad",
  projectAddressFull: "Manal Heights, Plot No. 04, B-17 Multi Gardens, Islamabad",
  projectEmail: "manalheights@gmail.com",
  projectShortAddr: "Manal Heights, B-17, Islamabad",
  size: "630",
  bookingDate: "01-01-2025",
  contractDate: "01-01-2025",
  overdueCount: 1,
  overdueAmount: 357500,
  overdueAmtFmt: "PKR 357,500/-",
  overdueWords: "three hundred fifty-seven thousand five hundred rupees",
  prev1: "01-06-2026",
  prev2: "20-06-2026",
  overdueRows: [
    {
      ledger_id: "1",
      particulars: "Installment 1",
      due_date: "2026-05-01",
      due_amount: 357500,
      paid_amount: 0,
    },
  ],
};

/** Ensures a rendered HTML string contains Heights branding and no Arcade leaks. */
function assertHeightsOnly(html: string, label: string) {
  expect(html, `${label} should NOT contain "Manal Arcade"`).not.toMatch(/manal\s*arcade/i);
  expect(html, `${label} should NOT contain "manalarcade" email`).not.toMatch(/manalarcade@/i);
}

describe("Documents.tsx — Manal Heights rendering", () => {
  describe("Letterhead (header)", () => {
    it("renders MANAL HEIGHTS brand for manal variant", () => {
      const html = renderToStaticMarkup(<Letterhead variant="manal" c={heightsCtx} />);
      expect(html).toContain("MANAL HEIGHTS");
      expect(html).toContain("Elevated Living");
      assertHeightsOnly(html, "Letterhead (manal)");
    });

    it("renders Precise header with Heights subline for precise variant", () => {
      const html = renderToStaticMarkup(<Letterhead variant="precise" c={heightsCtx} />);
      expect(html).toContain("PRECISE REALTORS");
      expect(html.toUpperCase()).toContain("MANAL HEIGHTS, B-17, ISLAMABAD");
      assertHeightsOnly(html, "Letterhead (precise)");
    });
  });

  describe("Footer (metadata)", () => {
    it("renders Manal Heights address and email for manal variant", () => {
      const html = renderToStaticMarkup(<Footer variant="manal" c={heightsCtx} />);
      expect(html).toContain("Manal Heights, B-17 Multi Gardens, Islamabad");
      expect(html).toContain("manalheights@gmail.com");
      expect(html).toContain("Office #01, 1st Floor, Manal Heights, B-17 Multi Gardens, Islamabad");
      assertHeightsOnly(html, "Footer (manal)");
    });

    it("renders Manal Heights address for precise variant", () => {
      const html = renderToStaticMarkup(<Footer variant="precise" c={heightsCtx} />);
      expect(html).toContain("Manal Heights, B-17 Multi Gardens, Islamabad");
      assertHeightsOnly(html, "Footer (precise)");
    });

    it("falls back to Manal Heights when ctx is empty", () => {
      const html = renderToStaticMarkup(<Footer variant="manal" c={{}} />);
      expect(html).toContain("Manal Heights, B-17 Multi Gardens, Islamabad");
      expect(html).toContain("manalheights@gmail.com");
      assertHeightsOnly(html, "Footer (empty ctx)");
    });
  });

  describe.each([
    ["legal", "Legal Notice"],
    ["final", "Final Legal Notice"],
    ["final_cancel", "Final + Cancellation Warning"],
    ["cancellation", "Cancellation Notice"],
  ] as const)("DocBody — %s (%s)", (doc, _label) => {
    const html = renderToStaticMarkup(<DocBody doc={doc as any} c={heightsCtx} />);

    it("renders MANAL HEIGHTS in the letterhead", () => {
      // Cancellation uses the precise variant of the letterhead, which shows
      // "MANAL HEIGHTS, B-17, ISLAMABAD" as the subline instead of the brand.
      if (doc === "cancellation") {
        expect(html.toUpperCase()).toContain("MANAL HEIGHTS, B-17, ISLAMABAD");
      } else {
        expect(html).toContain("MANAL HEIGHTS");
      }
    });

    it("renders Manal Heights in the footer address", () => {
      expect(html).toContain("Manal Heights, B-17 Multi Gardens, Islamabad");
    });

    it("renders manalheights@gmail.com in the footer", () => {
      // Cancellation uses the "precise" footer variant, which shows only the
      // company + project address (no email line by design).
      if (doc === "cancellation") {
        expect(html).toContain("Manal Heights");
      } else {
        expect(html).toContain("manalheights@gmail.com");
      }
    });

    it("references Manal Heights in the subject/body metadata", () => {
      // Every doc mentions the project name at least once in its body copy.
      expect(html).toMatch(/manal heights/i);
    });

    it("contains no Manal Arcade leaks anywhere", () => {
      assertHeightsOnly(html, `DocBody(${doc})`);
    });
  });
});
