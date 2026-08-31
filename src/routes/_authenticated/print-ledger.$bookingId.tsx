import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/PrintLedgerDetail";

export const Route = createFileRoute("/_authenticated/print-ledger/$bookingId")({
  head: () => ({
    meta: [
      { title: "Print Ledger · Precise ERP" },
      { name: "description", content: "Printable A4 payment ledger for a single booking." },
    ],
  }),
  component: Page,
});
