/**
 * SINGLE source-of-truth "today" for the entire app.
 *
 * Mirrors the SQL `public.get_system_date()` function. Use this in EVERY
 * place that needs "today" — never call `new Date()` ad-hoc inside a
 * component. Components subscribe via `useSystemDate()` so a midnight
 * rollover or admin override is reflected everywhere on the next render.
 *
 * Storage: `public.app_settings` row with key='system_date_override',
 * value={ "date": "YYYY-MM-DD" } — admin-only writes.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

let cached: { date: string; fetchedAt: number } | null = null;
const TTL_MS = 60_000;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function fetchSystemDate(): Promise<string> {
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.date;
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "system_date_override")
    .maybeSingle();
  const override = (data?.value as any)?.date;
  const date =
    typeof override === "string" && /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : todayISO();
  cached = { date, fetchedAt: Date.now() };
  return date;
}

export function invalidateSystemDate() {
  cached = null;
}

/** Synchronous fallback — only safe inside pure functions called from a context that already resolved the date. */
export function getSystemDateSync(): string {
  return cached?.date ?? todayISO();
}

export function useSystemDate() {
  const q = useQuery({ queryKey: ["system-date"], queryFn: fetchSystemDate, staleTime: TTL_MS });
  return q.data ?? todayISO();
}

export async function setSystemDateOverride(date: string | null) {
  invalidateSystemDate();
  if (!date) {
    await supabase.from("app_settings").delete().eq("key", "system_date_override");
    return;
  }
  await supabase.from("app_settings").upsert({ key: "system_date_override", value: { date } });
}
