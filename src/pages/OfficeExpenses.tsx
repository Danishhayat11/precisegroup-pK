/* allow-raw-color-file: builds a standalone print-only HTML document in a new window that has no access to the app's CSS theme tokens */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import {
  Download,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileOfficeExpenses } from "@/components/expenses/MobileOfficeExpenses";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { fmtDate, fmtPKR } from "@/lib/format";

// ---- Domain constants ---------------------------------------------------
const CATEGORIES = [
  "Rent",
  "Electricity",
  "Gas",
  "Internet",
  "Phone",
  "Fuel/Transport",
  "Printing/Stationery",
  "Office Supplies",
  "Marketing/Advertising",
  "Legal/Professional Fee",
  "Bank Charges",
  "Maintenance",
  "Salaries",
  "Construction Material",
  "Labour",
  "Food/Refreshment",
  "Side Visits",
  "G8 Visit During Transfer",
  "Guest Entertainment",
  "Other",
] as const;

const PAID_BY = [
  "Cash in Hand",
  "Bank - HBL",
  "Bank - Meezan",
  "Bank - UBL",
  "Petty Cash",
] as const;

type Expense = {
  id: string;
  expense_date: string;
  category: string;
  description: string;
  amount: number;
  paid_by: string;
  paid_to: string | null;
  receipt_ref: string | null;
  project_code: string | null;
  notes: string | null;
  receipt_attachment_path: string | null;
  created_at: string;
};

const RECEIPT_BUCKET = "expense-receipts";
const RECEIPT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const RECEIPT_MAX_LABEL = "10 MB";
const RECEIPT_ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const RECEIPT_ALLOWED_EXT = ["jpg", "jpeg", "png", "webp", "gif", "pdf"];

/** Validate a selected receipt file. Returns an error message, or null when OK. */
function validateReceiptFile(file: File): string | null {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const typeOk = file.type
    ? RECEIPT_ALLOWED.includes(file.type)
    : RECEIPT_ALLOWED_EXT.includes(ext);
  const extOk = RECEIPT_ALLOWED_EXT.includes(ext);
  if (!typeOk || !extOk) {
    return `"${file.name}" isn't a supported receipt. Please upload a JPG, PNG, WebP, GIF, or PDF file.`;
  }
  if (file.size === 0) {
    return `"${file.name}" is empty. Please choose a different file.`;
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `"${file.name}" is ${mb} MB, which is over the ${RECEIPT_MAX_LABEL} limit. Please compress or choose a smaller file.`;
  }
  return null;
}

