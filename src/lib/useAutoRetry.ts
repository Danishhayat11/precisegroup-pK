import { useEffect, useRef, useState } from "react";

export type AutoRetryOptions = {
  /** Called on each automatic attempt. Should trigger the boundary reset / loader invalidation. */
  onRetry: () => void;
  /** Maximum automatic attempts before giving up. Default 3. */
  maxAttempts?: number;
  /** Base delay in ms. Default 1000. Effective delay = base * 2^attempt + jitter. */
  baseMs?: number;
  /** Cap on the per-attempt delay in ms. Default 15000. */
  maxMs?: number;
  /** Stable key — when it changes, retry state resets (new error, new route, etc.). */
  resetKey?: unknown;
  /** Disable scheduling (e.g. user offline or paused). */
  enabled?: boolean;
};

export type AutoRetryState = {
  /** Number of automatic attempts completed so far. */
  attempt: number;
  /** Whole seconds remaining until the next attempt. 0 while attempting or stopped. */
  secondsUntilRetry: number;
  /** True while an automatic retry is currently pending (waiting then firing). */
  isRetrying: boolean;
  /** True when maxAttempts has been reached without success. */
  exhausted: boolean;
  /** Manually trigger an immediate retry; resets the schedule. */
  retryNow: () => void;
  /** Stop further automatic retries until resetKey changes or reset() is called. */
  stop: () => void;
};

const JITTER = () => Math.floor(Math.random() * 250);

/**
 * Schedules automatic retries with exponential backoff. Designed to be used
 * inside error / not-found boundary components so transient SSR or chunk
 * failures recover without a manual refresh.
 */
export function useAutoRetry({
  onRetry,
  maxAttempts = 3,
  baseMs = 1000,
  maxMs = 15_000,
  resetKey,
  enabled = true,
}: AutoRetryOptions): AutoRetryState {
  const [attempt, setAttempt] = useState(0);
  const [secondsUntilRetry, setSeconds] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [stopped, setStopped] = useState(false);

  // Keep latest callback without re-scheduling each render.
  const onRetryRef = useRef(onRetry);
  useEffect(() => {
    onRetryRef.current = onRetry;
  }, [onRetry]);

  // Reset on new error / route.
  useEffect(() => {
    setAttempt(0);
    setSeconds(0);
    setIsRetrying(false);
    setStopped(false);
  }, [resetKey]);

  const exhausted = attempt >= maxAttempts;

  useEffect(() => {
    if (!enabled || stopped || exhausted) {
      setSeconds(0);
      return;
    }
    const delay = Math.min(maxMs, baseMs * Math.pow(2, attempt)) + JITTER();
    let remaining = Math.ceil(delay / 1000);
    setSeconds(remaining);

    const tick = setInterval(() => {
      remaining -= 1;
      setSeconds(Math.max(0, remaining));
    }, 1000);

    const timer = setTimeout(() => {
      clearInterval(tick);
      setIsRetrying(true);
      setSeconds(0);
      try {
        onRetryRef.current();
      } finally {
        // Mark the attempt; if the boundary clears, this component unmounts
        // and the increment is harmless. If it re-renders with the same error,
        // resetKey is unchanged and we proceed to the next backoff step.
        setAttempt((n) => n + 1);
        setIsRetrying(false);
      }
    }, delay);

    return () => {
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [attempt, baseMs, maxMs, enabled, stopped, exhausted]);

  return {
    attempt,
    secondsUntilRetry,
    isRetrying,
    exhausted,
    retryNow: () => {
      setSeconds(0);
      setIsRetrying(true);
      try {
        onRetryRef.current();
      } finally {
        setAttempt((n) => n + 1);
        setIsRetrying(false);
      }
    },
    stop: () => setStopped(true),
  };
}
