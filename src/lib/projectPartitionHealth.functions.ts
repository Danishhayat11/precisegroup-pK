import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callRpc } from "@/integrations/supabase/approvedRpc";

/**
 * Phase-0 (read-only) health report for the project-partition migration.
 *
 * Returns six groups of rows that would break under the "each project is
 * its own island" schema. No writes. Admin-only.
 */

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await callRpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Admin access required");
}

export type HealthCell = string | number | boolean | null;
export type HealthRow = Record<string, HealthCell>;

export type PartitionHealthGroup = {
  key: string;
  title: string;
  description: string;
  columns: { key: string; label: string }[];
  rows: HealthRow[];
};

export type PartitionHealthReport = {
  generated_at: string;
  groups: PartitionHealthGroup[];
};

export const getProjectPartitionHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PartitionHealthReport> => {
    await assertAdmin(context.supabase, context.userId);
    // SECURITY: Use the RLS-scoped client (never supabaseAdmin) so a tenant
    // admin only sees rows belonging to their own company_id. All tables
    // below enforce company_id = current_company_id() at the RLS layer.
    const supabaseAdmin = context.supabase;

    // 1. Clients used by more than one project (via bookings.project_code)
    const { data: bookingProjects, error: bpErr } = await supabaseAdmin
      .from("bookings")
      .select("client_ref, project_code, project_name");
    if (bpErr) throw new Error(bpErr.message);

    const perClient = new Map<string, { projects: Set<string>; project_names: Set<string> }>();
    for (const b of bookingProjects ?? []) {
      const cref = (b as any).client_ref as string | null;
      const pc = (b as any).project_code as string | null;
      const pn = (b as any).project_name as string | null;
      if (!cref || !pc) continue;
      const entry = perClient.get(cref) ?? {
        projects: new Set<string>(),
        project_names: new Set<string>(),
      };
      entry.projects.add(pc);
      if (pn) entry.project_names.add(pn);
      perClient.set(cref, entry);
    }
    const multiProjectRefs = [...perClient.entries()]
      .filter(([, v]) => v.projects.size > 1)
      .map(([client_ref, v]) => ({
        client_ref,
        project_codes: [...v.projects].sort().join(", "),
        project_names: [...v.project_names].sort().join(", "),
      }));

    // Enrich with client name / cnic
    let multiProjectRows: HealthRow[] = [];
    if (multiProjectRefs.length > 0) {
      const { data: c } = await supabaseAdmin
        .from("clients")
        .select("client_ref, name, cnic")
        .in(
          "client_ref",
          multiProjectRefs.map((r) => r.client_ref),
        );
      const byRef = new Map((c ?? []).map((row: any) => [row.client_ref, row]));
      multiProjectRows = multiProjectRefs.map((r) => ({
        client_ref: r.client_ref,
        name: (byRef.get(r.client_ref) as any)?.name ?? null,
        cnic: (byRef.get(r.client_ref) as any)?.cnic ?? null,
        project_codes: r.project_codes,
        project_names: r.project_names,
      }));
    }

    // 2. Clients with no bookings
    const { data: allClients } = await supabaseAdmin
      .from("clients")
      .select("client_ref, name, cnic, mobile");
    const usedRefs = new Set(
      (bookingProjects ?? []).map((b: any) => b.client_ref).filter(Boolean) as string[],
    );
    const orphanClients = (allClients ?? [])
      .filter((c: any) => !usedRefs.has(c.client_ref))
      .map((c: any) => ({
        client_ref: c.client_ref,
        name: c.name,
        cnic: c.cnic,
        mobile: c.mobile,
      }));

    // 3. Payments whose project text ≠ their booking's project_name
    const { data: pays } = await supabaseAdmin
      .from("payments")
      .select("receipt_no, booking_id, project, amount, payment_date");
    const bookingByIdArr = await supabaseAdmin
      .from("bookings")
      .select("booking_id, project_code, project_name, unit_id, client_ref");
    const bookingById = new Map((bookingByIdArr.data ?? []).map((b: any) => [b.booking_id, b]));
    const paymentMismatches = (pays ?? [])
      .map((p: any) => {
        const b: any = p.booking_id ? bookingById.get(p.booking_id) : null;
        const bookedProject = b?.project_name ?? null;
        const mismatched =
          !!p.booking_id && !!b && (p.project ?? "").trim() !== (bookedProject ?? "").trim();
        return { p, b, bookedProject, mismatched };
      })
      .filter(
        (x: any): x is { p: any; b: any; bookedProject: string | null; mismatched: boolean } =>
          x.mismatched,
      )
      .map(({ p, b, bookedProject }: { p: any; b: any; bookedProject: string | null }) => ({
        receipt_no: p.receipt_no,
        booking_id: p.booking_id,
        payment_project: p.project,
        booking_project: bookedProject,
        booking_project_code: b?.project_code ?? null,
        amount: p.amount,
        payment_date: p.payment_date,
      }));

    // 4. Ledger rows whose project ≠ booking project_name
    const { data: leds } = await supabaseAdmin
      .from("installment_ledger")
      .select("ledger_id, booking_id, project, due_date, due_amount");
    const ledgerMismatches = (leds ?? [])
      .map((l: any) => {
        const b: any = l.booking_id ? bookingById.get(l.booking_id) : null;
        const bookedProject = b?.project_name ?? null;
        const mismatched =
          !!l.booking_id && !!b && (l.project ?? "").trim() !== (bookedProject ?? "").trim();
        return { l, b, bookedProject, mismatched };
      })
      .filter(
        (x: any): x is { l: any; b: any; bookedProject: string | null; mismatched: boolean } =>
          x.mismatched,
      )
      .map(({ l, b, bookedProject }: { l: any; b: any; bookedProject: string | null }) => ({
        ledger_id: l.ledger_id,
        booking_id: l.booking_id,
        ledger_project: l.project,
        booking_project: bookedProject,
        booking_project_code: b?.project_code ?? null,
        due_date: l.due_date,
        due_amount: l.due_amount,
      }));

    // 5. Units whose project_code ≠ linked booking's project_code
    const { data: units } = await supabaseAdmin
      .from("units")
      .select("unit_id, project_code, unit_no, linked_booking_id, status");
    const unitMismatches = (units ?? [])
      .map((u: any) => {
        const b: any = u.linked_booking_id ? bookingById.get(u.linked_booking_id) : null;
        const mismatched =
          !!u.linked_booking_id && !!b && (u.project_code ?? "") !== (b.project_code ?? "");
        return { u, b, mismatched };
      })
      .filter((x: any): x is { u: any; b: any; mismatched: boolean } => x.mismatched)
      .map(({ u, b }: { u: any; b: any }) => ({
        unit_id: u.unit_id,
        unit_no: u.unit_no,
        unit_project_code: u.project_code,
        linked_booking_id: u.linked_booking_id,
        booking_project_code: b?.project_code ?? null,
        status: u.status,
      }));

    // 6. Bookings missing project_code
    const bookingsMissingProject = (bookingProjects ?? [])
      .filter((b: any) => !b.project_code)
      .map((b: any) => ({
        client_ref: b.client_ref,
        project_name: b.project_name,
      }));
    // Include booking_id for the missing-project list; re-query minimal fields
    const { data: missingIds } = await supabaseAdmin
      .from("bookings")
      .select("booking_id, client_ref, client_name, project_name, project_code")
      .is("project_code", null);
    const missingProjectRows = (missingIds ?? []).map((b: any) => ({
      booking_id: b.booking_id,
      client_ref: b.client_ref,
      client_name: b.client_name,
      project_name: b.project_name,
    }));

    return {
      generated_at: new Date().toISOString(),
      groups: [
        {
          key: "clients_multi_project",
          title: "Clients used by more than one project",
          description:
            "Under hard partitioning, each of these client rows must be split into one row per project. The same real person will exist as N separate records (one per project).",
          columns: [
            { key: "client_ref", label: "Client Ref" },
            { key: "name", label: "Name" },
            { key: "cnic", label: "CNIC" },
            { key: "project_codes", label: "Project codes" },
            { key: "project_names", label: "Project names" },
          ],
          rows: multiProjectRows,
        },
        {
          key: "clients_no_bookings",
          title: "Clients with no bookings",
          description:
            "Orphan clients — no booking means we cannot infer a project. Decide per row: assign to a project, or delete.",
          columns: [
            { key: "client_ref", label: "Client Ref" },
            { key: "name", label: "Name" },
            { key: "cnic", label: "CNIC" },
            { key: "mobile", label: "Mobile" },
          ],
          rows: orphanClients,
          // The compiler ignores extra fields on optional shape — that's fine.
        } as PartitionHealthGroup,
        {
          key: "payments_project_mismatch",
          title: "Payments whose project differs from the booking's project",
          description:
            "Payment.project label does not match the booking's project_name. These will fail the cross-table equality trigger in Phase 1.",
          columns: [
            { key: "receipt_no", label: "Receipt #" },
            { key: "booking_id", label: "Booking" },
            { key: "payment_project", label: "Payment.project" },
            { key: "booking_project", label: "Booking.project_name" },
            { key: "booking_project_code", label: "Booking.project_code" },
            { key: "amount", label: "Amount" },
            { key: "payment_date", label: "Date" },
          ],
          rows: paymentMismatches,
        },
        {
          key: "ledger_project_mismatch",
          title: "Ledger rows whose project differs from the booking's project",
          description:
            "installment_ledger.project label does not match the booking's project_name.",
          columns: [
            { key: "ledger_id", label: "Ledger" },
            { key: "booking_id", label: "Booking" },
            { key: "ledger_project", label: "Ledger.project" },
            { key: "booking_project", label: "Booking.project_name" },
            { key: "booking_project_code", label: "Booking.project_code" },
            { key: "due_date", label: "Due date" },
            { key: "due_amount", label: "Due amount" },
          ],
          rows: ledgerMismatches,
        },
        {
          key: "units_project_mismatch",
          title: "Units whose project_code differs from the linked booking's project_code",
          description:
            "A unit is linked to a booking in another project. Must be corrected before partitioning.",
          columns: [
            { key: "unit_id", label: "Unit ID" },
            { key: "unit_no", label: "Unit #" },
            { key: "unit_project_code", label: "Unit.project_code" },
            { key: "linked_booking_id", label: "Linked booking" },
            { key: "booking_project_code", label: "Booking.project_code" },
            { key: "status", label: "Status" },
          ],
          rows: unitMismatches,
        },
        {
          key: "bookings_missing_project",
          title: "Bookings missing project_code",
          description:
            "Bookings with no project_code cannot be partitioned. Assign one before Phase 1.",
          columns: [
            { key: "booking_id", label: "Booking" },
            { key: "client_ref", label: "Client Ref" },
            { key: "client_name", label: "Client name" },
            { key: "project_name", label: "Legacy project_name" },
          ],
          rows: missingProjectRows,
        },
      ],
    };
  });