// ---- Form schema --------------------------------------------------------
const expenseSchema = z.object({
  expense_date: z.string().min(1, "Date is required"),
  category: z
    .string()
    .refine((v) => (CATEGORIES as readonly string[]).includes(v), "Select a category"),
  description: z.string().trim().min(1, "Description is required").max(500),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  paid_by: z
    .string()
    .refine((v) => (PAID_BY as readonly string[]).includes(v), "Select a payment source"),
  paid_to: z.string().trim().max(200).optional().or(z.literal("")),
  receipt_ref: z.string().trim().max(100).optional().or(z.literal("")),
  project_code: z.string().trim().max(50).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

type ExpenseForm = {
  expense_date: string;
  category: string;
  description: string;
  amount: string;
  paid_by: string;
  paid_to: string;
  receipt_ref: string;
  project_code: string;
  notes: string;
  receipt_file: File | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): ExpenseForm => ({
  expense_date: todayISO(),
  category: "",
  description: "",
  amount: "",
  paid_by: "",
  paid_to: "",
  receipt_ref: "",
  project_code: "",
  notes: "",
  receipt_file: null,
});

// ---- Upload progress ----------------------------------------------------
type UploadPhase = "idle" | "preparing" | "uploading" | "finalizing" | "saving";
type UploadState = { phase: UploadPhase; pct: number; fileName?: string };
const IDLE_UPLOAD: UploadState = { phase: "idle", pct: 0 };

const UPLOAD_PHASE_LABEL: Record<Exclude<UploadPhase, "idle">, string> = {
  preparing: "Preparing upload…",
  uploading: "Uploading receipt…",
  finalizing: "Finalizing upload…",
  saving: "Saving expense…",
};

/**
 * Upload a receipt file to Supabase Storage using a signed upload URL and
 * XMLHttpRequest so we can surface real-time byte-level progress.
 */
async function uploadReceiptWithProgress(
  file: File,
  path: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not prepare upload URL");
  }
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", data.signedUrl, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
}

export default function OfficeExpenses() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseForm>(emptyForm());
  const [reportMonth, setReportMonth] = useState(todayISO().slice(0, 7));
  const [upload, setUpload] = useState<UploadState>(IDLE_UPLOAD);

  const closeDialog = () => {
    setDialogMode(null);
    setEditingId(null);
    setForm(emptyForm());
    setUpload(IDLE_UPLOAD);
  };

  const openEdit = (row: Expense) => {
    setEditingId(row.id);
    setForm({
      expense_date: row.expense_date,
      category: row.category,
      description: row.description,
      amount: String(row.amount ?? ""),
      paid_by: row.paid_by,
      paid_to: row.paid_to ?? "",
      receipt_ref: row.receipt_ref ?? "",
      project_code: row.project_code ?? "",
      notes: row.notes ?? "",
      receipt_file: null,
    });
    setDialogMode("edit");
  };

  // Load expenses (client-side filter; office expense volumes are modest).
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["office_expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("office_expenses")
        .select("*")
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Expense[];
    },
  });

  // Projects for the optional dropdown.
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-for-expense"],
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("project_code, project_name")
        .order("project_name");
      return (data ?? []) as { project_code: string; project_name: string }[];
    },
  });

  // Rows within the selected date range (used for the breakdown bars).
  const dateFiltered = useMemo(() => {
    return rows.filter((r) => {
      if (fromDate && r.expense_date < fromDate) return false;
      if (toDate && r.expense_date > toDate) return false;
      return true;
    });
  }, [rows, fromDate, toDate]);

  // Rows shown in the table (date range + optional category).
  const filtered = useMemo(() => {
    if (!categoryFilter) return dateFiltered;
    return dateFiltered.filter((r) => r.category === categoryFilter);
  }, [dateFiltered, categoryFilter]);

  // Summary metrics.
  const now = new Date();
  const yearStr = String(now.getFullYear());
  const monthStr = `${yearStr}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const monthTotal = useMemo(
    () =>
      rows
        .filter((r) => r.expense_date.startsWith(monthStr))
        .reduce((s, r) => s + Number(r.amount || 0), 0),
    [rows, monthStr],
  );
  const yearTotal = useMemo(
    () =>
      rows
        .filter((r) => r.expense_date.startsWith(yearStr))
        .reduce((s, r) => s + Number(r.amount || 0), 0),
    [rows, yearStr],
  );
  const largestCategoryThisMonth = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const r of rows) {
      if (!r.expense_date.startsWith(monthStr)) continue;
      totals[r.category] = (totals[r.category] ?? 0) + Number(r.amount || 0);
    }
    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    return entries[0] ?? null;
  }, [rows, monthStr]);

  // Category breakdown across the date-filtered window (independent of the
  // category selection so the bars stay visible after picking one).
  const breakdown = useMemo(() => {
    const totals: Record<string, number> = {};
    let sum = 0;
    for (const r of dateFiltered) {
      const v = Number(r.amount || 0);
      totals[r.category] = (totals[r.category] ?? 0) + v;
      sum += v;
    }
    const arr = Object.entries(totals)
      .map(([category, amount]) => ({
        category,
        amount,
        pct: sum > 0 ? (amount / sum) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
    return { rows: arr, sum };
  }, [dateFiltered]);

  // Insert mutation.
  const addMutation = useMutation({
    mutationFn: async (payload: ExpenseForm) => {
      const parsed = expenseSchema.parse(payload);

      // Upload receipt first (best-effort — if it fails, the whole save fails).
      let attachmentPath: string | null = null;
      const file = payload.receipt_file;
      if (file) {
        const vErr = validateReceiptFile(file);
        if (vErr) throw new Error(vErr);
        const ext = (file.name.split(".").pop() || "bin").toLowerCase();
        attachmentPath = `receipts/${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
        setUpload({ phase: "preparing", pct: 0, fileName: file.name });
        try {
          setUpload({ phase: "uploading", pct: 0, fileName: file.name });
          await uploadReceiptWithProgress(file, attachmentPath, (pct) =>
            setUpload((s) => ({ ...s, phase: "uploading", pct, fileName: file.name })),
          );
          setUpload({ phase: "finalizing", pct: 100, fileName: file.name });
        } catch (upErr) {
          setUpload(IDLE_UPLOAD);
          throw upErr;
        }
      }
      setUpload((s) => ({ ...s, phase: "saving", pct: file ? 100 : 0, fileName: file?.name }));

      const insert = {
        expense_date: parsed.expense_date,
        category: parsed.category,
        description: parsed.description,
        amount: parsed.amount,
        paid_by: parsed.paid_by,
        paid_to: parsed.paid_to || null,
        receipt_ref: parsed.receipt_ref || null,
        project_code: parsed.project_code || null,
        notes: parsed.notes || null,
        receipt_attachment_path: attachmentPath,
      };
      const { error } = await supabase.from("office_expenses").insert(insert);
      if (error) {
        // Roll back the uploaded file if the insert fails.
        if (attachmentPath) {
          await supabase.storage
            .from(RECEIPT_BUCKET)
            .remove([attachmentPath])
            .catch(() => {});
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Expense saved");
      closeDialog();
      qc.invalidateQueries({ queryKey: ["office_expenses"] });
    },
    onError: (e: any) => {
      setUpload(IDLE_UPLOAD);
      if (e instanceof z.ZodError) {
        toast.error(e.issues[0]?.message ?? "Validation error");
      } else {
        toast.error(e?.message ?? "Failed to save expense");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (row: Expense) => {
      const { error } = await supabase.from("office_expenses").delete().eq("id", row.id);
      if (error) throw error;
      // Best-effort cleanup of the attached receipt.
      if (row.receipt_attachment_path) {
        await supabase.storage
          .from(RECEIPT_BUCKET)
          .remove([row.receipt_attachment_path])
          .catch(() => {});
      }
    },
    onSuccess: () => {
      toast.success("Expense deleted");
      qc.invalidateQueries({ queryKey: ["office_expenses"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete"),
  });

  // Update mutation.
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
      existing,
    }: {
      id: string;
      payload: ExpenseForm;
      existing: Expense;
    }) => {
      const parsed = expenseSchema.parse(payload);

      let newAttachmentPath: string | null = existing.receipt_attachment_path;
      let uploadedPath: string | null = null;
      const file = payload.receipt_file;
      if (file) {
        const vErr = validateReceiptFile(file);
        if (vErr) throw new Error(vErr);
        const ext = (file.name.split(".").pop() || "bin").toLowerCase();
        uploadedPath = `receipts/${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
        setUpload({ phase: "preparing", pct: 0, fileName: file.name });
        try {
          setUpload({ phase: "uploading", pct: 0, fileName: file.name });
          await uploadReceiptWithProgress(file, uploadedPath, (pct) =>
            setUpload((s) => ({ ...s, phase: "uploading", pct, fileName: file.name })),
          );
          setUpload({ phase: "finalizing", pct: 100, fileName: file.name });
        } catch (upErr) {
          setUpload(IDLE_UPLOAD);
          throw upErr;
        }
        newAttachmentPath = uploadedPath;
      }
      setUpload((s) => ({ ...s, phase: "saving", pct: file ? 100 : 0, fileName: file?.name }));

      const update = {
        expense_date: parsed.expense_date,
        category: parsed.category,
        description: parsed.description,
        amount: parsed.amount,
        paid_by: parsed.paid_by,
        paid_to: parsed.paid_to || null,
        receipt_ref: parsed.receipt_ref || null,
        project_code: parsed.project_code || null,
        notes: parsed.notes || null,
        receipt_attachment_path: newAttachmentPath,
      };
      const { error } = await supabase.from("office_expenses").update(update).eq("id", id);
      if (error) {
        if (uploadedPath) {
          await supabase.storage
            .from(RECEIPT_BUCKET)
            .remove([uploadedPath])
            .catch(() => {});
        }
        throw error;
      }
      // Clean up replaced receipt.
      if (
        uploadedPath &&
        existing.receipt_attachment_path &&
        existing.receipt_attachment_path !== uploadedPath
      ) {
        await supabase.storage
          .from(RECEIPT_BUCKET)
          .remove([existing.receipt_attachment_path])
          .catch(() => {});
      }
    },
    onSuccess: () => {
      toast.success("Expense updated");
      closeDialog();
      qc.invalidateQueries({ queryKey: ["office_expenses"] });
    },
    onError: (e: any) => {
      setUpload(IDLE_UPLOAD);
      if (e instanceof z.ZodError) {
        toast.error(e.issues[0]?.message ?? "Validation error");
      } else {
        toast.error(e?.message ?? "Failed to update expense");
      }
    },
  });

  // Table columns.
  const columns: Column<Expense>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (r) => r.expense_date,
      cell: (r) => <span className="tabular-nums">{fmtDate(r.expense_date)}</span>,
    },
    {
      key: "category",
      header: "Category",
      sortValue: (r) => r.category,
      cell: (r) => <span>{r.category}</span>,
    },
    { key: "desc", header: "Description", cell: (r) => <span>{r.description}</span> },
    {
      key: "amt",
      header: "Amount",
      align: "right",
      sortValue: (r) => Number(r.amount) || 0,
      cell: (r) => <span className="tabular-nums font-medium">{fmtPKR(r.amount)}</span>,
    },
    {
      key: "paid_by",
      header: "Paid By",
      cell: (r) => <span className="text-sm">{r.paid_by}</span>,
    },
    {
      key: "paid_to",
      header: "Paid To",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.paid_to || "—"}</span>,
    },
    {
      key: "ref",
      header: "Ref #",
      cell: (r) => <span className="font-mono text-xs">{r.receipt_ref || "—"}</span>,
    },
    {
      key: "proj",
      header: "Project",
      cell: (r) => <span className="font-mono text-xs">{r.project_code || "—"}</span>,
    },
    {
      key: "receipt",
      header: "Receipt",
      align: "center",
      cell: (r) =>
        r.receipt_attachment_path ? (
          <ReceiptViewButton path={r.receipt_attachment_path} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },

    {
      key: "act",
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            aria-label={`Edit expense from ${fmtDate(r.expense_date)}`}
            onClick={() => openEdit(r)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label={`Delete expense from ${fmtDate(r.expense_date)}`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
                <AlertDialogDescription>
                  {fmtDate(r.expense_date)} · {r.category} · {fmtPKR(r.amount)}
                  <br />
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteMutation.mutate(r)}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ),
    },
  ];

  // Monthly report — grouped by category.
  const monthlyReport = useMemo(() => {
    const inMonth = rows.filter((r) => r.expense_date.startsWith(reportMonth));
    const byCat: Record<string, Expense[]> = {};
    let total = 0;
    for (const r of inMonth) {
      (byCat[r.category] ||= []).push(r);
      total += Number(r.amount || 0);
    }
    return { total, byCat, count: inMonth.length };
  }, [rows, reportMonth]);

  const openPrintReport = () => {
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) return toast.error("Popup blocked");
    const [yr, mo] = reportMonth.split("-");
    const monthLabel = new Date(Number(yr), Number(mo) - 1, 1).toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    });
    const rowsHtml = Object.entries(monthlyReport.byCat)
      .sort(
        (a, b) =>
          b[1].reduce((s, r) => s + Number(r.amount), 0) -
          a[1].reduce((s, r) => s + Number(r.amount), 0),
      )
      .map(([cat, list]) => {
        const subtotal = list.reduce((s, r) => s + Number(r.amount), 0);
        const items = list
          .map(
            (r) => `<tr>
              <td>${fmtDate(r.expense_date)}</td>
              <td>${escapeHtml(r.description)}</td>
              <td>${escapeHtml(r.paid_by)}</td>
              <td>${escapeHtml(r.paid_to ?? "")}</td>
              <td>${escapeHtml(r.receipt_ref ?? "")}</td>
              <td class="num">${fmtPKR(r.amount)}</td>
            </tr>`,
          )
          .join("");
        return `
          <section class="cat">
            <h2>${escapeHtml(cat)} <span class="sub">${fmtPKR(subtotal)}</span></h2>
            <table>
              <thead><tr>
                <th>Date</th><th>Description</th><th>Paid By</th>
                <th>Paid To</th><th>Ref #</th><th class="num">Amount</th>
              </tr></thead>
              <tbody>${items}</tbody>
            </table>
          </section>`;
      })
      .join("");

    w.document.write(`<!doctype html><html><head><meta charset="utf-8" />
      <title>Office Expenses — ${monthLabel}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 24px; color: #111; }
        h1 { margin: 0 0 4px; font-size: 20px; }
        .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
        .totals { display: flex; gap: 24px; margin: 8px 0 24px; font-size: 14px; }
        .totals b { display: block; font-size: 18px; }
        .cat { margin-bottom: 20px; page-break-inside: avoid; }
        .cat h2 { font-size: 14px; background: #f3f4f6; padding: 6px 10px; margin: 0 0 6px; border-left: 3px solid #111; display: flex; justify-content: space-between; }
        .sub { font-weight: 500; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border-bottom: 1px solid #e5e7eb; padding: 5px 8px; text-align: left; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        @media print { body { margin: 12mm; } .noprint { display: none; } }
      </style></head><body>
      <h1>Office Expenses — ${monthLabel}</h1>
      <div class="meta">Generated ${new Date().toLocaleString()}</div>
      <div class="totals">
        <div><span>Total entries</span><b>${monthlyReport.count}</b></div>
        <div><span>Total spend</span><b>${fmtPKR(monthlyReport.total)}</b></div>
      </div>
      ${rowsHtml || "<p><em>No expenses recorded for this month.</em></p>"}
      <button class="noprint" onclick="window.print()" style="margin-top:16px;padding:8px 14px;">Print</button>
      </body></html>`);
    w.document.close();
  };

  if (isMobile) return <MobileOfficeExpenses />;

  return (
    <div>
      <PageHeader
        title="Office Expenses"
        description="Track rent, utilities, supplies, and operating costs"
        actions={
          <Button
            onClick={() => {
              setForm(emptyForm());
              setEditingId(null);
              setDialogMode("add");
            }}
          >
            <Plus className="h-4 w-4" />
            <span>Add Expense</span>
          </Button>
        }
      />

      <Dialog
        open={dialogMode !== null}
        onOpenChange={(o) => {
          if (!o) closeDialog();
        }}
      >
        <ExpenseFormDialog
          mode={dialogMode ?? "add"}
          form={form}
          setForm={setForm}
          projects={projects}
          existingReceiptPath={
            dialogMode === "edit"
              ? (rows.find((r) => r.id === editingId)?.receipt_attachment_path ?? null)
              : null
          }
          onSubmit={() => {
            if (dialogMode === "edit" && editingId) {
              const existing = rows.find((r) => r.id === editingId);
              if (!existing) return;
              updateMutation.mutate({ id: editingId, payload: form, existing });
            } else {
              addMutation.mutate(form);
            }
          }}
          submitting={addMutation.isPending || updateMutation.isPending}
          upload={upload}
        />
      </Dialog>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        <SummaryCard
          label="This Month Total"
          value={fmtPKR(monthTotal)}
          hint={new Date().toLocaleString(undefined, { month: "long", year: "numeric" })}
        />
        <SummaryCard label="This Year Total" value={fmtPKR(yearTotal)} hint={yearStr} />
        <SummaryCard
          label="Largest Category (Month)"
          value={largestCategoryThisMonth ? fmtPKR(largestCategoryThisMonth[1]) : "—"}
          hint={largestCategoryThisMonth ? largestCategoryThisMonth[0] : "No expenses yet"}
        />
      </div>

      {/* Filters + monthly report */}
      <Card className="p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="from" className="text-xs">
              From
            </Label>
            <Input
              id="from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div>
            <Label htmlFor="to" className="text-xs">
              To
            </Label>
            <Input
              id="to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-40"
            />
          </div>
          {(fromDate || toDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFromDate("");
                setToDate("");
              }}
            >
              Clear
            </Button>
          )}
          <div className="ml-auto flex items-end gap-2">
            <div>
              <Label htmlFor="rmonth" className="text-xs">
                Report Month
              </Label>
              <Input
                id="rmonth"
                type="month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                className="w-44"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => exportFilteredCsv(filtered, { fromDate, toDate })}
            >
              <Download className="h-4 w-4" />
              <span>Export CSV</span>
            </Button>
            <Button variant="outline" onClick={openPrintReport}>
              <Printer className="h-4 w-4" />
              <span>Monthly Report</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Category breakdown */}
      {breakdown.rows.length > 0 && (
        <Card className="p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">
              Category Breakdown
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                (click a category to filter)
              </span>
            </h2>
            <span className="text-xs text-muted-foreground">Total {fmtPKR(breakdown.sum)}</span>
          </div>
          <ul className="space-y-1">
            {breakdown.rows.map((b) => {
              const active = categoryFilter === b.category;
              return (
                <li key={b.category}>
                  <button
                    type="button"
                    onClick={() => setCategoryFilter(active ? null : b.category)}
                    aria-pressed={active}
                    className={`w-full min-h-11 grid grid-cols-[minmax(140px,180px)_1fr_120px_60px] items-center gap-3 text-sm text-left rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-muted ring-1 ring-primary/40" : ""}`}
                  >
                    <span className={`truncate ${active ? "font-semibold text-primary" : ""}`}>
                      {b.category}
                    </span>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] ${active ? "bg-primary" : "bg-primary/70"}`}
                        style={{ width: `${b.pct}%` }}
                        role="progressbar"
                        aria-valuenow={Math.round(b.pct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${b.category} share`}
                      />
                    </div>
                    <span className="tabular-nums text-right">{fmtPKR(b.amount)}</span>
                    <span className="tabular-nums text-right text-muted-foreground">
                      {b.pct.toFixed(1)}%
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {categoryFilter && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Filtering table by</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">
                {categoryFilter}
                <button
                  type="button"
                  onClick={() => setCategoryFilter(null)}
                  aria-label="Clear category filter"
                  className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          )}
        </Card>
      )}

      {/* Expense table */}
      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading expenses…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <Wallet className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            No expenses recorded
            {categoryFilter ? ` in "${categoryFilter}"` : ""}
            {fromDate || toDate ? " in the selected range" : ""} yet.
          </p>
          {categoryFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => setCategoryFilter(null)}
            >
              Clear category filter
            </Button>
          )}
        </Card>
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(r) => r.id}
          searchKeys={[
            "description",
            "category",
            "paid_by",
            "paid_to",
            "receipt_ref",
            "project_code",
          ]}
          emptyTitle="No office expenses yet"
          emptyDescription="Log rent, utilities, supplies, and operating costs to see monthly spend."
          emptyAction={
            <Button
              onClick={() => {
                setForm(emptyForm());
                setEditingId(null);
                setDialogMode("add");
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Add Expense
            </Button>
          }
        />
      )}
    </div>
  );
}

