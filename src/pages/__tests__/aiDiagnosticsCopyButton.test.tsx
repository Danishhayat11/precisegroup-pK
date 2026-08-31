/**
 * Contract test: the SHARED CopyButton shell that powers every copy
 * affordance on the AI Diagnostics page (Copy link, Copy payload,
 * Copy error message, Copy arguments, Copy result).
 *
 * The existing `aiDiagnosticsCopyLink.test.tsx` locks down the
 * URL-flavoured wrapper. This suite covers the properties the shell
 * itself has to guarantee for the OTHER copy buttons:
 *
 *   1. Whatever `getText()` returns is EXACTLY what hits the
 *      clipboard — no re-encoding, no substitution with
 *      `window.location.href` (that would silently corrupt "Copy
 *      payload" / "Copy error message" buttons which need JSON /
 *      plain-text, not a URL).
 *   2. Multiple CopyButton instances on the same page keep their
 *      status independent — clicking "Copy payload" must not flip
 *      the sibling "Copy result" to Copied!.
 *   3. On success a confirmation panel shows the copied text
 *      (truncated head+tail for long values, full text on hover via
 *      `title`, full text in the aria-live announcement).
 *   4. On failure the error fallback appears and any prior copied
 *      confirmation is torn down (the two states are mutually
 *      exclusive — never "Copied: X" and "Copy failed" side by side).
 *
 * The harness re-implements the shipped CopyButton verbatim so the
 * suite stays hermetic (importing the page pulls supabase + router).
 * Keep in sync with src/pages/AiDiagnosticsPage.tsx.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";

// ── Verbatim copy of the shipped helpers + shell ────────────────────

type CopyReason = "insecure" | "unsupported" | "denied" | "unknown";
type CopyResult = { ok: true } | { ok: false; reason: CopyReason; message: string };

function copyReasonMessage(reason: CopyReason, detail?: string): string {
  switch (reason) {
    case "insecure":
      return "Clipboard access isn't available on insecure (HTTP) pages. Use the text field below to copy manually.";
    case "unsupported":
      return "Your browser doesn't allow clipboard access from this page. Use the text field below to copy manually.";
    case "denied":
      return "Clipboard permission was denied. Allow clipboard access in your browser's site settings, or use the text field below to copy manually.";
    case "unknown":
    default:
      return detail
        ? `Copy failed: ${detail}. Use the text field below to copy manually.`
        : "Copy failed. Use the text field below to copy manually.";
  }
}

async function copyToClipboard(text: string): Promise<CopyResult> {
  if (typeof window === "undefined") {
    return { ok: false, reason: "unsupported", message: copyReasonMessage("unsupported") };
  }
  const secure = window.isSecureContext !== false;
  const hasAsync = !!navigator.clipboard?.writeText;
  if (hasAsync && secure) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        return { ok: false, reason: "denied", message: copyReasonMessage("denied") };
      }
    }
  }
  if (!secure) return { ok: false, reason: "insecure", message: copyReasonMessage("insecure") };
  if (!hasAsync)
    return { ok: false, reason: "unsupported", message: copyReasonMessage("unsupported") };
  return { ok: false, reason: "unknown", message: copyReasonMessage("unknown") };
}

function truncateForConfirm(text: string, max = 72): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function CopyButton({
  getText,
  idleLabel,
  copiedLabel = "Copied!",
  errorLabel = "Retry",
  ariaIdleLabel,
  testId,
}: {
  getText: () => string;
  idleLabel: string;
  copiedLabel?: string;
  errorLabel?: string;
  ariaIdleLabel: string;
  /** Distinguishes multiple CopyButton instances rendered in the same
   *  test — every testid/scoped query is prefixed with this. Not part
   *  of the shipped component's public API; harness convenience only. */
  testId: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const [errorReason, setErrorReason] = useState<CopyReason | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [pendingText, setPendingText] = useState<string>("");
  const [copiedText, setCopiedText] = useState<string>("");
  const fallbackRef = useRef<HTMLInputElement | null>(null);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = getText();
    const result = await copyToClipboard(text);
    if (result.ok) {
      setStatus("copied");
      setErrorReason(null);
      setErrorMessage("");
      setPendingText("");
      setCopiedText(text);
      window.setTimeout(() => {
        setStatus("idle");
        setCopiedText("");
      }, 2500);
      return;
    }
    setStatus("error");
    setErrorReason(result.reason);
    setErrorMessage(result.message);
    setPendingText(text);
    // Also clear the confirmation strip — the two states are mutually
    // exclusive, and a stale "Copied: X" next to a red error would be
    // actively misleading.
    setCopiedText("");
    if (result.reason !== "unknown") {
      window.setTimeout(() => {
        const el = fallbackRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      }, 0);
    }
    window.setTimeout(() => setStatus("idle"), 2000);
  };

  const ariaLabel =
    status === "copied"
      ? `${ariaIdleLabel} — copied to clipboard`
      : status === "error"
        ? `${ariaIdleLabel} — copy failed, press again`
        : ariaIdleLabel;

  const showFallback = errorReason !== null && pendingText.length > 0;
  const showCopiedConfirm = status === "copied" && copiedText.length > 0;
  const truncatedCopied = showCopiedConfirm ? truncateForConfirm(copiedText) : "";

  return (
    <span data-testid={`${testId}-root`}>
      <button type="button" onClick={onClick} aria-label={ariaLabel} title={ariaLabel}>
        <span data-testid={`${testId}-label`}>
          {status === "copied" ? copiedLabel : status === "error" ? errorLabel : idleLabel}
        </span>
        <span role="status" aria-live="polite" data-testid={`${testId}-live`}>
          {status === "copied"
            ? `${ariaIdleLabel}: copied to clipboard — ${copiedText}`
            : status === "error"
              ? `${ariaIdleLabel}: ${errorMessage}`
              : ""}
        </span>
      </button>
      {showCopiedConfirm && (
        <div data-testid={`${testId}-confirmation`}>
          <span>Copied:</span>
          <span dir="ltr" title={copiedText} data-testid={`${testId}-confirmation-text`}>
            {truncatedCopied}
          </span>
        </div>
      )}
      {showFallback && (
        <div role="alert" data-testid={`${testId}-fallback`}>
          <p data-testid={`${testId}-fallback-message`}>{errorMessage}</p>
          <input
            ref={fallbackRef}
            type="text"
            readOnly
            value={pendingText}
            data-testid={`${testId}-fallback-input`}
          />
        </div>
      )}
    </span>
  );
}

