import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/PrintLedgerIndex";

export const Route = createFileRoute("/_authenticated/print-ledger/")({
  head: () => ({
    meta: [
      { title: "Client Payment Ledgers · Precise ERP" },
      {
        name: "description",
        content:
          "Print-ready per-client payment ledgers with Date, Description, Debit, Credit, and running Balance.",
      },
    ],
  }),
  component: Page,
});