// ---- Sub components ------------------------------------------------------

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function ExpenseFormDialog({
  mode,
  form,
  setForm,
  projects,
  existingReceiptPath,
  onSubmit,
  submitting,
  upload,
}: {
  mode: "add" | "edit";
  form: ExpenseForm;
  setForm: (f: ExpenseForm) => void;
  projects: { project_code: string; project_name: string }[];
  existingReceiptPath?: string | null;
  onSubmit: () => void;
  submitting: boolean;
  upload: UploadState;
}) {
  const update = <K extends keyof ExpenseForm>(k: K, v: ExpenseForm[K]) =>
    setForm({ ...form, [k]: v });
  const isEdit = mode === "edit";

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit Office Expense" : "Add Office Expense"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update the details of this expense. Amounts are in PKR."
            : "Record a new operational expense. Amounts are in PKR."}
        </DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <div>
          <Label htmlFor="expense_date">Date *</Label>
          <Input
            id="expense_date"
            type="date"
            required
            value={form.expense_date}
            onChange={(e) => update("expense_date", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="amount">Amount (PKR) *</Label>
          <Input
            id="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            required
            value={form.amount}
            onChange={(e) => update("amount", e.target.value)}
            placeholder="0.00"
          />
        </div>

        <div>
          <Label htmlFor="category">Category *</Label>
          <Select value={form.category} onValueChange={(v) => update("category", v)}>
            <SelectTrigger id="category">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="paid_by">Paid By *</Label>
          <Select value={form.paid_by} onValueChange={(v) => update("paid_by", v)}>
            <SelectTrigger id="paid_by">
              <SelectValue placeholder="Select source" />
            </SelectTrigger>
            <SelectContent>
              {PAID_BY.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="description">Description *</Label>
          <Input
            id="description"
            required
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="What was this expense for?"
          />
        </div>

        <div>
          <Label htmlFor="paid_to">Paid To</Label>
          <Input
            id="paid_to"
            value={form.paid_to}
            onChange={(e) => update("paid_to", e.target.value)}
            placeholder="Vendor / person"
          />
        </div>

        <div>
          <Label htmlFor="receipt_ref">Receipt / Ref #</Label>
          <Input
            id="receipt_ref"
            value={form.receipt_ref}
            onChange={(e) => update("receipt_ref", e.target.value)}
            placeholder="Invoice or receipt number"
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="project_code">Project (optional)</Label>
          <Select
            value={form.project_code || "__none__"}
            onValueChange={(v) => update("project_code", v === "__none__" ? "" : v)}
          >
            <SelectTrigger id="project_code">
              <SelectValue placeholder="No project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— No project —</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.project_code} value={p.project_code}>
                  {p.project_code} · {p.project_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            rows={3}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="Any additional context"
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="receipt_file">
            {isEdit && existingReceiptPath
              ? "Replace Receipt Attachment (optional)"
              : "Receipt Attachment (optional)"}
          </Label>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              id="receipt_file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              className="max-w-sm"
              aria-describedby="receipt_file_help"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (!file) {
                  update("receipt_file", null);
                  return;
                }
                const err = validateReceiptFile(file);
                if (err) {
                  toast.error(err);
                  e.target.value = ""; // clear so the same bad file can be re-picked after fixing
                  update("receipt_file", null);
                  return;
                }
                update("receipt_file", file);
              }}
            />
            {form.receipt_file && (
              <>
                <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                  {form.receipt_file.name} · {(form.receipt_file.size / 1024).toFixed(0)} KB
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 min-w-11"
                  aria-label="Remove selected receipt"
                  onClick={() => update("receipt_file", null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
          <p id="receipt_file_help" className="mt-1 text-[11px] text-muted-foreground">
            Image (JPG, PNG, WebP, GIF) or PDF, up to {RECEIPT_MAX_LABEL}.
            {isEdit && existingReceiptPath && !form.receipt_file
              ? " Leave empty to keep the current receipt."
              : ""}
          </p>
        </div>

        {upload.phase !== "idle" && (
          <div
            className="sm:col-span-2 rounded-md border bg-muted/40 p-3"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
                {UPLOAD_PHASE_LABEL[upload.phase]}
              </span>
              {upload.phase === "uploading" && (
                <span className="tabular-nums text-xs text-muted-foreground">{upload.pct}%</span>
              )}
            </div>
            {(upload.phase === "uploading" ||
              upload.phase === "preparing" ||
              upload.phase === "finalizing") && (
              <Progress
                value={
                  upload.phase === "uploading"
                    ? upload.pct
                    : upload.phase === "finalizing"
                      ? 100
                      : 5
                }
                className="mt-2 h-2"
                aria-label={`${UPLOAD_PHASE_LABEL[upload.phase]} ${upload.phase === "uploading" ? `${upload.pct} percent` : ""}`}
              />
            )}
            {upload.fileName && (
              <p className="mt-1 text-[11px] text-muted-foreground truncate">{upload.fileName}</p>
            )}
          </div>
        )}

        <DialogFooter className="sm:col-span-2">
          <Button type="submit" disabled={submitting}>
            {submitting
              ? upload.phase === "uploading"
                ? `Uploading ${upload.pct}%…`
                : upload.phase === "preparing"
                  ? "Preparing…"
                  : upload.phase === "finalizing"
                    ? "Finalizing…"
                    : isEdit
                      ? "Updating…"
                      : "Saving…"
              : isEdit
                ? "Update Expense"
                : "Save Expense"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function ReceiptViewButton({ path }: { path: string }) {
  const isPdf = path.toLowerCase().endsWith(".pdf");
  const [loading, setLoading] = useState(false);
  const kind = isPdf ? "PDF" : "image";
  const open = async () => {
    if (loading) return;
    setLoading(true);
    // Open the tab synchronously so Safari/Firefox don't block it after the await.
    const tab = window.open("about:blank", "_blank", "noopener");
    try {
      const { data, error } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .createSignedUrl(path, 60 * 10); // 10-minute view window
      if (error || !data?.signedUrl) {
        tab?.close();
        toast.error(
          error?.message
            ? `Could not open receipt: ${error.message}`
            : "Could not open receipt — the file may be missing or you don't have access. Try again in a moment.",
        );
        return;
      }
      if (tab) {
        tab.location.href = data.signedUrl;
      } else {
        toast.error("Popup blocked — allow popups for this site to view the receipt.");
      }
    } catch (e) {
      tab?.close();
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error(`Could not open receipt: ${msg}`);
    } finally {
      setLoading(false);
    }
  };
  const label = loading ? `Opening receipt (${kind})…` : `View receipt (${kind})`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="min-h-11 min-w-11"
      onClick={open}
      disabled={loading}
      aria-label={label}
      aria-busy={loading}
      title={label}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
      ) : (
        <Paperclip className="h-4 w-4 text-primary" aria-hidden="true" />
      )}
      <span className="sr-only">{label}</span>
    </Button>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportFilteredCsv(rows: Expense[], range: { fromDate: string; toDate: string }): void {
  if (rows.length === 0) {
    toast.error("Nothing to export in the current view");
    return;
  }
  const headers = [
    "Date",
    "Category",
    "Description",
    "Amount (PKR)",
    "Paid By",
    "Paid To",
    "Receipt Ref",
    "Project Code",
    "Notes",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.expense_date,
        r.category,
        r.description,
        Number(r.amount ?? 0).toFixed(2),
        r.paid_by,
        r.paid_to ?? "",
        r.receipt_ref ?? "",
        r.project_code ?? "",
        r.notes ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const csv = "\ufeff" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const suffix =
    [range.fromDate, range.toDate].filter(Boolean).join("_to_") ||
    new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `office-expenses_${suffix}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${rows.length} expense${rows.length === 1 ? "" : "s"}`);
}