// ── Fixtures ────────────────────────────────────────────────────────

const JSON_PAYLOAD = JSON.stringify(
  {
    tool: "lookup_customer",
    round: 2,
    gateway_status: "429 Too Many Requests",
    retry_strategy: "sanitized",
    error_message: "rate limit exceeded",
  },
  null,
  2,
);

const ERROR_MESSAGE = "rate limit exceeded — please retry after 30s";

const LONG_URL =
  "http://localhost:8080/admin/ai-diagnostics" +
  "?q=this-is-an-extremely-long-search-query-that-exceeds-the-truncation-cap" +
  "&status=gateway-error&retry=sanitized&tool=lookup_customer&sort=duration&dir=desc&page=42&size=100";

// ── Test wiring ─────────────────────────────────────────────────────

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
});

async function clickAndFlush(btn: HTMLElement) {
  await act(async () => {
    fireEvent.click(btn);
  });
}

function getButton(root: HTMLElement) {
  return within(root).getByRole("button");
}

// ── Suites ──────────────────────────────────────────────────────────

describe("CopyButton — writes exactly what getText returns", () => {
  it("copies a JSON payload verbatim (no window.location.href substitution)", async () => {
    render(
      <CopyButton
        testId="payload"
        idleLabel="Copy payload"
        ariaIdleLabel="Copy full gateway error payload"
        getText={() => JSON_PAYLOAD}
      />,
    );

    await clickAndFlush(getButton(screen.getByTestId("payload-root")));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // Exact-string match — copy buttons must round-trip the payload
    // verbatim so pasting into a JSON tool parses cleanly.
    expect(writeText).toHaveBeenCalledWith(JSON_PAYLOAD);
    // And critically, NOT the page URL — a regression would silently
    // hand users the wrong thing.
    expect(writeText).not.toHaveBeenCalledWith(window.location.href);
  });

  it("copies a plain error message verbatim", async () => {
    render(
      <CopyButton
        testId="err"
        idleLabel="Copy"
        ariaIdleLabel="Copy error message"
        getText={() => ERROR_MESSAGE}
      />,
    );

    await clickAndFlush(getButton(screen.getByTestId("err-root")));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ERROR_MESSAGE));
  });

  it("re-evaluates getText on EVERY click (fresh snapshot per press)", async () => {
    let counter = 0;
    const getText = vi.fn(() => `snapshot-${++counter}`);
    render(
      <CopyButton testId="snap" idleLabel="Copy" ariaIdleLabel="Copy snapshot" getText={getText} />,
    );

    const btn = getButton(screen.getByTestId("snap-root"));
    await clickAndFlush(btn);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("snapshot-1"));

    // Wait for the 2.5s auto-clear so the second click transitions
    // idle → copied cleanly (avoids the harness returning early during
    // the still-copied window).
    await waitFor(() => expect(screen.queryByTestId("snap-confirmation")).not.toBeInTheDocument(), {
      timeout: 3000,
    });

    await clickAndFlush(btn);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("snapshot-2"));
    expect(getText).toHaveBeenCalledTimes(2);
  });
});

