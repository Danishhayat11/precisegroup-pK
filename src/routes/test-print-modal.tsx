/**
 * Test-only route used by tests/a11y/print-modal-cleanup.spec.ts.
 *
 * Renders <PrintPreviewModal> in a known-open state for an arbitrary document
 * type chosen via the `doc` query param ("receipt" | "ledger" | "plan" |
 * "notice" | "statement"). Each variant uses the same A4 geometry and the
 * `text` mode so the modal mounts without needing real ERP data.
 *
 * Keeping the harness inside the app (rather than spinning up a synthetic
 * HTML page) means the test exercises the *real* PrintPreviewModal + the
 * real preparePrint() flow under real browser conditions.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import PrintPreviewModal from "@/components/PrintPreviewModal";

// Body for the "long-receipt" variant: enough content to overflow a single
// A4 page and force a multi-page paginated preview so tests can assert
// auto-fit behavior when N > 1 pp-sheet elements exist.
const LONG_RECEIPT_BODY = (() => {
  const lines: string[] = ["Payment Receipt — Detailed Multi-Page Statement", ""];
  for (let i = 1; i <= 220; i++) {
    lines.push(
      `${String(i).padStart(3, "0")}. Installment #${i} — PKR ${(50_000 + i * 137).toLocaleString()} — received via bank transfer, ref TXN-${1000000 + i}.`,
    );
  }
  return lines.join("\n");
})();

const DOCS: Record<string, { title: string; body: string }> = {
  receipt: {
    title: "Test Receipt — MA-00010",
    body: "Payment Receipt\n\nReceived PKR 100,000 from John Doe.",
  },
  ledger: {
    title: "Test Client Ledger — Client 42",
    body: "Client Payment Ledger\n\nLine 1\nLine 2\nLine 3",
  },
  plan: {
    title: "Test Payment Plan — MA-00010",
    body: "Installment Schedule\n\nMonth 1 — PKR 50,000\nMonth 2 — PKR 50,000",
  },
  notice: {
    title: "Test Legal Notice — MA-00010",
    body: "Legal Notice\n\nDear Client,\nThis is a notice.",
  },
  statement: {
    title: "Test Client Statement — Client 42",
    body: "Client Statement\n\nUnit A\nUnit B",
  },
  // Extremes used by tests/a11y/print-modal-fit-lengths.spec.ts to verify
  // auto-fit height/width math on both edges of the content spectrum.
  "short-receipt": { title: "Test Receipt (Short) — MA-00010", body: "Received PKR 1,000." },
  "long-receipt": { title: "Test Receipt (Long) — MA-00010", body: LONG_RECEIPT_BODY },
};

function TestPrintModalRoute() {
  const search = Route.useSearch();
  const docKey = (search.doc ?? "receipt") as keyof typeof DOCS;
  const cfg = DOCS[docKey] ?? DOCS.receipt;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  // Canonical caller pattern when a controlled Dialog is opened from a
  // plain button (not <DialogTrigger>): remember the opener and restore
  // focus to it on close. Without this, Radix has no reference to the
  // trigger and focus falls back to <body> — failing the
  // tests/a11y/print-focus-return.spec.ts contract.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      // Modal just closed: hand focus back to the original trigger.
      triggerRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Print modal cleanup harness</h1>
      <p data-testid="doc-key">{docKey}</p>
      {hydrated && <span data-testid="hydrated" hidden />}

      <button
        ref={triggerRef}
        data-testid="open-modal"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        Open print modal
      </button>
      {mounted && (
        <PrintPreviewModal
          open={open}
          onOpenChange={setOpen}
          title={cfg.title}
          mode="text"
          body={cfg.body}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute("/test-print-modal")({
  validateSearch: (s: Record<string, unknown>) => ({
    doc: typeof s.doc === "string" ? s.doc : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Print Modal Test — Internal" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "googlebot", content: "noindex, nofollow" },
    ],
  }),
  component: TestPrintModalRoute,
});
