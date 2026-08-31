/**
 * BookingForm.projectSwitch — regression test.
 *
 * Guards the multi-project scoping contract implemented in earlier turns:
 * when the user changes the per-booking Project dropdown mid-form, the
 * displayed `Booking ID` MUST be regenerated under the new project's
 * `BK-{CODE}-XXXXX` prefix and MUST NEVER retain the previous prefix.
 *
 * Runs as a component test (jsdom + RTL) so we can drive the actual Radix
 * Select without spinning up Playwright:
 *   - `@/integrations/supabase/client` is mocked to serve deterministic
 *     "highest existing booking_id" data per project prefix, so
 *     `nextBookingId` returns predictable numbers.
 *   - `@/lib/activeProject` is mocked to feed the form a fixed project
 *     list (MA / MH / XH) so the Project dropdown has options to switch to.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Radix Select uses pointer capture APIs that jsdom doesn't ship. Also
// stub scrollIntoView because Radix scrolls the highlighted option into
// view on open.
beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (!proto.hasPointerCapture) {
    Object.assign(proto, {
      hasPointerCapture: () => false,
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      scrollIntoView: () => {},
    });
  }
});

// ---- Mocks ---------------------------------------------------------------
// nextBookingId reads `bookings.select("booking_id").like(...)`. The mock
// returns a per-prefix set of existing IDs so the "+1" result is
// deterministic and different for each project.
const EXISTING_BY_PREFIX: Record<string, Array<{ booking_id: string }>> = {
  "BK-MA-": [{ booking_id: "BK-MA-00007" }, { booking_id: "BK-MA-00012" }],
  "BK-MH-": [{ booking_id: "BK-MH-00003" }],
  "BK-XH-": [], // never had any bookings before
};

vi.mock("@/integrations/supabase/client", () => {
  const query: any = {
    select: () => query,
    like: (_col: string, pattern: string) => {
      const prefix = pattern.replace(/%$/, "");
      return Promise.resolve({ data: EXISTING_BY_PREFIX[prefix] ?? [], error: null });
    },
    eq: () => query,
    order: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    supabase: { from: () => query },
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

vi.mock("@/lib/activeProject", () => {
  const projects = [
    { project_code: "MA", project_name: "Manal Arcade" },
    { project_code: "MH", project_name: "Manal Heights" },
    { project_code: "XH", project_name: "Xeros Heights" },
  ];
  return {
    useActiveProject: () => ({
      projects,
      loading: false,
      activeCode: "MA",
      activeProject: projects[0],
      setActiveCode: () => {},
    }),
  };
});

// Import AFTER mocks so the module graph picks them up.
import { BookingForm } from "@/components/BookingForm";

// The Booking ID field is a read-only <input> — its label isn't wired
// with `htmlFor`, so locate it as the only mono-font input whose value
// starts with "BK-".
function getBookingIdInput() {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
  const match = inputs.find((el) => el.readOnly && /^BK-/.test(el.value));
  if (!match)
    throw new Error(
      `Booking ID input not found (values: ${inputs.map((i) => i.value).join(", ")})`,
    );
  return match;
}

describe("BookingForm — project switch regenerates booking_id", () => {
  it("starts at the active project's next id, then re-issues on every project change and never keeps a stale prefix", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <BookingForm onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    );

    // 1. First-render id must be BK-MA-00013 (max existing 00012 + 1).
    await waitFor(() => {
      expect(getBookingIdInput().value).toBe("BK-MA-00013");
    });

    // Helper: open the per-booking Project select and pick a project by
    // its display label ("Manal Heights (MH)"). The trigger has no
    // accessible name of its own — locate it via the Project label group.
    async function pickProject(displayLabel: RegExp) {
      // The <Select> for Project is the only one showing the placeholder
      // "Select project" or the current project's own display value.
      // We anchor on its trigger via role=combobox after opening it.
      const triggers = screen.getAllByRole("combobox");
      const projectTrigger = triggers.find((el) =>
        /Manal Arcade|Manal Heights|Xeros Heights|Select project/i.test(el.textContent ?? ""),
      );
      if (!projectTrigger) throw new Error("Project select trigger not found");
      await user.click(projectTrigger);
      const option = await screen.findByRole("option", { name: displayLabel });
      await user.click(option);
    }

    // 2. Switch MA → MH. During the effect's async gap the id gets
    //    cleared then repopulated. Assert both invariants: it never
    //    contains BK-MA- again, and it settles on BK-MH-00004.
    await pickProject(/Manal Heights\s*\(MH\)/i);
    await waitFor(() => {
      expect(getBookingIdInput().value).toBe("BK-MH-00004");
    });
    expect(getBookingIdInput().value).not.toMatch(/^BK-MA-/);

    // 3. Switch MH → XH (a project with no prior bookings). Must
    //    regenerate to BK-XH-00001, and MUST NOT keep the MH prefix.
    await pickProject(/Xeros Heights\s*\(XH\)/i);
    await waitFor(() => {
      expect(getBookingIdInput().value).toBe("BK-XH-00001");
    });
    expect(getBookingIdInput().value).not.toMatch(/^BK-MH-/);
    expect(getBookingIdInput().value).not.toMatch(/^BK-MA-/);

    // 4. Switch XH → MA. Even going "back" to the original project must
    //    query fresh, land on BK-MA-00013, and drop the XH prefix.
    await pickProject(/Manal Arcade\s*\(MA\)/i);
    await waitFor(() => {
      expect(getBookingIdInput().value).toBe("BK-MA-00013");
    });
    expect(getBookingIdInput().value).not.toMatch(/^BK-XH-/);
  });
});