describe("CopyButton — copied / error state feedback", () => {
  it("shows a Copied confirmation with the exact copied text (short value not truncated)", async () => {
    render(
      <CopyButton
        testId="short"
        idleLabel="Copy"
        ariaIdleLabel="Copy short value"
        getText={() => ERROR_MESSAGE}
      />,
    );

    await clickAndFlush(getButton(screen.getByTestId("short-root")));

    // Label + icon + aria-live all confirm the success.
    await waitFor(() => expect(screen.getByTestId("short-label")).toHaveTextContent(/^Copied!$/));
    const confirmText = screen.getByTestId("short-confirmation-text");
    expect(confirmText.textContent).toBe(ERROR_MESSAGE);
    expect(confirmText).toHaveAttribute("title", ERROR_MESSAGE);
    // Live-region announcement includes the FULL copied value.
    expect(screen.getByTestId("short-live").textContent).toContain(ERROR_MESSAGE);
  });

  it("truncates long copied text (head + tail with ellipsis) while keeping the full value in title/aria-live", async () => {
    render(
      <CopyButton
        testId="long"
        idleLabel="Copy link"
        ariaIdleLabel="Copy link to this filtered view"
        getText={() => LONG_URL}
      />,
    );

    await clickAndFlush(getButton(screen.getByTestId("long-root")));
    await waitFor(() => expect(screen.getByTestId("long-confirmation")).toBeInTheDocument());

    const confirmText = screen.getByTestId("long-confirmation-text");
    const shown = confirmText.textContent ?? "";
    // Truncated visible text: length capped and includes an ellipsis
    // somewhere in the middle so both head and tail are visible.
    expect(shown.length).toBeLessThan(LONG_URL.length);
    expect(shown).toContain("…");
    expect(shown.length).toBeLessThanOrEqual(72);
    // Head preserved so the origin is recognisable.
    expect(shown.startsWith(LONG_URL.slice(0, 8))).toBe(true);
    // Tail preserved so the meaningful query-tail (page=42&size=100)
    // is visible without hovering.
    expect(shown.endsWith(LONG_URL.slice(-8))).toBe(true);
    // Hover tooltip + aria-live carry the FULL untruncated URL so no
    // information is lost.
    expect(confirmText).toHaveAttribute("title", LONG_URL);
    expect(screen.getByTestId("long-live").textContent).toContain(LONG_URL);
  });

  it("auto-dismisses the copied confirmation together with the button label", async () => {
    render(
      <CopyButton
        testId="auto"
        idleLabel="Copy"
        ariaIdleLabel="Copy value"
        getText={() => "abc"}
      />,
    );

    await clickAndFlush(getButton(screen.getByTestId("auto-root")));
    await waitFor(() => expect(screen.getByTestId("auto-confirmation")).toBeInTheDocument());

    // Both the label AND the confirmation strip must clear together —
    // a stale "Copied: abc" strip next to an idle "Copy" button
    // would misrepresent the current state.
    await waitFor(
      () => {
        expect(screen.getByTestId("auto-label")).toHaveTextContent(/^Copy$/);
        expect(screen.queryByTestId("auto-confirmation")).not.toBeInTheDocument();
      },
      { timeout: 3500 },
    );
  });

  it("shows the error fallback (not a confirmation) when the clipboard rejects", async () => {
    writeText.mockRejectedValueOnce(new DOMException("permission denied", "NotAllowedError"));
    render(
      <CopyButton
        testId="err2"
        idleLabel="Copy payload"
        ariaIdleLabel="Copy payload"
        getText={() => JSON_PAYLOAD}
      />,
    );

    await clickAndFlush(getButton(screen.getByTestId("err2-root")));
    await waitFor(() => expect(screen.getByTestId("err2-label")).toHaveTextContent(/^Retry$/));

    // Error fallback appears with the exact payload pre-loaded for
    // manual copy...
    // `<input type="text">` strips newlines from its `value` (single-
    // line control), so compare after collapsing whitespace. The
    // fallback still lets the user copy the JSON — it just loses the
    // pretty-printing until they paste it into a JSON tool.
    const fallbackValue = (screen.getByTestId("err2-fallback-input") as HTMLInputElement).value;
    expect(fallbackValue.replace(/\s/g, "")).toBe(JSON_PAYLOAD.replace(/\s/g, ""));
    expect(screen.getByTestId("err2-fallback-message").textContent).toMatch(
      /Clipboard permission was denied/,
    );
    // ...and the success confirmation is NOT rendered (mutually
    // exclusive with the error state).
    expect(screen.queryByTestId("err2-confirmation")).not.toBeInTheDocument();
  });

  it("torn-down confirmation: a failure after a success removes any stale Copied strip", async () => {
    writeText
      .mockResolvedValueOnce(undefined) // 1st: success
      .mockRejectedValueOnce(new DOMException("nope", "NotAllowedError")); // 2nd: fail
    render(
      <CopyButton
        testId="mixed"
        idleLabel="Copy"
        ariaIdleLabel="Copy value"
        getText={() => "hello"}
      />,
    );

    const btn = getButton(screen.getByTestId("mixed-root"));
    await clickAndFlush(btn);
    await waitFor(() => expect(screen.getByTestId("mixed-confirmation")).toBeInTheDocument());

    // Retry while the confirmation is still showing — the failure
    // must clear the confirmation, not leave both panels stacked.
    await clickAndFlush(btn);
    await waitFor(() => expect(screen.getByTestId("mixed-fallback")).toBeInTheDocument());
    expect(screen.queryByTestId("mixed-confirmation")).not.toBeInTheDocument();
  });
});

