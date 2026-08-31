/**
 * Ledger Engine — public surface.
 *
 * Pure calculation layer for PRECISE ERP's booking financials.
 * See ./types.ts for the domain model and ./__tests__/ for spec-by-example.
 *
 * Consumers (server functions, reports, PDF, UI) should import from here.
 */

export type {
  BookingLedgerSummary,
  InstallmentProjection,
  InstallmentRow,
  InstallmentStatus,
  LedgerTxn,
  LedgerTxnType,
} from "./types";

export {
  allocateReceipts,
  sortInstallmentsForAllocation,
  type AllocationInput,
  type AllocationLine,
  type AllocationResult,
} from "./allocation";

export { deriveStatus, daysOverdue } from "./statusEngine";
export { buildBookingSummary, type SummaryInput } from "./summary";
export { projectInstallments, type ProjectionInput } from "./projection";
