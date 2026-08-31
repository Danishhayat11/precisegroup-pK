import { supabase } from "@/integrations/supabase/client";

export type StoredMsg = {
  role: "user" | "assistant";
  content: string;
  at: number;
  bookingId?: string | null;
  bookingLabel?: string | null;
};

const LS_KEY = "precise-assistant-chat-v1";
const MAX_KEEP = 80;

function readLocal(): StoredMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(-MAX_KEEP) : [];
  } catch {
    return [];
  }
}
function writeLocal(msgs: StoredMsg[]) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(msgs.slice(-MAX_KEEP)));
  } catch {
    /* ignore */
  }
}
function clearLocal() {
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Load history for the active user (or local fallback if signed out). */
export async function loadHistory(): Promise<StoredMsg[]> {
  const uid = await currentUserId();
  if (!uid) return readLocal();
  const { data, error } = await supabase
    .from("assistant_messages")
    .select("role,content,created_at,booking_id,booking_label")
    .eq("user_id", uid)
    .order("created_at", { ascending: true })
    .limit(MAX_KEEP);
  if (error || !data) {
    return readLocal();
  }
  const msgs: StoredMsg[] = data.map((r: any) => ({
    role: r.role as "user" | "assistant",
    content: r.content as string,
    at: new Date(r.created_at as string).getTime(),
    bookingId: (r.booking_id as string | null) ?? null,
    bookingLabel: (r.booking_label as string | null) ?? null,
  }));
  writeLocal(msgs);
  return msgs;
}

/** Persist a single new message. Writes to Supabase if signed in; always mirrors locally. */
export async function appendMessage(msg: StoredMsg, allMessages: StoredMsg[]): Promise<void> {
  writeLocal(allMessages);
  const uid = await currentUserId();
  if (!uid) return;
  const { error } = await supabase.from("assistant_messages").insert({
    user_id: uid,
    role: msg.role,
    content: msg.content,
    created_at: new Date(msg.at).toISOString(),
    booking_id: msg.bookingId ?? null,
    booking_label: msg.bookingLabel ?? null,
  } as any);
  if (error) console.warn("[assistant] persist failed:", error.message);
}

/** Wipe the user's stored history (and local mirror). */
export async function clearHistory(): Promise<void> {
  clearLocal();
  const uid = await currentUserId();
  if (!uid) return;
  const { error } = await supabase.from("assistant_messages").delete().eq("user_id", uid);
  if (error) console.warn("[assistant] clear failed:", error.message);
}