describe("CopyButton — multiple instances stay independent", () => {
  it("clicking one button does not flip the sibling's state", async () => {
    render(
      <>
        <CopyButton
          testId="args"
          idleLabel="Copy"
          ariaIdleLabel="Copy arguments"
          getText={() => '{"a":1}'}
        />
        <CopyButton
          testId="result"
          idleLabel="Copy"
          ariaIdleLabel="Copy result"
          getText={() => '{"ok":true}'}
        />
      </>,
    );

    // Sanity: both start idle.
    expect(screen.getByTestId("args-label")).toHaveTextContent(/^Copy$/);
    expect(screen.getByTestId("result-label")).toHaveTextContent(/^Copy$/);

    await clickAndFlush(getButton(screen.getByTestId("args-root")));

    // Only the clicked button flips — writeText was called with the
    // args payload, and the sibling result button stays idle with no
    // confirmation strip.
    await waitFor(() => expect(screen.getByTestId("args-label")).toHaveTextContent(/^Copied!$/));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('{"a":1}');

    expect(screen.getByTestId("result-label")).toHaveTextContent(/^Copy$/);
    expect(screen.queryByTestId("result-confirmation")).not.toBeInTheDocument();
    expect(screen.getByTestId("args-confirmation-text").textContent).toBe('{"a":1}');
  });
});
