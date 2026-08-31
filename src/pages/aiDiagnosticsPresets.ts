/**
 * Named search/filter presets for the AI Diagnostics page.
 *
 * Storage-only module (no React) so the shape can be shared between the
 * component, tests, and any future URL-import flow. Presets live in
 * localStorage under `AI_DIAGNOSTICS_PRESETS_KEY` as a JSON array; the
 * parser is defensive so a corrupted or partial entry simply gets
 * skipped rather than blowing up the whole menu.
 *
 * We DELIBERATELY don't persist `page` — a preset represents a filtered
 * view, not a scroll position; applying one always jumps to page 1 so
 * the results actually match what the user picked.
 */
export type PresetFilterState = {
  q?: string;
  status?: string;
  retry?: string;
  tool?: string;
  sort?: string;
  dir?: string;
  size?: number;
};

export type FilterPreset = {
  id: string;
  name: string;
  state: PresetFilterState;
};

export const AI_DIAGNOSTICS_PRESETS_KEY = "ai-diagnostics.filter-presets.v1";

const FIELDS: (keyof PresetFilterState)[] = ["q", "status", "retry", "tool", "sort", "dir", "size"];

export function loadPresets(): FilterPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(AI_DIAGNOSTICS_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is FilterPreset =>
        !!p &&
        typeof p === "object" &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        !!p.state &&
        typeof p.state === "object",
    );
  } catch {
    return [];
  }
}

export function savePresets(presets: FilterPreset[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_DIAGNOSTICS_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    /* storage disabled — the in-memory copy still works this session */
  }
}

/** Strip empty/default values so presets stay compact and round-trip cleanly. */
export function normaliseState(state: PresetFilterState): PresetFilterState {
  const out: PresetFilterState = {};
  for (const k of FIELDS) {
    const v = state[k];
    if (v === undefined || v === null || v === "" || v === "all") continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Build the patch fed to `patchSearch` when applying a preset. Every
 * known field is included so switching presets CLEARS fields the new
 * preset doesn't mention (otherwise stale filters would leak across).
 * `page` is always reset to 1.
 */
export function toSearchPatch(
  state: PresetFilterState,
): Record<string, string | number | undefined> {
  const patch: Record<string, string | number | undefined> = { page: undefined };
  for (const k of FIELDS) {
    const v = state[k];
    patch[k] = v === undefined || v === "" || v === "all" ? undefined : (v as string | number);
  }
  return patch;
}

/** Compare two preset states for equality after normalisation. */
export function statesEqual(a: PresetFilterState, b: PresetFilterState): boolean {
  const na = normaliseState(a);
  const nb = normaliseState(b);
  const ka = Object.keys(na);
  const kb = Object.keys(nb);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => (na as Record<string, unknown>)[k] === (nb as Record<string, unknown>)[k]);
}
