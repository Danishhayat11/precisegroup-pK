import { supabase } from "@/integrations/supabase/client";

/**
 * Append-only change-history log for tenant-scoped settings edits.
 * Currently records: company email, per-project display name (save + reset).
 * Failures are swallowed with a console.warn — a logging hiccup must never
 * block the underlying settings save.
 */
export type SettingsChangeEntry = {
  company_id: string;
  entity_type: "company" | "project";
  entity_label: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
};

export async function logSettingsChange(entry: SettingsChangeEntry): Promise<void> {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user ?? null;
    const norm = (v: string | null | undefined) => {
      const s = (v ?? "").toString().trim();
      return s.length ? s : null;
    };
    const oldV = norm(entry.old_value);
    const newV = norm(entry.new_value);
    if (oldV === newV) return; // nothing meaningful changed
    await supabase.from("settings_change_log").insert({
      company_id: entry.company_id,
      entity_type: entry.entity_type,
      entity_label: entry.entity_label,
      field: entry.field,
      old_value: oldV,
      new_value: newV,
      changed_by: user?.id ?? null,
      changed_by_email: user?.email ?? null,
    });
  } catch (e) {
    // Non-fatal: never block the caller's primary write.

    console.warn("settings change log failed", e);
  }
}
