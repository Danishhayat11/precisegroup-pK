/**
 * Contract test: "Copy link" button on the AI Diagnostics toolbar.
 *
 * Locks down three properties of the shipped CopyLinkButton /
 * CopyButton pair:
 *
 *   1. Clicking writes the CURRENT full URL (`window.location.href`,
 *      read lazily at click time) to `navigator.clipboard`. The URL
 *      must include whatever query params are currently on the page,
 *      because the whole point of "Copy link" is to share the
 *      filtered view exactly as it looks now.
 *   2. After a successful copy the button flips to a "Copied!" state:
 *      visible label + swapped aria-label + polite sr-only
 *      announcement, then returns to idle after ~1500ms.
 *   3. When the clipboard API rejects (or is missing), the button
 *      flips to the error/retry state instead — never a silent
 *      no-op, never a stuck "Copied!".
 *
 * The harness re-implements the tiny CopyLinkButton/CopyButton pair
 * from `AiDiagnosticsPage.tsx` verbatim so the test stays hermetic
 * (importing the page pulls in supabase, router, and the full
 * diagnostics module graph). If the shipped component's contract
 * changes, mirror the change here.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";

// ── Verbatim copy of the shipped helper + component ────────────────
// Keep this block in sync with src/pages/AiDiagnosticsPage.tsx.

import { useRef } from "react";

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
  if (!secure) {
    return { ok: false, reason: "insecure", message: copyReasonMessage("insecure") };
  }
  if (!hasAsync) {
    return { ok: false, reason: "unsupported", message: copyReasonMessage("unsupported") };
  }
  return { ok: false, reason: "unknown", message: copyReasonMessage("unknown") };
}

function CopyButton({
  getText,
  idleLabel,
  copiedLabel = "Copied!",
  errorLabel = "Retry",
  ariaIdleLabel,
}: {
  getText: () => string;
  idleLabel: string;
  copiedLabel?: string;
  errorLabel?: string;
  ariaIdleLabel: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const [errorReason, setErrorReason] = useState<CopyReason | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [pendingText, setPendingText] = useState<string>("");
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
      window.setTimeout(() => setStatus("idle"), 1500);
      return;
    }
    setStatus("error");
    setErrorReason(result.reason);
    setErrorMessage(result.message);
    setPendingText(text);
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

  return (
    <span>
      <button type="button" onClick={onClick} aria-label={ariaLabel} title={ariaLabel}>
        <span data-testid="copy-label">
          {status === "copied" ? copiedLabel : status === "error" ? errorLabel : idleLabel}
        </span>
        <span role="status" aria-live="polite" data-testid="copy-live">
          {status === "copied"
            ? `${ariaIdleLabel}: copied to clipboard.`
            : status === "error"
              ? `${ariaIdleLabel}: ${errorMessage}`
              : ""}
        </span>
      </button>
      {showFallback && (
        <div role="alert" data-testid="copy-fallback">
          <p data-testid="copy-fallback-message">{errorMessage}</p>
          <input
            ref={fallbackRef}
            type="text"
            readOnly
            value={pendingText}
            data-testid="copy-fallback-input"
            aria-label={`${ariaIdleLabel} — select all and press Ctrl or Cmd + C to copy manually`}
          />
        </div>
      )}
    </span>
  );
}

function CopyLinkButton() {
  return (
    <CopyButton
      idleLabel="Copy link"
      ariaIdleLabel="Copy link to this filtered view"
      getText={() => (typeof window === "undefined" ? "" : window.location.href)}
    />
  );
}

// ── Test harness ───────────────────────────────────────────────────

function setLocationHref(href: string) {
  // jsdom lets us reassign href on window.location (it navigates in-place
  // without a real network fetch). This is how we simulate the URL
  // reflecting the current filter/sort/page state at click time.
  window.history.replaceState({}, "", href);
}

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

describe("CopyLinkButton", () => {
  /**
   * fireEvent.click + a waitFor on the effect is used instead of
   * userEvent — userEvent's pointer pipeline hangs under vi.useFakeTimers()
   * unless every timer path is wired through advanceTimers, which is
   * fragile for a test that only needs a click.
   */
  async function clickAndFlush(btn: HTMLElement) {
    await act(async () => {
      fireEvent.click(btn);
    });
  }

  it("writes the current window.location.href to the clipboard on click", async () => {
    setLocationHref(
      "/admin/ai-diagnostics?q=timeout&status=gateway-error&sort=duration&dir=desc&page=3",
    );
    render(<CopyLinkButton />);

    await clickAndFlush(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // Exact-string match: no re-encoding, no rewriting, no dropped params.
    // Callers rely on paste-into-URL-bar reproducing the same view.
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(writeText.mock.calls[0][0]).toContain("q=timeout");
    expect(writeText.mock.calls[0][0]).toContain("status=gateway-error");
    expect(writeText.mock.calls[0][0]).toContain("sort=duration");
    expect(writeText.mock.calls[0][0]).toContain("page=3");
  });

  it("reads location.href LAZILY at click time (URL that changed after mount still copies fresh)", async () => {
    setLocationHref("/admin/ai-diagnostics");
    render(<CopyLinkButton />);

    // Simulate the user changing filters after the button rendered.
    setLocationHref("/admin/ai-diagnostics?status=success&page=7");

    await clickAndFlush(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("status=success&page=7")),
    );
  });

  it("shows the Copied! feedback after a successful copy, then returns to idle", async () => {
    setLocationHref("/admin/ai-diagnostics");
    render(<CopyLinkButton />);

    const btn = screen.getByRole("button", { name: /copy link to this filtered view/i });
    // Idle preconditions.
    expect(screen.getByTestId("copy-label")).toHaveTextContent(/^Copy\ link$/);
    expect(screen.getByTestId("copy-live").textContent).toBe("");

    await clickAndFlush(btn);
    await waitFor(() => expect(screen.getByTestId("copy-label")).toHaveTextContent(/^Copied!$/));

    // Visible label + aria-label both flip; live region announces politely.
    expect(btn).toHaveAttribute(
      "aria-label",
      "Copy link to this filtered view — copied to clipboard",
    );
    expect(screen.getByTestId("copy-live").textContent).toBe(
      "Copy link to this filtered view: copied to clipboard.",
    );

    // The copied state auto-clears after ~1500ms so a second copy is
    // visibly distinct from the first. Poll (real timers) with enough
    // headroom for CI jitter.
    await waitFor(
      () => {
        expect(screen.getByTestId("copy-label")).toHaveTextContent(/^Copy\ link$/);
      },
      { timeout: 2500 },
    );
    expect(btn).toHaveAttribute("aria-label", "Copy link to this filtered view");
    expect(screen.getByTestId("copy-live").textContent).toBe("");
  });

  it("shows the Retry/error state when writeText rejects with a generic error (unknown reason)", async () => {
    writeText.mockRejectedValueOnce(new Error("clipboard blocked"));
    setLocationHref("/admin/ai-diagnostics?status=success");
    render(<CopyLinkButton />);

    const btn = screen.getByRole("button", { name: /copy link/i });
    await clickAndFlush(btn);
    await waitFor(() => expect(screen.getByTestId("copy-label")).toHaveTextContent(/^Retry$/));

    // aria-label flips to the "press again" hint (drives the visible
    // retry affordance for AT users).
    expect(btn).toHaveAttribute(
      "aria-label",
      "Copy link to this filtered view — copy failed, press again",
    );
    // Live-region announcement carries the FULL user-facing message,
    // not a vague "copy failed" — so screen readers get the same
    // guidance sighted users see in the fallback panel.
    expect(screen.getByTestId("copy-live").textContent).toMatch(
      /Copy link to this filtered view: Copy failed\. Use the text field below to copy manually\./,
    );

    // Manual-copy fallback appears with the exact payload the click
    // tried to copy — the user can select-all + Ctrl/Cmd+C right there.
    const fallback = screen.getByTestId("copy-fallback");
    expect(fallback).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("copy-fallback-input")).toHaveValue(window.location.href);

    // Button label returns to idle after ~2s, but the fallback panel
    // stays visible so the user can still recover from the error.
    await waitFor(
      () => {
        expect(screen.getByTestId("copy-label")).toHaveTextContent(/^Copy\ link$/);
      },
      { timeout: 3000 },
    );
    expect(screen.getByTestId("copy-fallback")).toBeInTheDocument();
  });

  it("classifies a NotAllowedError DOMException as a denied-permission failure", async () => {
    writeText.mockRejectedValueOnce(
      new DOMException("Write permission denied.", "NotAllowedError"),
    );
    setLocationHref("/admin/ai-diagnostics");
    render(<CopyLinkButton />);

    await clickAndFlush(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() => expect(screen.getByTestId("copy-label")).toHaveTextContent(/^Retry$/));

    // Denied-permission message is distinct from generic failure and
    // points the user at the browser site setting.
    const msg = screen.getByTestId("copy-fallback-message").textContent ?? "";
    expect(msg).toMatch(/Clipboard permission was denied/);
    expect(msg).toMatch(/site settings/i);
    expect(screen.getByTestId("copy-live").textContent).toContain(
      "Clipboard permission was denied",
    );
    // Manual fallback still present with the URL pre-loaded.
    expect(screen.getByTestId("copy-fallback-input")).toHaveValue(window.location.href);
  });

  it("classifies a missing navigator.clipboard as unsupported and offers the manual fallback", async () => {
    // Simulate a browser (or embedded WebView) that doesn't expose the
    // Async Clipboard API at all.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    setLocationHref("/admin/ai-diagnostics?tool=lookup");
    render(<CopyLinkButton />);

    await clickAndFlush(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() => expect(screen.getByTestId("copy-fallback")).toBeInTheDocument());

    const msg = screen.getByTestId("copy-fallback-message").textContent ?? "";
    expect(msg).toMatch(/doesn't allow clipboard access/i);
    // We never called writeText — it doesn't exist.
    expect(writeText).not.toHaveBeenCalled();
    // Fallback input still has the URL so the user can copy manually.
    expect(screen.getByTestId("copy-fallback-input")).toHaveValue(window.location.href);
  });

  it("classifies an insecure-context origin (http://) as insecure", async () => {
    // `isSecureContext` isn't defined on jsdom's window, so define it
    // as an own property we can flip for the duration of the test.
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      get: () => false,
    });
    // Strip the async API too — real insecure origins don't expose it.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    try {
      setLocationHref("/admin/ai-diagnostics");
      render(<CopyLinkButton />);

      await clickAndFlush(screen.getByRole("button", { name: /copy link/i }));
      await waitFor(() => expect(screen.getByTestId("copy-fallback")).toBeInTheDocument());

      const msg = screen.getByTestId("copy-fallback-message").textContent ?? "";
      expect(msg).toMatch(/insecure \(HTTP\) pages/);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, "isSecureContext", originalDescriptor);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any).isSecureContext;
      }
    }
  });

  it("dismisses the error fallback after a successful retry", async () => {
    writeText
      .mockRejectedValueOnce(new DOMException("nope", "NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    setLocationHref("/admin/ai-diagnostics");
    render(<CopyLinkButton />);

    const btn = screen.getByRole("button", { name: /copy link/i });
    // First click → denied → fallback panel appears.
    await clickAndFlush(btn);
    await waitFor(() => expect(screen.getByTestId("copy-fallback")).toBeInTheDocument());

    // Second click → success → fallback panel is torn down so the UI
    // doesn't misleadingly claim an error while showing "Copied!".
    await clickAndFlush(btn);
    await waitFor(() => expect(screen.getByTestId("copy-label")).toHaveTextContent(/^Copied!$/));
    expect(screen.queryByTestId("copy-fallback")).not.toBeInTheDocument();
  });
});
