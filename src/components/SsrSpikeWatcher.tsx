import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { callRpc } from "@/integrations/supabase/approvedRpc";

type SpikeResult = {
  alert: boolean;
  count_5m: number;
  threshold: number;
  cooldown_minutes: number;
  last_alerted_at: string | null;
} | null;

const POLL_MS = 30_000;

async function requestNotificationPermissionOnce(): Promise<
  NotificationPermission | "unsupported"
> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }
  return Notification.permission;
}

/**
 * Admin-only background poller. Every 30s it calls check_ssr_spike(), which
 * atomically returns alert=true at most once per cooldown window when the
 * last-5-minute SSR-fallback render count crosses the configured threshold.
 * On alert: toast (sonner), browser Notification, and an audible beep.
 */
export function SsrSpikeWatcher() {
  const { isAdmin } = useAuth();
  const lastFiredRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void requestNotificationPermissionOnce();

    const tick = async () => {
      const { data, error } = await callRpc("check_ssr_spike");
      if (cancelled) return;
      if (error) {
        // If forbidden or not authorized, stop polling to avoid console noise
        if ((error as any)?.reason === "forbidden" || (error as any)?.code === "RPC_NOT_AUTHORIZED") {
          cancelled = true;
        }
        return;
      }
      if (!data) return;
      const result = data as unknown as SpikeResult;
      if (!result?.alert) return;
      // Guard against double-firing if the poller overlaps.
      const fp = result.last_alerted_at ?? new Date().toISOString();
      if (lastFiredRef.current === fp) return;
      lastFiredRef.current = fp;

      const msg = `${result.count_5m} catastrophic-SSR fallbacks in the last 5 min (threshold ${result.threshold}).`;
      toast.error("SSR fallback spike detected", {
        description: msg,
        duration: 30_000,
        action: {
          label: "Open monitor",
          onClick: () => {
            window.location.href = "/admin/ssr-monitor";
          },
        },
      });

      try {
        if (
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          new Notification("SSR fallback spike", {
            body: msg,
            tag: "ssr-spike",
            requireInteraction: true,
          });
        }
      } catch {
        /* notification API rejected */
      }

      try {
        const ctxAny = window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        };
        const Ctor = ctxAny.AudioContext ?? ctxAny.webkitAudioContext;
        if (Ctor) {
          const ac = new Ctor();
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.frequency.value = 880;
          gain.gain.value = 0.08;
          osc.connect(gain).connect(ac.destination);
          osc.start();
          setTimeout(() => {
            osc.stop();
            ac.close().catch(() => {});
          }, 250);
        }
      } catch {
        /* audio blocked */
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isAdmin]);

  return null;
}
