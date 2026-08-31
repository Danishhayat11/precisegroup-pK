import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/ReconciliationDiff";
export const Route = createFileRoute("/_authenticated/reconciliation-diff")({ component: Page });
