import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Receipt,
  FileCheck2,
  CalendarClock,
  Key,
  Gavel,
  FileSignature,
  ArrowRightLeft,
  FileText,
  Search,
  ChevronLeft,
  X,
  MessageCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

type Tile = {
  label: string;
  slug: string;
  Icon: any;
  tone: string;
};

const TILES: Tile[] = [
  { label: "Receipt", slug: "receipt", Icon: Receipt, tone: "bg-blue-500/10 text-blue-700" },
  {
    label: "Allotment Letter",
    slug: "allotment",
    Icon: FileCheck2,
    tone: "bg-emerald-500/10 text-emerald-700",
  },
  {
    label: "Payment Plan",
    slug: "payment-plan",
    Icon: CalendarClock,
    tone: "bg-amber-500/10 text-amber-700",
  },
  {
    label: "Possession Letter",
    slug: "possession",
    Icon: Key,
    tone: "bg-purple-500/10 text-purple-700",
  },
  {
    label: "Legal Notice",
    slug: "legal-notice",
    Icon: Gavel,
    tone: "bg-destructive/10 text-destructive",
  },
  {
    label: "Sale Agreement",
    slug: "sale-agreement",
    Icon: FileSignature,
    tone: "bg-indigo-500/10 text-indigo-700",
  },
  {
    label: "Transfer Form",
    slug: "transfer-form",
    Icon: ArrowRightLeft,
    tone: "bg-cyan-500/10 text-cyan-700",
  },
  {
    label: "Affidavit",
    slug: "deposit-summary",
    Icon: FileText,
    tone: "bg-stone-500/10 text-stone-700",
  },
];

export function MobileDocuments() {
  const [tile, setTile] = useState<Tile | null>(null);
  const [search, setSearch] = useState("");

  const { data: bookings = [], accessDenied } = usePIIGuardedQuery<any[]>({
    queryKey: ["doc-bookings-all"],
    queryFn: async () =>
      (await supabase.from("bookings").select("*").order("client_name")).data ?? [],
    enabled: !!tile,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bookings.slice(0, 30);
    return bookings
      .filter((b: any) =>
        [b.booking_id, b.client_name, b.unit_id, b.cnic].some((v) =>
          (v || "").toString().toLowerCase().includes(q),
        ),
      )
      .slice(0, 30);
  }, [bookings, search]);

  if (accessDenied) {
    return (
      <div>
        <PageHeader title="Documents" description="Restricted view" />
        <AccessDenied
          title="Document generation restricted"
          description="Client bookings feed these documents — visible only to admin, manager, and staff roles."
        />
      </div>
    );
  }

  if (!tile) {
    return (
      <div className="pb-8">
        <header className="px-4 py-4 border-b">
          <h1 className="text-lg font-black">Documents</h1>
          <p className="text-xs text-muted-foreground">Choose a document to generate</p>
        </header>
        <div className="p-4 grid grid-cols-2 gap-3">
          {TILES.map((t) => (
            <button
              key={t.slug}
              onClick={() => {
                setTile(t);
                setSearch("");
              }}
              className="aspect-square rounded-2xl border-2 bg-card p-4 flex flex-col items-center justify-center gap-3 active:scale-95 transition min-h-11"
            >
              <div className={cn("grid place-items-center h-14 w-14 rounded-2xl", t.tone)}>
                <t.Icon className="h-7 w-7" />
              </div>
              <div className="text-sm font-bold text-center leading-tight">{t.label}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b px-2 py-2 flex items-center gap-1">
        <button
          onClick={() => setTile(null)}
          aria-label="Back to documents"
          className="min-h-11 min-w-11 grid place-items-center"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">Step 1 of 3</div>
          <div className="font-bold truncate">{tile.label}</div>
        </div>
      </header>
      <div className="p-4 space-y-3">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, unit or booking id"
            inputMode="search"
            className="pl-9 h-11"
            autoFocus
          />
        </div>
        <div className="rounded-xl border divide-y overflow-hidden bg-card">
          {filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">No bookings match.</div>
          )}
          {filtered.map((b: any) => (
            <Link
              key={b.booking_id}
              to="/documents/$type"
              params={{ type: tile.slug }}
              search={{ booking: b.booking_id } as any}
              className="block p-4 hover:bg-muted active:bg-muted min-h-14"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold truncate capitalize">{b.client_name}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {b.unit_id} · {b.booking_id}
                  </div>
                </div>
                {b.whatsapp || b.mobile ? (
                  <MessageCircle className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden />
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
