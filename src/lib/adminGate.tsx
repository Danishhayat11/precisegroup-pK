import { ReactNode, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ShieldAlert, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { logRedirectReason } from "@/lib/redirectLog";
import { callRpc } from "@/integrations/supabase/approvedRpc";

/**
 * List the admins a staff user can contact to request a fix.
 * Backed by the `list_admin_contacts()` SECURITY DEFINER function so we do
 * not need to widen SELECT on profiles.
 */
export function useAdminContacts() {
  return useQuery({
    queryKey: ["admin-contacts"],
    queryFn: async () => {
      const { data, error } = await callRpc("list_admin_contacts" as any, {} as any);
      if (error) return [] as { email: string; full_name: string | null }[];
      return (data ?? []) as { email: string; full_name: string | null }[];
    },
    staleTime: 5 * 60_000,
  });
}

export function AdminRequiredMessage({
  action,
  onRequestEdit,
}: {
  action: string;
  onRequestEdit?: () => void;
}) {
  const { data: admins = [] } = useAdminContacts();
  const names =
    admins.length === 0
      ? "an administrator"
      : admins
          .slice(0, 4)
          .map((a) => a.full_name || a.email)
          .join(", ") + (admins.length > 4 ? ", …" : "");
  return (
    <Alert variant="default" className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
      <ShieldAlert className="h-4 w-4 text-amber-700" />
      <AlertTitle className="text-amber-900 dark:text-amber-200">Admin access required</AlertTitle>
      <AlertDescription className="text-amber-900/90 dark:text-amber-200/90">
        <div>
          <strong className="font-semibold">{action}</strong> requires Admin access. Ask{" "}
          <span className="font-medium">{names}</span> or request an edit via a comment instead.
        </div>
        {onRequestEdit && (
          <button
            type="button"
            onClick={onRequestEdit}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 hover:no-underline"
          >
            Leave an edit request →
          </button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Render `children` only for admins; render nothing otherwise. */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return null;
  return <>{children}</>;
}

/**
 * Render a locked placeholder for non-admins that explains what's blocked and
 * offers the comment workflow. Renders `children` unchanged for admins.
 */
export function AdminGate({
  action,
  children,
  onRequestEdit,
}: {
  action: string;
  children: ReactNode;
  onRequestEdit?: () => void;
}) {
  const { isAdmin } = useAuth();
  // Fires on the client only, once per mount+role change, so we can see
  // which restricted actions non-admins keep hitting in production.
  useEffect(() => {
    if (isAdmin) return;
    const path = typeof window !== "undefined" ? window.location.pathname : null;
    logRedirectReason("non_admin_denied", {
      from: path,
      to: path,
      meta: { action },
    });
  }, [isAdmin, action]);
  if (isAdmin) return <>{children}</>;
  return (
    <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 p-6 space-y-4">
      <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 text-sm font-semibold">
        <Lock className="h-4 w-4" />
        Restricted to Admins
      </div>
      <AdminRequiredMessage action={action} onRequestEdit={onRequestEdit} />
    </div>
  );
}
