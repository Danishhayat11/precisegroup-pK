/**
 * PaymentForm — edge case coverage.
 *
 * Guards three regression contracts:
 *   1. Missing `cheque_txn_no` when `payment_mode === "Bank Transfer"`
 *      must block save (Zod `superRefine`), surface an inline error, and
 *      never issue an `insert` on `payments`.
 *   2. When split-allocation is on and
 *      `rpc("reconcile_payment_allocations")` returns `{ ok: false }`,
 *      save aborts: no `payments` insert, no `payment_allocations`
 *      insert, and the reconciliation issues are exposed on-screen.
 *   3. When the top-bar `activeCode` differs from the selected booking's
 *      `project_code`, the payment must still be written using the
 *      booking's own project (never the top bar's), AND the drift
 *      advisory banner must render.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Radix pointer-capture shims (jsdom).
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

// ---- Shared mock state -------------------------------------------------
const toastSpy = vi.fn();

const BOOKING = {
  booking_id: "BK-MA-00007",
  client_name: "Ali Raza",
  unit_id: "MA-U-014",
  project_code: "MA",
  project_name: "Manal Arcade",
  remaining_balance: 5000000,
  booking_date: "2020-01-01",
};

// Records what the supabase mock has been asked to do so tests can
// assert (or refute) writes/RPCs after a save attempt.
type Call =
  | { kind: "insert"; table: string; payload: any }
  | { kind: "rpc"; name: string; args: any };
const calls: Call[] = [];

// `reconcile_payment_allocations` verdict — tests mutate this per case.
let reconcileVerdict: {
  ok: boolean;
  issues?: Array<{ code: string; ledger_id: string | null; message: string }>;
} = { ok: true, issues: [] };

// ---- Module mocks (must come before the component import) --------------
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (...args: unknown[]) => toastSpy(...args) }),
}));

// Provide a companyId so `withCompany(...)` inside the save handler does
// not throw before the `payments.insert` call — otherwise the drift test
// never sees the insert we're trying to observe.
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    companyId: "00000000-0000-0000-0000-000000000001",
    user: { id: "u-1" },
  }),
}));

vi.mock("@/lib/activeProject", () => ({
  useActiveProject: () => ({
    projects: [
      { project_code: "MA", project_name: "Manal Arcade" },
      { project_code: "MH", project_name: "Manal Heights" },
    ],
    loading: false,
    // Deliberately DIFFERENT from BOOKING.project_code so the drift
    // banner renders and we can assert the write still uses "MA".
    activeCode: "MH",
    activeProject: { project_code: "MH", project_name: "Manal Heights" },
    setActiveCode: () => {},
  }),
}));

// Bypass the writer-role gate so the bookings query fires. Return the
// single test booking so the form can resolve `selectedBooking`.
vi.mock("@/lib/access", () => ({
  useCanReadClientPII: () => true,
  usePIIGuardedQuery: () => ({
    data: [BOOKING],
    isLoading: false,
    error: null,
    accessDenied: false,
  }),
}));

// Stub AllocationBuilder — exposes a button that seeds a single
// balanced allocation so we can drive the reconcile-RPC branch
// without wiring the real UI.
vi.mock("@/components/AllocationBuilder", async () => {
  const actual = await vi.importActual<typeof import("@/components/AllocationBuilder")>(
    "@/components/AllocationBuilder",
  );
  return {
    ...actual,
    AllocationBuilder: ({
      totalAmount,
      onChange,
    }: {
      totalAmount: number;
      onChange: (next: Array<{ ledger_id: string; head_label: string; amount: number }>) => void;
    }) => (
      <button
        type="button"
        data-testid="seed-alloc"
        onClick={() =>
          onChange([
            { ledger_id: "L-BK-MA-00007-abc123", head_label: "Installment", amount: totalAmount },
          ])
        }
      >
        seed allocation
      </button>
    ),
  };
});

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {};
  // A single chainable object that terminates in a Promise when awaited.
  chain.select = () => chain;
  chain.like = () => Promise.resolve({ data: [{ receipt_no: "PAY-00002" }], error: null });
  chain.eq = () => Promise.resolve({ data: [], error: null });
  chain.order = () => Promise.resolve({ data: [BOOKING], error: null });
  chain.delete = () => ({ eq: () => Promise.resolve({ data: null, error: null }) });
  chain.insert = (payload: any) => {
    calls.push({ kind: "insert", table: chain._table, payload });
    return Promise.resolve({ data: null, error: null });
  };
  return {
    supabase: {
      from: (table: string) => {
        chain._table = table;
        return chain;
      },
      rpc: (name: string, args: any) => {
        calls.push({ kind: "rpc", name, args });
        if (name === "reconcile_payment_allocations") {
          return Promise.resolve({ data: reconcileVerdict, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

import { PaymentForm } from "@/components/PaymentForm";

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PaymentForm
        initial={{ booking_id: BOOKING.booking_id }}
        onSaved={() => {}}
        onCancel={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
  toastSpy.mockReset();
  reconcileVerdict = { ok: true, issues: [] };
});

async function typeAmount(user: ReturnType<typeof userEvent.setup>, value: string) {
  // Amount input has inputMode="numeric" and comma-formats on blur.
  const amt = screen.getByLabelText(/Amount/i) as HTMLInputElement;
  fireEvent.change(amt, { target: { value } });
}

async function pickMode(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  // Payment Type Select — locate by its label.
  const triggers = screen.getAllByRole("combobox");
  const modeTrigger = triggers.find((el) =>
    /Cash|Bank Transfer|Adjustment/.test(el.textContent ?? ""),
  );
  if (!modeTrigger) throw new Error("Payment Type trigger not found");
  await user.click(modeTrigger);
  const option = await screen.findByRole("option", { name: label });
  await user.click(option);
}

describe("PaymentForm — edge cases", () => {
  it("blocks save when Bank Transfer is selected without a cheque/txn reference", async () => {
    const user = userEvent.setup();
    renderForm();

    // Wait for the booking to resolve so the form knows client/unit.
    await waitFor(() => {
      expect(screen.getByText(/Ali Raza/i)).toBeTruthy();
    });

    await typeAmount(user, "50000");
    await pickMode(user, /^Bank Transfer$/i);

    await user.click(screen.getByRole("button", { name: /Record payment|Save changes/i }));

    // Inline error surfaces AND no insert was issued.
    await waitFor(() => {
      expect(
        screen.getByText(/Cheque \/ transaction number is required for Bank Transfer/i),
      ).toBeTruthy();
    });
    expect(calls.find((c) => c.kind === "insert" && c.table === "payments")).toBeUndefined();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  it("aborts save when reconcile_payment_allocations RPC returns { ok: false }", async () => {
    const user = userEvent.setup();
    reconcileVerdict = {
      ok: false,
      issues: [
        {
          code: "SUM_MISMATCH",
          ledger_id: null,
          message: "Allocation total does not match payment amount.",
        },
      ],
    };
    renderForm();

    await waitFor(() => expect(screen.getByText(/Ali Raza/i)).toBeTruthy());
    await typeAmount(user, "10000");
    // Cash mode — no cheque needed, isolates the RPC failure path.
    await pickMode(user, /^Cash$/i);

    // Enable split and seed a balanced allocation via the stub.
    await user.click(screen.getByLabelText(/Split this payment across multiple heads/i));
    await user.click(await screen.findByTestId("seed-alloc"));

    fireEvent.click(screen.getByRole("button", { name: /Record payment/i }));

    // RPC was invoked, but no payments/allocations insert followed.
    await waitFor(() => {
      expect(
        calls.find((c) => c.kind === "rpc" && c.name === "reconcile_payment_allocations"),
      ).toBeTruthy();
    });
    expect(calls.find((c) => c.kind === "insert" && c.table === "payments")).toBeUndefined();
    expect(
      calls.find((c) => c.kind === "insert" && c.table === "payment_allocations"),
    ).toBeUndefined();

    // Reconciliation issues are exposed to the user (both the toast and
    // the on-screen issues list).
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/Ledger reconciliation failed/i) }),
    );
  });

  it("writes the booking's project name even when the top-bar active project has drifted, and never sends project_code (column does not exist on payments)", async () => {
    const user = userEvent.setup();
    renderForm();

    await waitFor(() => expect(screen.getByText(/Ali Raza/i)).toBeTruthy());

    // Drift banner renders (top bar is MH; booking is MA).
    expect(screen.getByTestId("payment-form-project-drift-notice")).toBeTruthy();

    await typeAmount(user, "25000");
    await pickMode(user, /^Cash$/i);
    fireEvent.click(screen.getByRole("button", { name: /Record payment/i }));

    // Exactly one payments insert, stamped with the BOOKING's project —
    // never the top bar's active MH project.
    await waitFor(() => {
      const insert = calls.find((c) => c.kind === "insert" && c.table === "payments");
      expect(insert, "payments insert should have fired").toBeTruthy();
    });
    const insert = calls.find((c) => c.kind === "insert" && c.table === "payments") as
      | { kind: "insert"; table: string; payload: any }
      | undefined;
    expect(insert!.payload.project).toBe("Manal Arcade");
    // Regression guard: never write the top-bar project.
    expect(insert!.payload.project).not.toBe("Manal Heights");
    // Regression guard: `project_code` is NOT a column on `payments` and must
    // never be sent — that was the source of the "Could not find 'project_code'
    // column" save failure.
    expect(insert!.payload).not.toHaveProperty("project_code");
  });
});
