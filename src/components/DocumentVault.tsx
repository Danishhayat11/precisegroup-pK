import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { withCompany } from "@/lib/companyScope";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  FileImage,
  FileSpreadsheet,
  File as FileIcon,
  Download,
  Trash2,
  Search,
  Eye,
  Pencil,
  History,
  Files,
  X,
  AlertTriangle,
  FilePlus2,
} from "lucide-react";
import { TableRowsSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/EmptyState";

export const DOC_LABELS = [
  "Agreement to Sell",
  "Client CNIC Copy",
  "Client Photo",
  "Payment Receipt Scanned",
  "Legal Notice Sent",
  "Final Legal Notice Sent",
  "Cancellation Notice Sent",
  "Client Reply Received",
  "Court Letter",
  "Cheque Copy",
  "Bank Transfer Slip",
  "Allotment Letter Signed",
  "Possession Letter Signed",
  "Transfer Form Signed",
  "NOC / Clearance",
  "Affidavit",
  "Other",
] as const;

export const SENT_VIA_OPTIONS = ["TCS Courier", "WhatsApp", "Both", "Email"] as const;
const NOTICE_LABELS = new Set<string>([
  "Legal Notice Sent",
  "Final Legal Notice Sent",
  "Cancellation Notice Sent",
  "Court Letter",
]);

const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 10 * 1024 * 1024;

function fileIcon(mime: string | null | undefined, name: string) {
  const m = (mime || "").toLowerCase();
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (m.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp"].includes(ext))
    return FileImage;
  if (m === "application/pdf" || ext === "pdf") return FileText;
  if (m.includes("word") || ["doc", "docx"].includes(ext)) return FileSpreadsheet;
  return FileIcon;
}

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function safeName(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function fmtDateTime(s: string) {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

type PendingItem = {
  id: string;
  file: File;
  label: string;
  customLabel: string;
  docDate: string;
  notes: string;
  sentVia: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

export default function DocumentVault({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const { user, canWrite, companyId } = useAuth();
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<string>("All");

  // bulk-upload queue
  const [queue, setQueue] = useState<PendingItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [bulkLabel, setBulkLabel] = useState<string>(DOC_LABELS[0]);
  const [bulkDate, setBulkDate] = useState(new Date().toISOString().slice(0, 10));

  // preview / delete / edit / audit
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [editDoc, setEditDoc] = useState<any | null>(null);
  const [editLabel, setEditLabel] = useState<string>(DOC_LABELS[0]);
  const [editCustom, setEditCustom] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  // bulk actions (operate on the filtered set)
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditLabel, setBulkEditLabel] = useState<string>(DOC_LABELS[0]);
  const [bulkEditCustom, setBulkEditCustom] = useState("");
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<null | "download" | "edit" | "delete">(null);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["booking-docs", bookingId],
    queryFn: async () =>
      (
        await supabase
          .from("booking_documents")
          .select("*")
          .eq("booking_id", bookingId)
          .order("created_at", { ascending: false })
      ).data ?? [],
  });

  const { data: auditEntries = [], refetch: refetchAudit } = useQuery({
    queryKey: ["booking-doc-audit", bookingId],
    enabled: auditOpen,
    queryFn: async () => {
      const docIds = (docs as any[]).map((d) => d.id);
      const ids = [...docIds, `booking:${bookingId}`];
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("entity", "booking_document")
        .in("entity_id", ids)
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  async function logAudit(action: string, entityId: string, before: any, after: any) {
    if (!user?.id) return;
    try {
      await supabase.from("audit_logs").insert({
        actor_id: user.id,
        actor_email: user.email ?? null,
        action,
        entity: "booking_document",
        entity_id: entityId,
        before,
        after,
      });
    } catch {
      /* non-fatal */
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (docs as any[]).filter((d: any) => {
      if (labelFilter !== "All" && d.label !== labelFilter) return false;
      if (!q) return true;
      return [d.label, d.custom_label, d.file_name, d.notes, d.tracking_no].some((v) =>
        (v || "").toString().toLowerCase().includes(q),
      );
    });
  }, [docs, search, labelFilter]);

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const items: PendingItem[] = [];
    const rejected: string[] = [];
    const emptyRejected: string[] = [];
    for (const f of files) {
      if (f.size === 0) {
        emptyRejected.push(f.name);
        continue;
      }
      if (f.size > MAX_BYTES) {
        rejected.push(f.name);
        continue;
      }
      items.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${f.name}`,
        file: f,
        label: DOC_LABELS[0],
        customLabel: "",
        docDate: new Date().toISOString().slice(0, 10),
        notes: "",
        sentVia: "",
        status: "pending",
      });
    }
    if (rejected.length) {
      toast.error("Some files exceed 10 MB", { description: rejected.join(", ") });
    }
    if (emptyRejected.length) {
      toast.error("Empty files skipped", { description: emptyRejected.join(", ") });
    }
    if (items.length) setQueue((q) => [...q, ...items]);
  }

  function patchItem(id: string, patch: Partial<PendingItem>) {
    setQueue((q) => q.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function removeItem(id: string) {
    setQueue((q) => q.filter((i) => i.id !== id));
  }

  function applyToAll() {
    setQueue((q) =>
      q.map((i) => (i.status === "pending" ? { ...i, label: bulkLabel, docDate: bulkDate } : i)),
    );
  }

  async function doUploadAll() {
    if (queue.length === 0) return;
    // validate "Other" labels
    const missing = queue.find(
      (i) => i.status === "pending" && i.label === "Other" && !i.customLabel.trim(),
    );
    if (missing) {
      toast.error("Custom label required", { description: missing.file.name });
      return;
    }
    setUploading(true);
    let success = 0;
    for (const item of queue) {
      if (item.status !== "pending") continue;
      patchItem(item.id, { status: "uploading" });
      try {
        const stamp = Date.now();
        const path = `${bookingId}/${stamp}_${safeName(item.file.name)}`;
        const up = await supabase.storage
          .from("booking-documents")
          .upload(path, item.file, { contentType: item.file.type, upsert: false });
        if (up.error) throw up.error;
        const { data: row, error } = await supabase
          .from("booking_documents")
          .insert(
            withCompany(
              {
                booking_id: bookingId,
                label: item.label,
                custom_label: item.label === "Other" ? item.customLabel.trim() : null,
                doc_date: item.docDate || null,
                notes: item.notes.trim() || null,
                sent_via: NOTICE_LABELS.has(item.label) ? item.sentVia || null : null,
                file_name: item.file.name,
                file_path: path,
                file_size: item.file.size,
                mime_type: item.file.type || null,
                uploaded_by: user?.id ?? null,
                uploaded_by_name: user?.email ?? null,
              },
              companyId!,
            ),
          )
          .select()
          .single();

        if (error) throw error;
        await logAudit("upload", row.id, null, {
          label: row.label,
          custom_label: row.custom_label,
          file_name: row.file_name,
          file_size: row.file_size,
          doc_date: row.doc_date,
        });
        patchItem(item.id, { status: "done" });
        success++;
      } catch (err: any) {
        patchItem(item.id, { status: "error", error: err.message ?? String(err) });
      }
    }
    setUploading(false);
    if (success) {
      toast.success(`${success} document${success === 1 ? "" : "s"} uploaded`);
      qc.invalidateQueries({ queryKey: ["booking-docs", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-doc-counts"] });
    }
    // auto-close if all done
    setTimeout(() => {
      setQueue((q) => (q.every((i) => i.status === "done") ? [] : q));
    }, 600);
  }

  async function doDownload(d: any) {
    if (!d.file_path) {
      toast.error("File missing from storage");
      return;
    }
    const { data, error } = await supabase.storage
      .from("booking-documents")
      .createSignedUrl(d.file_path, 60, { download: d.file_name });
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAudit("download", d.id, null, { file_name: d.file_name });
    window.open(data.signedUrl, "_blank");
  }

  async function doPreview(d: any) {
    if (!d.file_path) {
      toast.error("File missing from storage");
      return;
    }
    const { data, error } = await supabase.storage
      .from("booking-documents")
      .createSignedUrl(d.file_path, 300);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPreviewUrl(data.signedUrl);
    setPreviewDoc(d);
  }

  async function doDelete(d: any) {
    try {
      await supabase.storage.from("booking-documents").remove([d.file_path]);
      const { error } = await supabase
        .from("booking_documents")
        .delete()
        .eq("id", d.id)
        .eq("company_id", companyId!);
      if (error) throw error;
      await logAudit(
        "delete",
        d.id,
        {
          label: d.label,
          custom_label: d.custom_label,
          file_name: d.file_name,
          doc_date: d.doc_date,
          notes: d.notes,
        },
        null,
      );
      toast.success("Document deleted");
      qc.invalidateQueries({ queryKey: ["booking-docs", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-doc-counts"] });
    } catch (err: any) {
      toast.error("Delete failed", { description: err.message ?? String(err) });
    } finally {
      setConfirmDelete(null);
    }
  }

  function openEdit(d: any) {
    setEditDoc(d);
    setEditLabel(d.label || DOC_LABELS[0]);
    setEditCustom(d.custom_label || "");
    setEditDate(d.doc_date || "");
    setEditNotes(d.notes || "");
  }

  async function saveEdit() {
    if (!editDoc) return;
    if (editLabel === "Other" && !editCustom.trim()) {
      toast.error("Custom label required");
      return;
    }
    setSavingEdit(true);
    try {
      const before = {
        label: editDoc.label,
        custom_label: editDoc.custom_label,
        doc_date: editDoc.doc_date,
        notes: editDoc.notes,
      };
      const after = {
        label: editLabel,
        custom_label: editLabel === "Other" ? editCustom.trim() : null,
        doc_date: editDate || null,
        notes: editNotes.trim() || null,
      };
      const { error } = await supabase
        .from("booking_documents")
        .update(after)
        .eq("id", editDoc.id)
        .eq("company_id", companyId!);
      if (error) throw error;
      await logAudit("edit", editDoc.id, before, after);
      toast.success("Document updated");
      setEditDoc(null);
      qc.invalidateQueries({ queryKey: ["booking-docs", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-doc-counts"] });
    } catch (err: any) {
      toast.error("Update failed", { description: err.message ?? String(err) });
    } finally {
      setSavingEdit(false);
    }
  }

  async function bulkDownload() {
    if (filtered.length === 0) return;
    setBulkBusy("download");
    let ok = 0,
      fail = 0;
    for (const d of filtered) {
      try {
        const { data, error } = await supabase.storage
          .from("booking-documents")
          .createSignedUrl(d.file_path, 60, { download: d.file_name });
        if (error || !data) throw error ?? new Error("signed url failed");
        await logAudit("download", d.id, null, { file_name: d.file_name, bulk: true });
        // trigger download
        const a = document.createElement("a");
        a.href = data.signedUrl;
        a.download = d.file_name;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        ok++;
        // small gap so browsers don't drop concurrent downloads
        await new Promise((r) => setTimeout(r, 250));
      } catch {
        fail++;
      }
    }
    setBulkBusy(null);
    if (ok)
      toast.success(
        `Started download for ${ok} file${ok === 1 ? "" : "s"}${fail ? ` · ${fail} failed` : ""}`,
      );
    else toast.error("Bulk download failed");
  }

  async function bulkApplyLabel() {
    if (filtered.length === 0) return;
    if (bulkEditLabel === "Other" && !bulkEditCustom.trim()) {
      toast.error("Custom label required");
      return;
    }
    setBulkBusy("edit");
    const after = {
      label: bulkEditLabel,
      custom_label: bulkEditLabel === "Other" ? bulkEditCustom.trim() : null,
    };
    let ok = 0,
      fail = 0;
    for (const d of filtered) {
      try {
        const { error } = await supabase
          .from("booking_documents")
          .update(after)
          .eq("id", d.id)
          .eq("company_id", companyId!);
        if (error) throw error;
        await logAudit(
          "edit",
          d.id,
          { label: d.label, custom_label: d.custom_label },
          { ...after, bulk: true },
        );
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkBusy(null);
    setBulkEditOpen(false);
    if (ok) {
      toast.success(
        `Updated ${ok} document${ok === 1 ? "" : "s"}${fail ? ` · ${fail} failed` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["booking-docs", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-doc-counts"] });
    } else {
      toast.error("Bulk update failed");
    }
  }

  async function bulkDeleteAll() {
    if (filtered.length === 0) return;
    setBulkBusy("delete");
    let ok = 0,
      fail = 0;
    const paths = filtered.map((d) => d.file_path).filter(Boolean);
    if (paths.length) {
      try {
        await supabase.storage.from("booking-documents").remove(paths);
      } catch {
        /* continue */
      }
    }
    for (const d of filtered) {
      try {
        const { error } = await supabase
          .from("booking_documents")
          .delete()
          .eq("id", d.id)
          .eq("company_id", companyId!);
        if (error) throw error;
        await logAudit(
          "delete",
          d.id,
          {
            label: d.label,
            custom_label: d.custom_label,
            file_name: d.file_name,
            doc_date: d.doc_date,
            notes: d.notes,
            bulk: true,
          },
          null,
        );
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkBusy(null);
    setBulkDeleteOpen(false);
    if (ok) {
      toast.success(
        `Deleted ${ok} document${ok === 1 ? "" : "s"}${fail ? ` · ${fail} failed` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["booking-docs", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-doc-counts"] });
    } else {
      toast.error("Bulk delete failed");
    }
  }

  const previewable =
    previewDoc &&
    ((previewDoc.mime_type || "").startsWith("image/") ||
      (previewDoc.mime_type || "") === "application/pdf" ||
      /\.(pdf|jpe?g|png|gif|webp)$/i.test(previewDoc.file_name || ""));

  const docNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs as any[])
      m.set(d.id, `${d.label}${d.custom_label ? ` — ${d.custom_label}` : ""} (${d.file_name})`);
    return m;
  }, [docs]);

  const hasAgreement = (docs as any[]).some((d) => d.label === "Agreement to Sell");

  return (
    <div className="card-elevated overflow-hidden">
      <div className="p-4 border-b flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">Document Vault</div>
            {!isLoading && !hasAgreement && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-destructive/10 text-destructive border border-destructive/30">
                <AlertTriangle className="h-3 w-3" /> Agreement missing
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {labelFilter !== "All" || search.trim() ? (
              <>
                Showing <span className="font-semibold text-foreground">{filtered.length}</span> of{" "}
                {(docs as any[]).length} document{(docs as any[]).length === 1 ? "" : "s"}
                {labelFilter !== "All" ? (
                  <>
                    {" "}
                    · label: <span className="font-medium text-foreground">{labelFilter}</span>
                  </>
                ) : null}
              </>
            ) : (
              <>
                {(docs as any[]).length} document{(docs as any[]).length === 1 ? "" : "s"} on file
              </>
            )}
          </div>
        </div>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-9 pl-8 w-48"
          />
        </div>
        <Select value={labelFilter} onValueChange={setLabelFilter}>
          <SelectTrigger className="h-9 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All labels</SelectItem>
            {DOC_LABELS.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => {
            setAuditOpen(true);
            setTimeout(() => refetchAudit(), 0);
          }}
        >
          <History className="h-4 w-4 mr-1.5" /> Audit log
        </Button>
        {canWrite && (
          <label className="inline-flex">
            <input type="file" multiple accept={ACCEPT} className="hidden" onChange={onPickFiles} />
            <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium cursor-pointer hover:opacity-90">
              <Files className="h-4 w-4" /> Upload files
            </span>
          </label>
        )}
      </div>

      {filtered.length > 0 && (labelFilter !== "All" || search.trim()) && (
        <div className="px-4 py-2 border-b bg-muted/20 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            Bulk actions on <span className="font-semibold text-foreground">{filtered.length}</span>{" "}
            filtered document{filtered.length === 1 ? "" : "s"}:
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={!!bulkBusy}
            onClick={bulkDownload}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {bulkBusy === "download" ? "Downloading…" : "Download all"}
          </Button>
          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={!!bulkBusy}
              onClick={() => {
                setBulkEditLabel(labelFilter !== "All" ? labelFilter : DOC_LABELS[0]);
                setBulkEditCustom("");
                setBulkEditOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit label
            </Button>
          )}
          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 min-w-11 text-destructive border-destructive/40 hover:bg-destructive/10"
              disabled={!!bulkBusy}
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete all
            </Button>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground bg-muted/30">
            <tr>
              <th className="text-left px-3 py-2 font-medium w-10">#</th>
              <th className="text-left px-4 py-2 font-medium">Label</th>
              <th className="text-left px-4 py-2 font-medium">File</th>
              <th className="text-left px-4 py-2 font-medium">Date</th>
              <th className="text-left px-4 py-2 font-medium">Sent Via</th>
              <th className="text-left px-4 py-2 font-medium">Uploaded By</th>
              <th className="text-left px-4 py-2 font-medium">Notes</th>
              <th className="text-right px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableRowsSkeleton rows={4} columns={8} />
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-0">
                  <EmptyState
                    icon={FilePlus2}
                    title="No documents on file"
                    description="Upload agreements, CNIC copies, receipts, and other files to keep the vault complete."
                  />
                </td>
              </tr>
            ) : (
              filtered.map((d: any, idx: number) => {
                const Icon = fileIcon(d.mime_type, d.file_name);
                return (
                  <tr key={d.id} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{d.label}</div>
                      {d.custom_label && (
                        <div className="text-xs text-muted-foreground">{d.custom_label}</div>
                      )}
                      {d.tracking_no && (
                        <div className="text-[11px] text-muted-foreground">
                          TCS: {d.tracking_no}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div>
                          <div className="text-xs">{d.file_name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {fmtSize(Number(d.file_size) || 0)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtDate(d.doc_date)}</td>
                    <td className="px-4 py-2 text-xs">{d.sent_via ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {d.uploaded_by_name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground max-w-[220px] truncate">
                      {d.notes ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 min-h-11 min-w-11"
                          title="Preview"
                          aria-label="Preview document"
                          onClick={() => doPreview(d)}
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 min-h-11 min-w-11"
                          title="Download"
                          aria-label="Download document"
                          onClick={() => doDownload(d)}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        {canWrite && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 min-h-11 min-w-11"
                            title="Edit label / notes"
                            aria-label="Edit label or notes"
                            onClick={() => openEdit(d)}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        )}
                        {canWrite && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive min-h-11 min-w-11"
                            title="Delete"
                            aria-label="Delete document"
                            onClick={() => setConfirmDelete(d)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Bulk-upload dialog */}
      <Dialog
        open={queue.length > 0}
        onOpenChange={(o) => {
          if (!o && !uploading) setQueue([]);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Upload {queue.length} document{queue.length === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              Assign a label and date to each file, or apply one to all.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-2 p-3 border rounded-md bg-muted/30">
            <div className="space-y-1">
              <Label className="text-xs">Apply label</Label>
              <Select value={bulkLabel} onValueChange={setBulkLabel}>
                <SelectTrigger className="h-9 w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_LABELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Apply date</Label>
              <Input
                type="date"
                className="h-9 w-44"
                value={bulkDate}
                onChange={(e) => setBulkDate(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" onClick={applyToAll} disabled={uploading}>
              Apply to all
            </Button>
            <div className="ml-auto">
              <label className="inline-flex">
                <input
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="hidden"
                  onChange={onPickFiles}
                  disabled={uploading}
                />
                <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm cursor-pointer hover:bg-muted">
                  <Upload className="h-4 w-4" /> Add more
                </span>
              </label>
            </div>
          </div>

          <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left p-1.5">File</th>
                  <th className="text-left p-1.5 w-56">Label</th>
                  <th className="text-left p-1.5 w-36">Date</th>
                  <th className="text-left p-1.5 w-48">Notes</th>
                  <th className="text-left p-1.5 w-20">Status</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {queue.map((i) => (
                  <tr key={i.id} className="border-t align-top">
                    <td className="p-1.5">
                      <div className="font-medium truncate max-w-[200px]" title={i.file.name}>
                        {i.file.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {fmtSize(i.file.size)}
                      </div>
                    </td>
                    <td className="p-1.5">
                      <Select
                        value={i.label}
                        onValueChange={(v) => patchItem(i.id, { label: v })}
                        disabled={uploading || i.status !== "pending"}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DOC_LABELS.map((l) => (
                            <SelectItem key={l} value={l}>
                              {l}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {i.label === "Other" && (
                        <Input
                          className="h-8 mt-1"
                          placeholder="Custom label"
                          value={i.customLabel}
                          onChange={(e) => patchItem(i.id, { customLabel: e.target.value })}
                          disabled={uploading || i.status !== "pending"}
                        />
                      )}
                    </td>
                    <td className="p-1.5">
                      <Input
                        type="date"
                        className="h-8"
                        value={i.docDate}
                        onChange={(e) => patchItem(i.id, { docDate: e.target.value })}
                        disabled={uploading || i.status !== "pending"}
                      />
                      {NOTICE_LABELS.has(i.label) && (
                        <Select
                          value={i.sentVia}
                          onValueChange={(v) => patchItem(i.id, { sentVia: v })}
                          disabled={uploading || i.status !== "pending"}
                        >
                          <SelectTrigger className="h-8 mt-1">
                            <SelectValue placeholder="Sent via…" />
                          </SelectTrigger>
                          <SelectContent>
                            {SENT_VIA_OPTIONS.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="p-1.5">
                      <Input
                        className="h-8"
                        value={i.notes}
                        placeholder="Optional"
                        onChange={(e) => patchItem(i.id, { notes: e.target.value })}
                        disabled={uploading || i.status !== "pending"}
                      />
                    </td>

                    <td className="p-1.5">
                      {i.status === "pending" && (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                      {i.status === "uploading" && <span className="text-primary">Uploading…</span>}
                      {i.status === "done" && <span className="text-green-600">Done</span>}
                      {i.status === "error" && (
                        <span className="text-destructive" title={i.error}>
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="p-1.5 text-right">
                      {i.status === "pending" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 min-h-11 min-w-11"
                          aria-label="Remove item"
                          onClick={() => removeItem(i.id)}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={uploading} onClick={() => setQueue([])}>
              Close
            </Button>
            <Button
              disabled={uploading || !queue.some((i) => i.status === "pending")}
              onClick={doUploadAll}
            >
              {uploading
                ? "Uploading…"
                : `Upload ${queue.filter((i) => i.status === "pending").length} file(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editDoc} onOpenChange={(o) => !o && !savingEdit && setEditDoc(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit document</DialogTitle>
            <DialogDescription>{editDoc?.file_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Label</Label>
              <Select value={editLabel} onValueChange={setEditLabel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_LABELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editLabel === "Other" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Custom label</Label>
                <Input value={editCustom} onChange={(e) => setEditCustom(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Date of document</Label>
              <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={savingEdit} onClick={() => setEditDoc(null)}>
              Cancel
            </Button>
            <Button disabled={savingEdit} onClick={saveEdit}>
              {savingEdit ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit log dialog */}
      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Document audit log</DialogTitle>
            <DialogDescription>
              All uploads, edits, downloads, and deletions for this booking's documents.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground bg-muted/30 sticky top-0">
                <tr>
                  <th className="text-left p-2">When</th>
                  <th className="text-left p-2">User</th>
                  <th className="text-left p-2">Action</th>
                  <th className="text-left p-2">Document</th>
                  <th className="text-left p-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {(auditEntries as any[]).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted-foreground p-6">
                      No activity yet.
                    </td>
                  </tr>
                ) : (
                  (auditEntries as any[]).map((e) => {
                    const name =
                      docNameById.get(e.entity_id) ??
                      e.after?.file_name ??
                      e.before?.file_name ??
                      "—";
                    let detail = "";
                    if (e.action === "edit" && e.before && e.after) {
                      const diffs: string[] = [];
                      for (const k of ["label", "custom_label", "doc_date", "notes"]) {
                        if ((e.before?.[k] ?? null) !== (e.after?.[k] ?? null)) {
                          diffs.push(`${k}: "${e.before?.[k] ?? ""}" → "${e.after?.[k] ?? ""}"`);
                        }
                      }
                      detail = diffs.join("; ");
                    } else if (e.action === "upload") {
                      detail = `${e.after?.label ?? ""}${e.after?.custom_label ? ` — ${e.after.custom_label}` : ""}`;
                    } else if (e.action === "delete") {
                      detail = `${e.before?.label ?? ""}${e.before?.custom_label ? ` — ${e.before.custom_label}` : ""}`;
                    }
                    const color =
                      e.action === "delete"
                        ? "text-destructive"
                        : e.action === "upload"
                          ? "text-green-600"
                          : e.action === "edit"
                            ? "text-amber-600"
                            : "text-primary";
                    return (
                      <tr key={e.id} className="border-t">
                        <td className="p-2 whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
                        <td className="p-2">{e.actor_email ?? "—"}</td>
                        <td className={`p-2 font-medium uppercase ${color}`}>{e.action}</td>
                        <td className="p-2 max-w-[240px] truncate" title={name}>
                          {name}
                        </td>
                        <td className="p-2 text-muted-foreground">{detail}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog
        open={!!previewUrl}
        onOpenChange={(o) => {
          if (!o) {
            setPreviewUrl(null);
            setPreviewDoc(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewDoc?.label}</DialogTitle>
            <DialogDescription>{previewDoc?.file_name}</DialogDescription>
          </DialogHeader>
          {previewable && previewUrl ? (
            (previewDoc?.mime_type || "").startsWith("image/") ||
            /\.(jpe?g|png|gif|webp)$/i.test(previewDoc?.file_name || "") ? (
              <img
                src={previewUrl}
                alt={previewDoc?.label ? `Preview of ${previewDoc.label}` : "Document preview"}
                className="max-h-[70vh] mx-auto"
              />
            ) : (
              <iframe src={previewUrl} className="w-full h-[70vh]" title={previewDoc?.file_name} />
            )
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Preview not available for this file type. Use Download instead.
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <strong>{confirmDelete?.file_name}</strong> from the vault
              and storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && doDelete(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk edit label */}
      <Dialog
        open={bulkEditOpen}
        onOpenChange={(o) => !o && bulkBusy !== "edit" && setBulkEditOpen(false)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Edit label for {filtered.length} document{filtered.length === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              The new label will be applied to every document in the current filtered view.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">New label</Label>
              <Select value={bulkEditLabel} onValueChange={setBulkEditLabel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_LABELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {bulkEditLabel === "Other" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Custom label</Label>
                <Input value={bulkEditCustom} onChange={(e) => setBulkEditCustom(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={bulkBusy === "edit"}
              onClick={() => setBulkEditOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={bulkBusy === "edit"} onClick={bulkApplyLabel}>
              {bulkBusy === "edit" ? "Applying…" : `Apply to ${filtered.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirm */}
      <AlertDialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => !o && bulkBusy !== "delete" && setBulkDeleteOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {filtered.length} document{filtered.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every document in the current filtered view from the vault
              and storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy === "delete"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={bulkDeleteAll}
            >
              {bulkBusy === "delete" ? "Deleting…" : `Delete ${filtered.length}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
