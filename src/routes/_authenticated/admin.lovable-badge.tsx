import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";
import {
  ENV_DEFAULT_HIDE_BADGE,
  applyLovableBadgeAttribute,
  readBadgeOverride,
  resolveHideBadge,
  setBadgeOverride,
  subscribeLovableBadge,
  type BadgeOverride,
} from "@/lib/lovable-badge-runtime";

function getSnapshot(): BadgeOverride {
  return readBadgeOverride();
}
function getServerSnapshot(): BadgeOverride {
  return null;
}

function useBadgeOverride(): BadgeOverride {
  return useSyncExternalStore(subscribeLovableBadge, getSnapshot, getServerSnapshot);
}

function LovableBadgeAdmin() {
  const override = useBadgeOverride();
  const [effective, setEffective] = useState(ENV_DEFAULT_HIDE_BADGE);
  const [status, setStatus] = useState<null | { tone: "success" | "info"; message: string }>(null);
  // Skip the initial mount so we only announce actual user-driven changes.
  const mountedRef = useRef(false);
  const previousOverrideRef = useRef<BadgeOverride>(override);

  // Keep the live attribute in sync on mount + when the override changes.
  useEffect(() => {
    const prevAttr =
      typeof document !== "undefined"
        ? document.documentElement.getAttribute("data-hide-lovable-badge")
        : null;
    const hide = applyLovableBadgeAttribute();
    setEffective(hide);

    if (!mountedRef.current) {
      mountedRef.current = true;
      previousOverrideRef.current = override;
      return;
    }

    const nextAttr = hide ? "true" : "false";
    const attributeChanged = prevAttr !== nextAttr;
    const overrideChanged = previousOverrideRef.current !== override;
    previousOverrideRef.current = override;

    if (!overrideChanged) return;

    const overrideLabel =
      override === null ? "cleared (using build default)" : override === "true" ? "hide" : "show";
    const effectiveWord = hide ? "hidden" : "visible";

    if (attributeChanged) {
      const message = `Override set to "${overrideLabel}". Badge is now ${effectiveWord}.`;
      toast.success(message, {
        description: 'html[data-hide-lovable-badge] updated to "' + nextAttr + '".',
      });
      setStatus({ tone: "success", message });
    } else {
      const message = `Override set to "${overrideLabel}". Effective state unchanged (${effectiveWord}).`;
      toast(message, {
        description: 'html[data-hide-lovable-badge] already "' + nextAttr + '".',
      });
      setStatus({ tone: "info", message });
    }
  }, [override]);

  const handleSet = useCallback((next: BadgeOverride) => {
    setBadgeOverride(next);
  }, []);

  const envLabel = ENV_DEFAULT_HIDE_BADGE ? "hidden" : "visible";
  const effectiveLabel = resolveHideBadge(override) ? "hidden" : "visible";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <PageHeader
        title="Lovable badge"
        description="Runtime override for the Lovable branding badge. Applies to this browser only — flips the html[data-hide-lovable-badge] attribute live without a redeploy."
      />

      <p className="mt-3 text-xs text-muted-foreground">
        Your preference is stored in this browser's <code className="font-mono">localStorage</code>{" "}
        (key <code className="font-mono">lovable-badge-hide-override</code>) and is shared across
        tabs and future sessions on this device. It does not sync to other browsers or devices, and
        clearing site data will reset it to the build default.
      </p>

      <div className="mt-6 rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Build default (VITE_HIDE_LOVABLE_BADGE)</dt>
            <dd className="font-medium">{envLabel}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Local override</dt>
            <dd className="font-medium">
              {override === null
                ? "— (using build default)"
                : override === "true"
                  ? "hidden"
                  : "visible"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Effective (this browser)</dt>
            <dd className="font-semibold">{effectiveLabel}</dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Lovable badge override">
          <button
            type="button"
            onClick={() => handleSet("true")}
            aria-pressed={override === "true"}
            className={`inline-flex min-h-11 items-center rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              override === "true"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-accent"
            }`}
          >
            Hide badge
          </button>
          <button
            type="button"
            onClick={() => handleSet("false")}
            aria-pressed={override === "false"}
            className={`inline-flex min-h-11 items-center rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              override === "false"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-accent"
            }`}
          >
            Show badge
          </button>
          <button
            type="button"
            onClick={() => handleSet(null)}
            aria-pressed={override === null}
            className={`inline-flex min-h-11 items-center rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              override === null
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-accent"
            }`}
          >
            Clear (use build default)
          </button>
        </div>

        {status && (
          <div
            role="status"
            aria-live="polite"
            data-testid="lovable-badge-status"
            className={`mt-4 rounded-md border px-3 py-2 text-sm ${
              status.tone === "success"
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-input bg-muted text-muted-foreground"
            }`}
          >
            {status.message}
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Switching to <strong>Hide badge</strong> re-sweeps the page immediately and removes any
          already-rendered badge — no reload required. Reload is only needed after switching back to{" "}
          <strong>Show badge</strong> to restore nodes that were already purged this session.
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
            className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}

function Guarded() {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Lovable badge" description="Restricted area" />
        <AdminRequiredMessage action="Managing the Lovable badge override" />
      </div>
    );
  }
  return <LovableBadgeAdmin />;
}

export const Route = createFileRoute("/_authenticated/admin/lovable-badge")({
  component: Guarded,
  errorComponent: makeRouteErrorComponent("Lovable badge"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Lovable badge",
    backTo: "/",
  }),
});
