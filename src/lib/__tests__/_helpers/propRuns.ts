/**
 * Scale fast-check `numRuns` from an env var so CI can dial collision
 * coverage up on nightly runs and keep PRs fast.
 *
 * Precedence:
 *   1. `FC_NUM_RUNS` — exact override, used verbatim (ignores `base`).
 *   2. `FC_RUNS_MULTIPLIER` — multiplies the per-test `base` count.
 *   3. Neither set → return `base` unchanged (PR / local default).
 *
 * Any parse failure (non-numeric, ≤ 0) falls back to `base`.
 */
export function propRuns(base: number): number {
  const exact = Number(process.env.FC_NUM_RUNS);
  if (Number.isFinite(exact) && exact > 0) return Math.floor(exact);
  const mult = Number(process.env.FC_RUNS_MULTIPLIER);
  if (Number.isFinite(mult) && mult > 0) return Math.max(1, Math.floor(base * mult));
  return base;
}
