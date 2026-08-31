import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { buildPendingDrill, type PendingDrill } from "@/lib/pending";

/** Tiny stand-in that mirrors the markup the dashboard drill uses to render rows. */
function DrillTable({ drill }: { drill: PendingDrill }) {
  return (
    <table aria-label="Pending Balance">
      <thead>
        <tr>
          {drill.columns.map((c) => (
            <th key={c.label} data-align={c.align ?? "left"}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {drill.items.length === 0 ? (
          <tr>
            <td colSpan={drill.columns.length}>No rows</td>
          </tr>
        ) : (
          drill.items.map((row, i) => (
            <tr key={i} data-row={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))
        )}
      </tbody>
      <tfoot>
        <tr>
          <td>{drill.totalLabel}</td>
          <td data-testid="grand-total">{drill.total}</td>
        </tr>
      </tfoot>
    </table>
  );
}

const b = (id: string, name: string, unit: string, sell: number) => ({
  booking_id: id,
  client_name: name,
  unit_id: unit,
  sold_unit_value: sell,
});

describe("Pending Balance drill (UI)", () => {
  it("renders Received and Pending columns derived from cash + approved adjustments", () => {
    const drill = buildPendingDrill({
      bookings: [b("B1", "HAROON ZEB KHAN", "MA-AP-500", 35_325_000)],
      payments: [{ booking_id: "B1", safe_cash_amount: 7_798_750 }],
      adjustments: [{ booking_id: "B1", approved_value: 0 }],
    });
    render(<DrillTable drill={drill} />);

    // Column headers
    [
      "Client",
      "Unit",
      "Sell (PKR)",
      "Cash/Bank (PKR)",
      "Adj. Allowed (PKR)",
      "Received (PKR)",
      "Pending (PKR)",
    ].forEach((label) =>
      expect(screen.getByRole("columnheader", { name: label })).toBeInTheDocument(),
    );

    // Right-aligned numeric columns
    expect(screen.getByRole("columnheader", { name: "Pending (PKR)" })).toHaveAttribute(
      "data-align",
      "right",
    );

    const row = screen.getByRole("row", { name: /HAROON ZEB KHAN/ });
    const cells = within(row)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells[0]).toBe("HAROON ZEB KHAN");
    expect(cells[1]).toBe("MA-AP-500");
    expect(cells[2]).toMatch(/35,325,000/); // Sell
    expect(cells[3]).toMatch(/7,798,750/); // Cash/Bank
    expect(cells[4]).toMatch(/^(PKR\s*0|0)$/); // Adj. Allowed
    expect(cells[5]).toMatch(/7,798,750/); // Received
    expect(cells[6]).toMatch(/27,526,250/); // Pending = 35,325,000 - 7,798,750
  });

  it("omits bookings fully covered by cash (no row, no contribution to total)", () => {
    const drill = buildPendingDrill({
      bookings: [
        b("PAID", "Paid Client", "U-1", 5_000_000),
        b("OPEN", "Open Client", "U-2", 3_000_000),
      ],
      payments: [{ booking_id: "PAID", safe_cash_amount: 5_000_000 }],
      adjustments: [],
    });
    render(<DrillTable drill={drill} />);

    expect(screen.queryByText("Paid Client")).not.toBeInTheDocument();
    expect(screen.getByText("Open Client")).toBeInTheDocument();
    expect(screen.getByTestId("grand-total").textContent).toBe("3000000");
  });

  it("omits bookings fully covered by approved adjustments", () => {
    const drill = buildPendingDrill({
      bookings: [b("B1", "Adj Client", "U-3", 2_000_000)],
      payments: [],
      adjustments: [
        { booking_id: "B1", approved_value: 1_200_000 },
        { booking_id: "B1", approved_value: 800_000 },
      ],
    });
    render(<DrillTable drill={drill} />);
    expect(screen.queryByText("Adj Client")).not.toBeInTheDocument();
    expect(screen.getByText("No rows")).toBeInTheDocument();
    expect(screen.getByTestId("grand-total").textContent).toBe("0");
  });

  it("omits bookings fully covered by cash + adjustments combined", () => {
    const drill = buildPendingDrill({
      bookings: [b("MIX", "Mixed Client", "U-4", 10_000_000)],
      payments: [{ booking_id: "MIX", safe_cash_amount: 4_000_000 }],
      adjustments: [{ booking_id: "MIX", approved_value: 6_000_000 }],
    });
    render(<DrillTable drill={drill} />);
    expect(screen.queryByText("Mixed Client")).not.toBeInTheDocument();
    expect(screen.getByTestId("grand-total").textContent).toBe("0");
  });

  it("zeroes the whole drill when every booking is fully covered", () => {
    const bookings = Array.from({ length: 6 }, (_, i) =>
      b(`B${i}`, `C${i}`, `U${i}`, (i + 1) * 1_000_000),
    );
    const payments = bookings.map((bk) => ({
      booking_id: bk.booking_id,
      safe_cash_amount: bk.sold_unit_value as number,
    }));
    const drill = buildPendingDrill({ bookings, payments, adjustments: [] });
    render(<DrillTable drill={drill} />);
    expect(screen.getByText("No rows")).toBeInTheDocument();
    expect(screen.getByTestId("grand-total").textContent).toBe("0");
  });

  it("clamps overpayment to 0 (no negative pending in UI, row omitted)", () => {
    const drill = buildPendingDrill({
      bookings: [b("OVER", "Over Client", "U-5", 1_000_000)],
      payments: [{ booking_id: "OVER", safe_cash_amount: 1_500_000 }],
      adjustments: [{ booking_id: "OVER", approved_value: 200_000 }],
    });
    render(<DrillTable drill={drill} />);
    expect(screen.queryByText("Over Client")).not.toBeInTheDocument();
    expect(screen.getByTestId("grand-total").textContent).toBe("0");
  });

  it("sorts rows by Pending descending and grand total matches the sum of visible rows", () => {
    const drill = buildPendingDrill({
      bookings: [
        b("SMALL", "Small", "U-A", 1_000_000),
        b("BIG", "Big", "U-B", 10_000_000),
        b("MID", "Mid", "U-C", 5_000_000),
      ],
      payments: [],
      adjustments: [],
    });
    render(<DrillTable drill={drill} />);
    const orderedNames = screen
      .getAllByRole("row")
      .slice(1, 4) // skip header row
      .map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(orderedNames).toEqual(["Big", "Mid", "Small"]);
    expect(screen.getByTestId("grand-total").textContent).toBe("16000000");
  });
});
