#!/usr/bin/env node
/**
 * Back-compat wrapper. Delegates to the generic booking auditor with
 * BK-MA-00014 pinned, so existing CI invocations keep working.
 *
 * For new bookings prefer:
 *   node scripts/audit/booking-reconciliation.mjs <BOOKING_ID>
 */
import { runAudit } from "./booking-reconciliation.mjs";
runAudit({ booking: "BK-MA-00014" });
