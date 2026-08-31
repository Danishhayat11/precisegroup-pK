/**
 * Unit tests — <TeamHeadshot> objectPosition validation failures are
 * forwarded to observability surfaces:
 *
 *   • `window.Sentry.captureMessage` (level "warning") — tagged with the
 *     member id + reason, offending value in `extra`.
 *   • `window.Sentry.addBreadcrumb` — same payload for surrounding
 *     user-action context.
 *   • `CustomEvent("team-headshot:objectPosition-invalid")` on `window`
 *     — non-Sentry monitors (Datadog RUM, custom telemetry).
 *
 * Guards against regressions where a refactor silently drops the
 * monitoring hook (leaving only the console.warn, which prod dashboards
 * generally don't ingest).
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamHeadshot, type ObjectPosition } from "@/components/site/TeamHeadshot";

const MEMBER = "Test Subject";
const BAD_VALUE = "centre 30vh";
const FALLBACK = "center 30%";

function pictureProps() {
  return {
    name: MEMBER,
    alt: "Test subject portrait",
    avifSrcSet: "/a-320.avif 320w",
    webpSrcSet: "/w-320.webp 320w",
    fallback: "/f-640.jpg",
  };
}

describe("TeamHeadshot — objectPosition monitoring", () => {
  let captureMessage: ReturnType<typeof vi.fn>;
  let addBreadcrumb: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let dispatchSpy: ReturnType<typeof vi.spyOn>;
  let originalSentry: unknown;

  beforeEach(() => {
    captureMessage = vi.fn();
    addBreadcrumb = vi.fn();
    // Install a fake Sentry on window matching the SentryLike shape the
    // component narrows against. Preserve any pre-existing global so
    // parallel test files don't collide.
    originalSentry = (window as unknown as { Sentry?: unknown }).Sentry;
    (window as unknown as { Sentry?: unknown }).Sentry = {
      captureMessage,
      addBreadcrumb,
    };
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    dispatchSpy = vi.spyOn(window, "dispatchEvent");
  });

  afterEach(() => {
    (window as unknown as { Sentry?: unknown }).Sentry = originalSentry;
    warnSpy.mockRestore();
    dispatchSpy.mockRestore();
  });

  it("forwards invalid objectPosition to Sentry with member id + offending value", () => {
    render(
      <TeamHeadshot {...pictureProps()} objectPosition={BAD_VALUE as unknown as ObjectPosition} />,
    );

    // captureMessage: level warning, tags include the member and reason,
    // extra carries the raw offending value + the fallback that shipped.
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [msg, ctx] = captureMessage.mock.calls[0] as [
      string,
      {
        level?: string;
        tags?: Record<string, string>;
        extra?: Record<string, unknown>;
      },
    ];
    expect(msg).toContain("[TeamHeadshot]");
    expect(msg).toContain(`invalid objectPosition="${BAD_VALUE}"`);
    expect(msg).toContain(MEMBER);
    expect(ctx?.level).toBe("warning");
    expect(ctx?.tags).toMatchObject({
      component: "TeamHeadshot",
      kind: "objectPosition",
      reason: "invalid",
      member: MEMBER,
    });
    expect(ctx?.extra).toMatchObject({
      value: BAD_VALUE,
      fallback: FALLBACK,
    });

    // Breadcrumb — same payload, ui.team-headshot category.
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    const [bc] = addBreadcrumb.mock.calls[0] as [
      {
        category: string;
        message: string;
        level?: string;
        data?: Record<string, unknown>;
      },
    ];
    expect(bc.category).toBe("ui.team-headshot");
    expect(bc.level).toBe("warning");
    expect(bc.data).toMatchObject({
      member: MEMBER,
      value: BAD_VALUE,
      fallback: FALLBACK,
    });

    // CustomEvent bridge — one dispatch, correct type + detail.
    const invalidEvents = dispatchSpy.mock.calls
      .map((call: unknown[]) => call[0] as Event)
      .filter((ev: Event) => ev.type === "team-headshot:objectPosition-invalid");
    expect(invalidEvents).toHaveLength(1);
    expect((invalidEvents[0] as CustomEvent).detail).toMatchObject({
      name: MEMBER,
      reason: "invalid",
      value: BAD_VALUE,
      fallback: FALLBACK,
    });
  });

  it("forwards missing objectPosition (reason=missing, value=null in extra)", () => {
    render(<TeamHeadshot {...pictureProps()} />);

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [, ctx] = captureMessage.mock.calls[0] as [
      string,
      { tags?: Record<string, string>; extra?: Record<string, unknown> },
    ];
    expect(ctx?.tags?.reason).toBe("missing");
    expect(ctx?.tags?.member).toBe(MEMBER);
    expect(ctx?.extra).toMatchObject({ value: null, fallback: FALLBACK });
  });

  it("does not call Sentry for valid values", () => {
    render(<TeamHeadshot {...pictureProps()} objectPosition="center 22%" />);
    expect(captureMessage).not.toHaveBeenCalled();
    expect(addBreadcrumb).not.toHaveBeenCalled();
    const invalidEvents = dispatchSpy.mock.calls
      .map((call: unknown[]) => call[0] as Event)
      .filter((ev: Event) => ev.type === "team-headshot:objectPosition-invalid");
    expect(invalidEvents).toHaveLength(0);
  });

  it("still dispatches the CustomEvent when Sentry is absent", () => {
    (window as unknown as { Sentry?: unknown }).Sentry = undefined;
    render(
      <TeamHeadshot {...pictureProps()} objectPosition={BAD_VALUE as unknown as ObjectPosition} />,
    );
    expect(captureMessage).not.toHaveBeenCalled();
    const invalidEvents = dispatchSpy.mock.calls
      .map((call: unknown[]) => call[0] as Event)
      .filter((ev: Event) => ev.type === "team-headshot:objectPosition-invalid");
    expect(invalidEvents).toHaveLength(1);
  });
});
