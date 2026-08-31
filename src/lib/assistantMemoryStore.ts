/**
 * Per-user persistence for the assistant's conversation memory.
 * localStorage-scoped by Supabase user id (falls back to "anon" when
 * signed out) so multiple accounts on the same device stay isolated.
 */

import { supabase } from "@/integrations/supabase/client";
import { EMPTY_MEMORY, type ConversationMemory } from "./assistantMemory";

const KEY_PREFIX = "precise-assistant-memory-v1:";

async function uid(): Promise<string> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? "anon";
  } catch {
    return "anon";
  }
}

export async function loadMemory(): Promise<ConversationMemory> {
  if (typeof window === "undefined") return EMPTY_MEMORY;
  const key = KEY_PREFIX + (await uid());
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return EMPTY_MEMORY;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entities)) return EMPTY_MEMORY;
    return parsed as ConversationMemory;
  } catch {
    return EMPTY_MEMORY;
  }
}

export async function saveMemory(memory: ConversationMemory): Promise<void> {
  if (typeof window === "undefined") return;
  const key = KEY_PREFIX + (await uid());
  try {
    window.localStorage.setItem(key, JSON.stringify(memory));
  } catch {
    /* quota */
  }
}

export async function clearMemory(): Promise<void> {
  if (typeof window === "undefined") return;
  const key = KEY_PREFIX + (await uid());
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
