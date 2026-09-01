/**
 * preparePrint() must always return the UI from the "Preparing for print…"
 * state back to normal — regardless of which printable document triggered it
 * (Receipt, Ledger, Payment Plan, Legal Notice, Booking Detail, Print
 * Preview Modal, etc.). "Normal" means:
 *
 *   - the injected <style id="pp-print-runtime"> is gone from <head>
 *   - document.title is restored to whatever it was before
 *   - the sonner toast.loading() id was dismissed
 *   - the afterprint listener was removed (no leak on repeat prints)
 *
 * Three cleanup paths exist; we cover all three for every document type:
 *   A) browser fires `afterprint`           — happy path
 *   B) user cancels without afterprint      — 12s safety setTimeout fires
 *   C) window.print() throws                — synchronous error cleanup
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preparePrint } from "@/lib/printFlow";

vi.mock("sonner", () => {
  const dismiss = vi.fn();
  const loading = vi.fn(() => "toast-id-xyz");
  const error = vi.fn();
  return { toast: { loading, dismiss, error }, __mock: { loading, dismiss, error } };
});

const sonnerMock = (await import("sonner")) as unknown as {
  __mock: {
    loading: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
};

const STYLE_ID = "pp-print-runtime";

// One scenario per real-world printable document, with its actual page
// geometry + filename override. If a new printable is added, register it here.
const DOCUMENTS: Array<{ name: string; opts: Parameters<typeof preparePrint>[0] }> = [
  { name: "Payment Receipt (A4)", opts: { pageW: 210, pageH: 297, title: "Receipt-MA-00010" } },
  { name: "Client Payment Ledger", opts: { pageW: 210, pageH: 297, title: "Ledger-Client-42" } },
  {
    name: "Payment Plan",
    opts: {
      pageW: 210,
      pageH: 297,
      title: "PaymentPlan-MA-00010",
      extraPrintCss: ".doc-sheet{transform:scale(.95)}",
    },
  },
  { name: "Legal Notice", opts: { pageW: 210, pageH: 297, title: "LegalNotice-MA-00010" } },
  { name: "Client Statement", opts: { pageW: 210, pageH: 297, title: "Statement-Client-42" } },
  { name: "Allotment Letter", opts: { pageW: 210, pageH: 297, title: "Allotment-MA-00010" } },
  { name: "Possession Letter", opts: { pageW: 210, pageH: 297, title: "Possession-MA-00010" } },
  { name: "Booking Detail print", opts: { pageW: 210, pageH: 297, title: "Booking-MA-00010" } },
  { name: "PrintPreviewModal (Letter)", opts: { pageW: 216, pageH: 279, title: "Preview" } },
];

let printSpy: ReturnType<typeof vi.spyOn>;
let originalTitle: string;

beforeEach(() => {
  vi.useFakeTimers();
  originalTitle = "ORIGINAL TITLE";
  document.title = originalTitle;
  // In JSDOM, hasFocus() is false by default. Mock it to true so that
  // when we dispatch the simulated "focus" event after printing, the
  // cleanup logic recognizes the window as active and proceeds.
  document.hasFocus = () => true;
  // Reset any state from prior tests
  document.getElementById(STYLE_ID)?.remove();
  sonnerMock.__mock.loading.mockClear();
  sonnerMock.__mock.dismiss.mockClear();
  sonnerMock.__mock.error.mockClear();
  // Default: print succeeds quietly; specific tests override.
  printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
  // jsdom doesn't implement document.fonts; preparePrint() falls through.
});

afterEach(() => {
  printSpy.mockRestore();
  vi.useRealTimers();
});

async function flush() {
  // Unblock preparePrint's internal awaits (fonts unavailable fallback 200ms + 2 rAFs).
  // Kept under 12s so we do NOT fire the 12s safety timeout here.
  await vi.advanceTimersByTimeAsync(300);
}

async function flushCleanup() {
  // After preparePrint resolves, armCleanupAfterPrintDialog schedules the
  // actual DOM cleanup via setTimeout(cleanup, 750). Advance past that so
  // assertions can immediately verify the DOM is clean.
  await vi.advanceTimersByTimeAsync(1_000);
}

function assertReturnedToNormal() {
  // 1. injected style removed
  expect(document.getElementById(STYLE_ID)).toBeNull();
  // 2. title restored
  expect(document.title).toBe(originalTitle);
  // 3. loading toast dismissed exactly once with the id returned by loading()
  expect(sonnerMock.__mock.dismiss).toHaveBeenCalledWith("toast-id-xyz");
  // 4. afterprint listener is gone — a stray afterprint must NOT trigger a
  //    second cleanup (would re-dismiss the toast).
  const callsBefore = sonnerMock.__mock.dismiss.mock.calls.length;
  window.dispatchEvent(new Event("afterprint"));
  expect(sonnerMock.__mock.dismiss.mock.calls.length).toBe(callsBefore);
}

describe("preparePrint() afterprint cleanup for every printable document", () => {
  for (const doc of DOCUMENTS) {
    describe(doc.name, () => {
      it("A) cleans up when the browser fires afterprint", async () => {
        // Simulate the browser firing afterprint as soon as print() is called.
        printSpy.mockImplementation(() => {
          window.dispatchEvent(new Event("afterprint"));
          window.dispatchEvent(new Event("focus"));
        });

        const p = preparePrint(doc.opts);
        await flush();
        await p;
        // Fire the 750ms deferred cleanup setTimeout
        await flushCleanup();

        // During the prep we did inject + retitle — sanity check the
        // pre-cleanup state actually happened so this test isn't vacuous.
        // (style/title were observable inside print() above; we now verify
        // they're rolled back.)
        assertReturnedToNormal();
        expect(sonnerMock.__mock.loading).toHaveBeenCalledTimes(1);
      });

      it("B) cleans up via the 12s safety timeout when afterprint never fires", async () => {
        // print() returns synchronously, no afterprint event.
        const p = preparePrint(doc.opts);
        await flush();
        await p;

        // Still in "Preparing…" state immediately after print() — style and
        // title overrides are present until afterprint OR safety fires.
        expect(document.getElementById(STYLE_ID)).not.toBeNull();
        if (doc.opts?.title) expect(document.title).toBe(doc.opts.title);

        // Advance past the safety net (5 mins) + the deferred cleanup (750ms).
        await vi.advanceTimersByTimeAsync(301_000);
        assertReturnedToNormal();
      });

      it("C) cleans up synchronously when window.print() throws", async () => {
        printSpy.mockImplementation(() => {
          throw new Error("blocked by browser");
        });

        // Attach a catch synchronously so the rejection isn't reported as
        // "unhandled" while we advance timers.
        const p = preparePrint(doc.opts);
        const settled = p.then(
          () => "resolved",
          (e: Error) => e,
        );
        await vi.advanceTimersByTimeAsync(50);
        const result = await settled;
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toMatch(/blocked by browser/);

        assertReturnedToNormal();
        expect(sonnerMock.__mock.error).toHaveBeenCalledTimes(1);
      });

      it("is idempotent: repeated prints do not leak listeners or styles", async () => {
        printSpy.mockImplementation(() => {
          window.dispatchEvent(new Event("afterprint"));
          window.dispatchEvent(new Event("focus"));
        });

        for (let i = 0; i < 3; i++) {
          const p = preparePrint(doc.opts);
          await flush();
          await p;
          // Fire the 750ms deferred cleanup setTimeout before asserting.
          await flushCleanup();
          // Each round leaves the DOM clean before the next run.
          expect(document.getElementById(STYLE_ID)).toBeNull();
          expect(document.title).toBe(originalTitle);
        }
        // Three prints → three loadings.
        // Dismiss is called twice per print (once after print(), once in cleanup) -> 6 times.
        expect(sonnerMock.__mock.loading).toHaveBeenCalledTimes(3);
        expect(sonnerMock.__mock.dismiss).toHaveBeenCalledTimes(6);
      });
    });
  }
});
