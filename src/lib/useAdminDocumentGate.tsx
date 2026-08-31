import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { assertAdminDocumentAccess } from "@/lib/documentAccess.functions";
import { AdminRequiredMessage } from "@/lib/adminGate";

/**
 * Server-verified admin gate for document generation / printing / vault
 * screens. Calls `assertAdminDocumentAccess` once on mount; while pending
 * it renders a lightweight placeholder, and on failure it renders the
 * standard AdminRequiredMessage in place of the guarded UI.
 *
 * Use as the FIRST render inside a page component:
 *
 *   const gate = useAdminDocumentGate("documents");
 *   if (gate.blocked) return gate.blocked;
 *
 * This complements — never replaces — the RLS policies on
 * `public.booking_documents` and the `booking-documents` storage bucket.
 */
export function useAdminDocumentGate(scope: string) {
  const assertAccess = useServerFn(assertAdminDocumentAccess);
  const [state, setState] = useState<"pending" | "ok" | "denied">("pending");

  useEffect(() => {
    let alive = true;
    assertAccess({ data: { scope } })
      .then(() => alive && setState("ok"))
      .catch(() => alive && setState("denied"));
    return () => {
      alive = false;
    };
  }, [assertAccess, scope]);

  const blocked =
    state === "pending" ? (
      <div className="p-6 text-sm text-muted-foreground">Verifying access…</div>
    ) : state === "denied" ? (
      <div className="p-6">
        <AdminRequiredMessage action={`Access to ${scope}`} />
      </div>
    ) : null;

  return { state, blocked };
}
