/**
 * QA-only tenant switcher used from /tenant-isolation-test. Admin-gated by
 * the parent route. Stores two labeled sign-in slots in localStorage so an
 * admin can flip between tenant #1 and tenant #2 sessions end-to-end.
 *
 * Passwords are optional: when saved, the switcher signs in directly; when
 * not, it redirects to /login with the email pre-filled and `next` set back
 * to this page so you can hand-type the password once and land back here.
 *
 * SECURITY: Storing passwords in localStorage is a developer convenience for
 * QA in a controlled environment. The UI warns clearly. Do not use these
 * slots for production credentials.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CheckCircle2, LogOut, RefreshCw, Save, User } from "lucide-react";

const TENANT_1_ID = "00000000-0000-0000-0000-000000000001";
const TENANT_2_ID = "00000000-0000-0000-0000-000000000002";
const STORAGE_KEY = "qa:tenantAccounts";
const NEXT_PATH = "/tenant-isolation-test";

type Slot = { email: string; password?: string };
type Accounts = { tenant1?: Slot; tenant2?: Slot };

function loadAccounts(): Accounts {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Accounts) : {};
  } catch {
    return {};
  }
}

function saveAccounts(next: Accounts) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function TenantSwitcher() {
  const qc = useQueryClient();
  const { companyId } = useCurrentCompany();
  const [accounts, setAccounts] = useState<Accounts>({});
  const [busy, setBusy] = useState<null | "tenant1" | "tenant2">(null);

  // Read localStorage on the client only — avoids SSR hydration mismatch.
  useEffect(() => {
    setAccounts(loadAccounts());
  }, []);

  const currentLabel = useMemo(() => {
    if (companyId === TENANT_1_ID) return "Tenant #1";
    if (companyId === TENANT_2_ID) return "Tenant #2";
    return companyId ? "Other tenant" : "Unknown";
  }, [companyId]);

  const currentVariant: "default" | "secondary" | "outline" =
    companyId === TENANT_1_ID ? "default" : companyId === TENANT_2_ID ? "secondary" : "outline";

  const update = (slot: "tenant1" | "tenant2", patch: Partial<Slot>) => {
    setAccounts((prev) => {
      const cur = prev[slot] ?? { email: "" };
      const next: Accounts = { ...prev, [slot]: { ...cur, ...patch } };
      saveAccounts(next);
      return next;
    });
  };

  const clearSlot = (slot: "tenant1" | "tenant2") => {
    setAccounts((prev) => {
      const next = { ...prev };
      delete next[slot];
      saveAccounts(next);
      return next;
    });
    toast.success(`${slot === "tenant1" ? "Tenant #1" : "Tenant #2"} slot cleared`);
  };

  const switchTo = async (slot: "tenant1" | "tenant2") => {
    const acct = accounts[slot];
    if (!acct?.email) {
      toast.error("Save an email for this slot first.");
      return;
    }
    setBusy(slot);
    try {
      // Cache teardown before we sign the current session out (matches
      // Sign-Out Hygiene in tanstack-auth-guards).
      await qc.cancelQueries();
      qc.clear();
      await supabase.auth.signOut();

      if (acct.password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: acct.email,
          password: acct.password,
        });
        if (error) throw error;
        toast.success(`Signed in as ${acct.email}`);
        // Reload to rehydrate all providers under the new session; landing
        // on the isolation page confirms end-to-end scoping.
        window.location.assign(NEXT_PATH);
      } else {
        // No password stored — send to /login with prefill; the login page
        // sends the user back here via ?next=.
        const url = `/login?email=${encodeURIComponent(acct.email)}&next=${encodeURIComponent(NEXT_PATH)}`;
        window.location.assign(url);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign-in failed");
      setBusy(null);
    }
  };

  const signOutOnly = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    window.location.assign(`/login?next=${encodeURIComponent(NEXT_PATH)}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Tenant switcher
          <span className="ml-auto flex items-center gap-2 text-sm font-normal">
            <User className="h-4 w-4 text-muted-foreground" />
            Current:
            <Badge variant={currentVariant}>{currentLabel}</Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Save two admin accounts (one per tenant) to flip sessions from this page. Passwords are
          optional — leave them blank and you'll be sent to the sign-in page with the email
          pre-filled. Credentials are stored in this browser's localStorage for QA convenience; do
          not use production passwords here.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {(["tenant1", "tenant2"] as const).map((slot) => {
            const acct = accounts[slot] ?? { email: "" };
            const label = slot === "tenant1" ? "Tenant #1" : "Tenant #2";
            const isCurrent =
              (slot === "tenant1" && companyId === TENANT_1_ID) ||
              (slot === "tenant2" && companyId === TENANT_2_ID);
            return (
              <div
                key={slot}
                className="rounded-lg border border-border p-3 space-y-3"
                data-current={isCurrent || undefined}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    {label}
                    {isCurrent && (
                      <Badge variant="outline" className="gap-1">
                        <CheckCircle2 className="h-3 w-3 text-success" />
                        active
                      </Badge>
                    )}
                  </div>
                  {acct.email && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => clearSlot(slot)}>
                      Clear
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  <div>
                    <Label htmlFor={`${slot}-email`} className="text-xs">
                      Admin email
                    </Label>
                    <Input
                      id={`${slot}-email`}
                      type="email"
                      autoComplete="off"
                      value={acct.email}
                      placeholder={`${label} admin email`}
                      onChange={(e) => update(slot, { email: e.target.value })}
                      className="min-h-[44px] lg:min-h-0"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${slot}-pw`} className="text-xs">
                      Password (optional)
                    </Label>
                    <Input
                      id={`${slot}-pw`}
                      type="password"
                      autoComplete="new-password"
                      value={acct.password ?? ""}
                      placeholder="Leave blank to type it at sign-in"
                      onChange={(e) => update(slot, { password: e.target.value })}
                      className="min-h-[44px] lg:min-h-0"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      saveAccounts(accounts);
                      toast.success(`${label} saved`);
                    }}
                  >
                    <Save className="mr-2 h-4 w-4" /> Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void switchTo(slot)}
                    disabled={busy !== null || !acct.email || isCurrent}
                  >
                    {busy === slot ? "Switching…" : `Switch to ${label}`}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={() => void signOutOnly()}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
