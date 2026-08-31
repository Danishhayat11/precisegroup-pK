import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useLiveAnnouncer — queue-based screen-reader announcement channel.
 *
 * Why this exists
 * ----------------
 * A naive live-region pattern (`setText("")` → `requestAnimationFrame(() => setText(msg))`)
 * has three subtle failure modes on rapid or repeated calls:
 *
 *   1. **Coalesced updates.** Two announce() calls in the same tick
 *      both write `""` then both write their message in the next rAF
 *      frame. React 18 batches the writes, the intermediate `""`
 *      never commits to the DOM, and the region observes a single
 *      transition from previous → last message. Screen readers only
 *      hear the last one; the first announcement is silently lost.
 *
 *   2. **Overlapping speech.** A screen reader takes ~700–1500ms to
 *      read a short sentence. Firing a second polite announcement
 *      100ms later cuts the first sentence off mid-word. Users hear
 *      partial garbage and lose the earlier event entirely.
 *
 *   3. **Duplicate spam.** A retried mutation (React Query re-fire,
 *      double-click) that announces the *same* text back-to-back
 *      reads twice — annoying at best, confusing at worst.
 *
 * This hook fixes all three by putting announcements through a
 * per-channel FIFO queue with:
 *   • a strict clear→text sequence per item, one at a time, so the
 *     empty commit is guaranteed to flush before the text commit;
 *   • a fixed `MIN_INTERVAL_MS` gap between drains so each message
 *     has time to be read before the next one starts;
 *   • a short dedupe window so identical back-to-back messages
 *     collapse to a single utterance.
 *
 * Two independent channels (`polite`, `assertive`) are exposed so
 * an urgent conversion never gets stuck behind a polite queue and
 * a routine move never interrupts an urgent alert.
 */

// One-second-plus gap between announcements. Chosen to sit just
// above the median SR speaking rate for a short sentence like
// "Ali Khan moved to stage Site Visit Scheduled." Shorter values
// (e.g. 400ms) cut the previous sentence off in NVDA/VoiceOver.
const MIN_INTERVAL_MS = 1200;

// Any repeat of the exact same message within this window is
// considered a spurious re-fire (retry, double click, StrictMode
// double-invoke) and dropped. Longer than a single frame, short
// enough that a legitimate re-announcement of the same event still
// gets through.
const DEDUPE_WINDOW_MS = 500;

type Politeness = "polite" | "assertive";
type QueueItem = { text: string; seq: number };

export function useLiveAnnouncer() {
  const [politeText, setPoliteText] = useState("");
  const [assertiveText, setAssertiveText] = useState("");

  // Refs, not state — mutating these must NOT trigger a re-render
  // (the render is driven by the two `setText` calls inside `drain`).
  const politeQueue = useRef<QueueItem[]>([]);
  const assertiveQueue = useRef<QueueItem[]>([]);
  const politeBusy = useRef(false);
  const assertiveBusy = useRef(false);
  const seqRef = useRef(0);
  const lastByChannel = useRef<Record<Politeness, { text: string; at: number } | null>>({
    polite: null,
    assertive: null,
  });
  const timeouts = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const rafs = useRef<Set<number>>(new Set());

  // Clean up on unmount — a pending rAF that fires after unmount
  // would call a setter on a dead component (dev-mode warning) and
  // an orphaned timeout would leak.
  useEffect(() => {
    const timeoutSet = timeouts.current;
    const rafSet = rafs.current;
    return () => {
      for (const t of timeoutSet) clearTimeout(t);
      timeoutSet.clear();
      for (const r of rafSet) cancelAnimationFrame(r);
      rafSet.clear();
    };
  }, []);

  const drain = useCallback((channel: Politeness) => {
    const queue = channel === "polite" ? politeQueue.current : assertiveQueue.current;
    const busyRef = channel === "polite" ? politeBusy : assertiveBusy;
    const setter = channel === "polite" ? setPoliteText : setAssertiveText;

    if (busyRef.current) return;
    const next = queue.shift();
    if (!next) return;

    busyRef.current = true;

    // Clear first so identical consecutive messages still register
    // as a mutation on the live region. Empty must commit BEFORE
    // the text commit — rAF between them guarantees the two React
    // renders don't batch into a single DOM update.
    setter("");
    const raf = requestAnimationFrame(() => {
      rafs.current.delete(raf);
      setter(next.text);

      const t = setTimeout(() => {
        timeouts.current.delete(t);
        busyRef.current = false;
        drain(channel);
      }, MIN_INTERVAL_MS);
      timeouts.current.add(t);
    });
    rafs.current.add(raf);
  }, []);

  const announce = useCallback(
    (msg: string, urgent = false) => {
      const text = (msg ?? "").trim();
      if (!text) return;

      const channel: Politeness = urgent ? "assertive" : "polite";

      // Dedupe: same message on the same channel within the window
      // is treated as a spurious re-fire and dropped. Note we key on
      // channel — the same text is legitimately allowed on both
      // channels (rare, but not our call to block).
      const last = lastByChannel.current[channel];
      const now = Date.now();
      if (last && last.text === text && now - last.at < DEDUPE_WINDOW_MS) return;
      lastByChannel.current[channel] = { text, at: now };

      const queue = channel === "polite" ? politeQueue.current : assertiveQueue.current;
      queue.push({ text, seq: ++seqRef.current });
      drain(channel);
    },
    [drain],
  );

  return { politeText, assertiveText, announce };
}
