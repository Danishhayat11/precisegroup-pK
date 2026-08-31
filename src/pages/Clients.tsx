import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { maskCNIC } from "@/lib/format";
import { useActiveProject } from "@/lib/activeProject";
import { AccessDenied, useCanReadClientPII } from "@/lib/access";

export default function Clients() {
  const { activeCode, activeProject } = useActiveProject();
  const canReadPII = useCanReadClientPII();

  // Clients have no direct project_code column — they're linked via bookings.
  // When a project is active, first fetch the client_refs booked into it,
  // then only show those clients. Skipped entirely for viewer sessions.
  const { data: allowedRefs } = useQuery({
    queryKey: ["clients-allowed-refs", activeCode ?? "all"],
    enabled: canReadPII,
    queryFn: async () => {
      if (!activeCode) return null; // null = show every client
      const { data } = await supabase
        .from("bookings")
        .select("client_ref")
        .eq("project_code", activeCode);
      const set = new Set<string>();
      (data ?? []).forEach((b: any) => {
        if (b.client_ref) set.add(b.client_ref);
      });
      return set;
    },
  });

  const { data: rows = [], isPending } = useQuery({
    queryKey: [
      "clients",
      activeCode ?? "all",
      allowedRefs ? Array.from(allowedRefs).sort().join(",") : "all",
    ],
    enabled: canReadPII && allowedRefs !== undefined,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").order("name");
      const list = data ?? [];
      if (!allowedRefs) return list;
      return list.filter((c: any) => allowedRefs.has(c.client_ref));
    },
  });

  const { data: bookingsList = [] } = useQuery({
    queryKey: ["clients-bookings-summary"],
    enabled: canReadPII,
    queryFn: async () => {
      const { data } = await supabase
        .from("bookings")
        .select("client_ref, booking_id, booking_status, total_contract_value");
      return data ?? [];
    },
  });

  const bookingStatsByClient = useMemo(() => {
    const map = new Map<string, { total: number; active: number; totalValue: number }>();
    for (const b of bookingsList) {
      if (!b.client_ref) continue;
      const cur = map.get(b.client_ref) || { total: 0, active: 0, totalValue: 0 };
      cur.total += 1;
      if (String(b.booking_status ?? "").toLowerCase() !== "cancelled") {
        cur.active += 1;
        cur.totalValue += Number(b.total_contract_value) || 0;
      }
      map.set(b.client_ref, cur);
    }
    return map;
  }, [bookingsList]);

  const columns: Column<any>[] = [
    {
      key: "ref",
      header: "Client Ref",
      cell: (r) => (
        <span className="font-mono text-xs text-primary font-semibold">{r.client_ref}</span>
      ),
    },
    {
      key: "name",
      header: "Name",
      cell: (r) => <span className="capitalize font-medium text-foreground">{r.name}</span>,
    },
    {
      key: "so",
      header: "S/O · W/O",
      cell: (r) => <span className="text-muted-foreground">{r.so_wo || "—"}</span>,
    },
    {
      key: "cnic",
      header: "CNIC",
      cell: (r) => <span className="font-mono text-xs">{maskCNIC(r.cnic)}</span>,
    },
    {
      key: "mob",
      header: "Mobile",
      cell: (r) => <span className="font-mono text-xs">{r.mobile || "—"}</span>,
    },
    {
      key: "bookings",
      header: "Bookings",
      align: "center",
      cell: (r) => {
        const stat = bookingStatsByClient.get(r.client_ref);
        if (!stat || stat.total === 0)
          return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
            {stat.total} {stat.total === 1 ? "unit" : "units"}
          </span>
        );
      },
    },
    {
      key: "addr",
      header: "Address",
      cell: (r) => (
        <span className="text-xs text-muted-foreground truncate max-w-[200px] inline-block">
          {r.address || "—"}
        </span>
      ),
    },
  ];
  const scope = activeProject
    ? `${activeProject.project_code} · ${activeProject.project_name}`
    : "All projects";

  if (!canReadPII) {
    return (
      <div>
        <PageHeader title="Clients" description={scope} />
        <AccessDenied
          title="Client records are restricted"
          description="Client names, CNIC, mobile, and address are only visible to admin, manager, and staff roles. Ask an administrator if you need access."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Clients" description={`${scope} · ${rows.length} clients`} />
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.client_ref}
        searchKeys={["client_ref", "name", "cnic", "mobile", "address"]}
        loading={isPending}
        emptyTitle="No clients yet"
        emptyDescription="Clients are created automatically the first time you add a booking with a new buyer."
      />
    </div>
  );
}
