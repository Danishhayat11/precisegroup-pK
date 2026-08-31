import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { usePIIGuardedQuery } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import AutoLogoEditor from "@/components/AutoLogoEditor";
import {
  Image as ImageIcon,
  Save,
  Upload,
  ShieldAlert,
  Building2,
  Sun,
  Moon,
  Monitor,
  Check,
} from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";
import { toast } from "sonner";
import { z } from "zod";
import { adminDeactivateCompany } from "@/lib/adminCompany.functions";
import { logSettingsChange } from "@/lib/settingsChangeLog";
import { History } from "lucide-react";

type CompanyRow = {
  id: string;
  name: string;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  financial_year_start: number;
  default_project_code: string | null;
  plan: string;
  is_active: boolean;
  created_at: string;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const companySchema = z.object({
  name: z.string().trim().min(2, "Company name is required").max(200),
  address: z.string().trim().max(500).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .max(255)
    .nullable()
    .or(z.literal(""))
    .optional(),
  currency: z.string().trim().min(1).max(6),
  financial_year_start: z.number().int().min(1).max(12),
  default_project_code: z.string().nullable().optional(),
});

export default function Settings() {
  const { user, roles, isAdmin, isOwner } = useAuth();
  const qc = useQueryClient();

  const { data: dealers = [] } = usePIIGuardedQuery<any[]>({
    queryKey: ["s-dealers"],
    queryFn: async () => (await supabase.from("dealers").select("*")).data ?? [],
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["s-projects"],
    queryFn: async () => (await supabase.from("projects").select("*")).data ?? [],
  });
  const { data: company, isLoading: loadingCompany } = useQuery({
    queryKey: ["my-company"],
    queryFn: async (): Promise<CompanyRow | null> => {
      const { data, error } = await supabase.from("companies").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data as CompanyRow | null;
    },
  });

  const [form, setForm] = useState<Partial<CompanyRow>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signedLogoUrl, setSignedLogoUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [autoLogoOpen, setAutoLogoOpen] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState("");
  const deactivateFn = useServerFn(adminDeactivateCompany);

  useEffect(() => {
    if (company) setForm(company);
  }, [company]);

  // Resolve a preview URL for the private logo bucket via a short-lived signed URL.
  useEffect(() => {
    let cancelled = false;
    const path = form.logo_url;
    if (!path) {
      setSignedLogoUrl(null);
      return;
    }
    // If it's already a full URL (legacy), just use it as-is.
    if (/^https?:\/\//i.test(path)) {
      setSignedLogoUrl(path);
      return;
    }
    supabase.storage
      .from("company-logos")
      .createSignedUrl(path, 60 * 60)
      .then(({ data }) => {
        if (!cancelled) setSignedLogoUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [form.logo_url]);

  const saveM = useMutation({
    mutationFn: async () => {
      const parsed = companySchema.safeParse({
        ...form,
        financial_year_start: Number(form.financial_year_start ?? 7),
      });
      if (!parsed.success) {
        const map: Record<string, string> = {};
        for (const iss of parsed.error.issues) map[iss.path[0] as string] = iss.message;
        setErrors(map);
        throw new Error("Please fix the highlighted fields.");
      }
      setErrors({});
      const patch = parsed.data;
      const prevEmail = company?.email ?? null;
      const nextEmail = patch.email || null;
      const { error } = await supabase
        .from("companies")
        .update({
          name: patch.name,
          address: patch.address || null,
          city: patch.city || null,
          phone: patch.phone || null,
          email: nextEmail,
          currency: patch.currency,
          financial_year_start: patch.financial_year_start,
          default_project_code: patch.default_project_code || null,
        })
        .eq("id", company!.id);
      if (error) throw new Error(error.message);
      if (company && (prevEmail ?? "") !== (nextEmail ?? "")) {
        await logSettingsChange({
          company_id: company.id,
          entity_type: "company",
          entity_label: patch.name,
          field: "email",
          old_value: prevEmail,
          new_value: nextEmail,
        });
      }
    },
    onSuccess: () => {
      toast.success("Company settings saved");
      qc.invalidateQueries({ queryKey: ["my-company"] });
      qc.invalidateQueries({ queryKey: ["settings-change-log"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const handleLogoPick = async (file: File) => {
    if (!company) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/i.test(file.type)) {
      toast.error("Logo must be PNG, JPG, WebP, or SVG.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2 MB.");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${company.id}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("company-logos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("companies")
        .update({ logo_url: path })
        .eq("id", company.id);
      if (dbErr) throw dbErr;
      setForm((f) => ({ ...f, logo_url: path }));
      toast.success("Logo uploaded");
      qc.invalidateQueries({ queryKey: ["my-company"] });
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const deactivateM = useMutation({
    mutationFn: () => deactivateFn({ data: { reason: deactivateReason } }),
    onSuccess: () => {
      toast.success("Company deactivated");
      setDeactivateReason("");
      qc.invalidateQueries({ queryKey: ["my-company"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to deactivate"),
  });

  const heads = ["Down Payment", "Installment 01-24", "Possession", "Adjustment Credit", "Other"];
  const modes = ["Cash", "Bank Transfer", "Cheque", "Online", "Adjustment", "Other"];
  const accounts = [
    "Cash in Hand",
    "Bank - HBL",
    "Bank - Meezan",
    "Bank - UBL",
    "Adjustment Account",
  ];

  const set = <K extends keyof CompanyRow>(k: K, v: CompanyRow[K] | null | undefined) =>
    setForm((f) => ({ ...f, [k]: v as any }));

  const fieldErr = (k: string) => errors[k];

  const roleLabel = useMemo(() => {
    if (isOwner) return "Owner";
    if (roles.includes("admin")) return "Admin";
    return roles[0] ?? "viewer";
  }, [roles, isOwner]);

  return (
    <div>
      <PageHeader title="Settings" description="Company profile, defaults, and reference lists" />

      {/* Company profile */}
      <div className="card-elevated p-5 mb-4">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" /> Company profile
            </div>
            <div className="text-xs text-muted-foreground">
              Displayed on receipts, letterheads, and the workspace header.
            </div>
          </div>
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => saveM.mutate()}
              disabled={saveM.isPending || loadingCompany}
            >
              <Save className="h-4 w-4 mr-1.5" /> {saveM.isPending ? "Saving…" : "Save changes"}
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4">
          <div>
            <Label className="mb-1.5 block">Logo</Label>
            <div className="aspect-square rounded-lg border border-dashed bg-muted/30 grid place-items-center overflow-hidden">
              {signedLogoUrl ? (
                <img
                  src={signedLogoUrl}
                  alt="Company logo"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            {isAdmin && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || !company}
                >
                  <Upload className="h-4 w-4 mr-1.5" /> {uploading ? "Uploading…" : "Change logo"}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  aria-label="Upload company logo"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleLogoPick(f);
                    e.target.value = "";
                  }}
                />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Company name" required error={fieldErr("name")}>
              <Input
                value={form.name ?? ""}
                onChange={(e) => set("name", e.target.value)}
                disabled={!isAdmin}
                aria-invalid={!!fieldErr("name")}
              />
            </Field>
            <Field label="Email" error={fieldErr("email")}>
              <Input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
                disabled={!isAdmin}
                aria-invalid={!!fieldErr("email")}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={form.phone ?? ""}
                onChange={(e) => set("phone", e.target.value)}
                disabled={!isAdmin}
              />
            </Field>
            <Field label="City">
              <Input
                value={form.city ?? ""}
                onChange={(e) => set("city", e.target.value)}
                disabled={!isAdmin}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address">
                <Textarea
                  rows={2}
                  value={form.address ?? ""}
                  onChange={(e) => set("address", e.target.value)}
                  disabled={!isAdmin}
                />
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Defaults + Plan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="card-elevated p-5">
          <div className="text-sm font-semibold mb-3">Defaults</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Currency">
              <Input
                value={form.currency ?? "PKR"}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
                disabled={!isAdmin}
              />
            </Field>
            <Field label="Financial year start">
              <Select
                value={String(form.financial_year_start ?? 7)}
                onValueChange={(v) => set("financial_year_start", Number(v))}
                disabled={!isAdmin}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Default project (single-project companies)">
                <Select
                  value={form.default_project_code ?? "__none"}
                  onValueChange={(v) => set("default_project_code", v === "__none" ? null : v)}
                  disabled={!isAdmin}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None (multi-project)</SelectItem>
                    {projects.map((p: any) => (
                      <SelectItem key={p.project_code} value={p.project_code}>
                        {p.project_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
        </div>

        <div className="card-elevated p-5">
          <div className="text-sm font-semibold mb-3">Plan &amp; account</div>
          <Row k="Your email" v={user?.email ?? "—"} />
          <Row k="Your role" v={<span className="capitalize font-medium">{roleLabel}</span>} />
          <Row
            k="Plan"
            v={
              <Badge variant="secondary" className="capitalize">
                {company?.plan ?? "—"}
              </Badge>
            }
          />
          <Row
            k="Status"
            v={
              company?.is_active ? (
                <Badge className="bg-success/10 text-success border-success/30 border">
                  Active
                </Badge>
              ) : (
                <Badge variant="destructive">Inactive</Badge>
              )
            }
          />
          <Row k="Created" v={company ? new Date(company.created_at).toLocaleDateString() : "—"} />
          <div className="pt-2 space-y-1">
            <a href="/users" className="block text-xs text-primary hover:underline">
              Manage users &amp; roles →
            </a>
            {isAdmin && (
              <a href="/admin" className="block text-xs text-primary hover:underline">
                Open Admin Controls hub →
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Danger zone — owner only */}
      {isOwner && company?.is_active && (
        <div className="card-elevated p-5 mb-4 border-destructive/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-destructive flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" /> Danger zone
              </div>
              <div className="text-xs text-muted-foreground max-w-md mt-1">
                Deactivating the company locks all users out of this workspace. Contact support to
                reactivate.
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Deactivate company
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Deactivate {company.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All members will lose access on their next request. Enter a short reason for the
                    audit log.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Textarea
                  placeholder="e.g. Closing the workspace, migrating to a new tenant, etc."
                  value={deactivateReason}
                  onChange={(e) => setDeactivateReason(e.target.value)}
                  rows={3}
                />
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setDeactivateReason("")}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={deactivateReason.trim().length < 3 || deactivateM.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      deactivateM.mutate();
                    }}
                  >
                    {deactivateM.isPending ? "Deactivating…" : "Deactivate"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

      {/* Appearance — per-browser theme preference */}
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-6">
        Appearance
      </div>
      <AppearanceCard />

      {/* Change history — append-only audit of display name & email edits */}
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-6">
        Change history
      </div>
      <ChangeHistoryCard companyId={company?.id ?? null} />

      {/* Reference lists (unchanged behavior) */}
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-6">
        Reference lists
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Document branding">
          <div className="py-1.5 text-sm flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">Auto-logo mapping</div>
              <div className="text-xs text-muted-foreground">
                Pick which logo Auto mode uses for each document type and letterhead style.
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setAutoLogoOpen(true)}>
              <ImageIcon className="h-4 w-4 mr-1.5" /> Edit mapping
            </Button>
          </div>
        </Card>
        <ProjectsCard projects={projects} />
        <Card title="Dealers">
          {dealers.map((d: any) => (
            <Row key={d.name} k={d.name} v={null} />
          ))}
        </Card>
        <Card title="Payment heads">
          {heads.map((h) => (
            <Row key={h} k={h} v={null} />
          ))}
        </Card>
        <Card title="Payment modes">
          {modes.map((m) => (
            <Row key={m} k={m} v={null} />
          ))}
        </Card>
        <Card title="Accounts">
          {accounts.map((a) => (
            <Row key={a} k={a} v={null} />
          ))}
        </Card>
      </div>

      <AutoLogoEditor open={autoLogoOpen} onOpenChange={setAutoLogoOpen} />
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: any;
}) {
  return (
    <div>
      <Label className="mb-1.5 block">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error && (
        <p role="alert" className="text-[11px] text-destructive mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
function Card({ title, children }: { title: string; children: any }) {
  return (
    <div className="card-elevated p-5">
      <div className="text-sm font-semibold mb-3">{title}</div>
      <div className="divide-y">{children}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span>{k}</span>
      {v !== null && <span className="text-muted-foreground">{v}</span>}
    </div>
  );
}

/**
 * Editable per-project display names. The `display_name` on `projects` is
 * the single source of truth used by every document renderer (letterhead,
 * footer, notice bodies, payment plan, receipts, ledgers) — a save here
 * updates every generated document for that project the next time it's
 * opened, without touching stored booking rows. Blank falls back to
 * `project_name`. Theme detection stays project-code based so brand palette
 * doesn't drift when the label changes.
 */
function ProjectsCard({ projects }: { projects: any[] }) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const initialFor = (p: any) => (p.display_name ?? "") as string;
  const current = (p: any) => drafts[p.project_code] ?? initialFor(p);
  const isDirty = (p: any) => current(p).trim() !== initialFor(p).trim();

  const save = async (p: any) => {
    const next = current(p).trim();
    const prev = (p.display_name ?? "").trim();
    setSavingCode(p.project_code);
    try {
      const { error } = await supabase
        .from("projects")
        .update({ display_name: next.length ? next : null })
        .eq("project_code", p.project_code);
      if (error) throw error;
      toast.success(`Saved display name for ${p.project_code}`);
      setDrafts((d) => {
        const { [p.project_code]: _, ...rest } = d;
        return rest;
      });
      if (p.company_id && prev !== next) {
        await logSettingsChange({
          company_id: p.company_id,
          entity_type: "project",
          entity_label: `${p.project_code} — ${p.project_name || ""}`.trim(),
          field: "display_name",
          old_value: prev || p.project_name || null,
          new_value: next.length ? next : p.project_name || null,
        });
      }
      await qc.invalidateQueries({ queryKey: ["s-projects"] });
      // Refresh any open document view so changes appear immediately.
      await qc.invalidateQueries({ queryKey: ["doc-booking"] });
      await qc.invalidateQueries({ queryKey: ["settings-change-log"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not save display name");
    } finally {
      setSavingCode(null);
    }
  };

  // Reset to default = clear display_name so document renderers fall back to
  // the underlying project_name. Also drops any local unsaved draft.
  const resetToDefault = async (p: any) => {
    const prev = (p.display_name ?? "").trim();
    setSavingCode(p.project_code);
    try {
      const { error } = await supabase
        .from("projects")
        .update({ display_name: null })
        .eq("project_code", p.project_code);
      if (error) throw error;
      toast.success(`Reset ${p.project_code} to "${p.project_name}"`);
      setDrafts((d) => {
        const { [p.project_code]: _, ...rest } = d;
        return rest;
      });
      if (p.company_id && prev.length) {
        await logSettingsChange({
          company_id: p.company_id,
          entity_type: "project",
          entity_label: `${p.project_code} — ${p.project_name || ""}`.trim(),
          field: "display_name",
          old_value: prev,
          new_value: p.project_name || null,
        });
      }
      await qc.invalidateQueries({ queryKey: ["s-projects"] });
      await qc.invalidateQueries({ queryKey: ["doc-booking"] });
      await qc.invalidateQueries({ queryKey: ["settings-change-log"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not reset display name");
    } finally {
      setSavingCode(null);
    }
  };

  // True when a stored override exists OR the draft differs from the default.
  const canReset = (p: any) =>
    Boolean(p.display_name && p.display_name.trim().length) || isDirty(p);

  return (
    <div className="card-elevated p-5">
      <div className="text-sm font-semibold mb-1">Projects</div>
      <div className="text-xs text-muted-foreground mb-3">
        Display name shown on all generated documents (letterhead, footer, notices, payment plan,
        receipts). Leave blank to use the project name.
      </div>
      <div className="divide-y">
        {projects.length === 0 && (
          <div className="py-2 text-sm text-muted-foreground">No projects yet.</div>
        )}
        {projects.map((p: any) => {
          const dirty = isDirty(p);
          const saving = savingCode === p.project_code;
          const resettable = canReset(p);
          return (
            <div key={p.project_code} className="py-2.5 flex items-center gap-2">
              <div className="w-16 shrink-0">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {p.project_code}
                </Badge>
              </div>
              <div className="flex-1 min-w-0">
                <Input
                  value={current(p)}
                  placeholder={p.project_name || "Display name"}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.project_code]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && dirty && !saving) save(p);
                  }}
                  className="h-8"
                  aria-label={`Display name for ${p.project_code}`}
                />
                <div className="text-[10.5px] text-muted-foreground mt-0.5 truncate">
                  Project name: {p.project_name || "—"}
                </div>
              </div>
              <Button
                size="sm"
                variant={dirty ? "default" : "ghost"}
                disabled={!dirty || saving}
                onClick={() => save(p)}
                className="h-8 min-h-11 min-w-11"
              >
                {saving ? "Saving…" : dirty ? "Save" : "Saved"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!resettable || saving}
                onClick={() => resetToDefault(p)}
                className="h-8 min-h-11 min-w-11"
                aria-label={`Reset display name for ${p.project_code} to default`}
                title={`Reset to "${p.project_name}"`}
              >
                Reset
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Per-browser theme picker for the profile settings page. Uses the same
 * `useTheme` store that powers the top-nav ThemeToggle, so any change here
 * applies instantly across the app (via `data-theme` on <html>) and is
 * persisted to localStorage + synced across tabs.
 */
function AppearanceCard() {
  const { theme, resolved, setTheme } = useTheme();
  const options: { value: Theme; label: string; hint: string; Icon: typeof Sun }[] = [
    { value: "light", label: "Light", hint: "Always light", Icon: Sun },
    { value: "dark", label: "Dark", hint: "Always dark", Icon: Moon },
    {
      value: "system",
      label: "System",
      hint: `Match your device · currently ${resolved}`,
      Icon: Monitor,
    },
  ];
  return (
    <div className="card-elevated p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold">Theme</div>
          <div className="text-xs text-muted-foreground">
            Choose how the app looks on this device. Saved to this browser.
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {resolved === "dark" ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
          {resolved}
        </span>
      </div>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {options.map(({ value, label, hint, Icon }) => {
          const selected = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(value)}
              className={[
                "relative flex items-start gap-3 rounded-lg border p-3 text-left transition-colors min-h-11",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/40",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-9 w-9 shrink-0 place-items-center rounded-md border",
                  selected
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/60 bg-muted/40 text-muted-foreground",
                ].join(" ")}
                aria-hidden="true"
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-[11px] text-muted-foreground">{hint}</span>
              </span>
              {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Read-only, append-only change history for tenant-scoped settings.
 * Currently surfaces company email edits and per-project display-name
 * saves/resets. Rendered as a compact 10-row list; older rows are trimmed
 * server-side by ordering + limit.
 */
type ChangeLogRow = {
  id: string;
  entity_type: "company" | "project";
  entity_label: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by_email: string | null;
  created_at: string;
};

function ChangeHistoryCard({ companyId }: { companyId: string | null }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["settings-change-log", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ChangeLogRow[]> => {
      const { data, error } = await supabase
        .from("settings_change_log")
        .select(
          "id, entity_type, entity_label, field, old_value, new_value, changed_by_email, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as ChangeLogRow[];
    },
  });

  const fieldLabel = (f: string) =>
    f === "display_name" ? "Display name" : f === "email" ? "Email" : f;

  return (
    <div className="card-elevated p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" /> Recent edits
      </div>
      <div className="text-xs text-muted-foreground mb-3">
        Last 10 changes to project display names and company email. Read-only.
      </div>
      {isLoading && <div className="py-2 text-sm text-muted-foreground">Loading…</div>}
      {!isLoading && rows.length === 0 && (
        <div className="py-2 text-sm text-muted-foreground">No changes recorded yet.</div>
      )}
      <div className="divide-y">
        {rows.map((r) => (
          <div key={r.id} className="py-2 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] capitalize">
                {r.entity_type}
              </Badge>
              <span className="font-medium truncate">{r.entity_label}</span>
              <span className="text-xs text-muted-foreground">· {fieldLabel(r.field)}</span>
            </div>
            <div className="text-xs mt-0.5">
              <span className="text-muted-foreground line-through">{r.old_value ?? "—"}</span>
              <span className="mx-1.5 text-muted-foreground">→</span>
              <span className="text-foreground">{r.new_value ?? "—"}</span>
            </div>
            <div className="text-[10.5px] text-muted-foreground mt-0.5">
              {new Date(r.created_at).toLocaleString()}
              {r.changed_by_email ? ` · ${r.changed_by_email}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
