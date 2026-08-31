import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, XCircle, Mail, LogOut, RefreshCw } from "lucide-react";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/pending-approval")({
  ssr: false,
  component: PendingApprovalPage,
  errorComponent: makeRouteErrorComponent("Pending Approval"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Pending Approval",
    backTo: "/",
  }),
});

function PendingApprovalPage() {
  const {
    companyName,
    approvalStatus,
    isCompanyActive,
    rejectionReason,
    signOut,
    refreshCompany,
    companyLoading,
  } = useAuth();

  const rejected = approvalStatus === "rejected";
  const deactivated = approvalStatus === "approved" && !isCompanyActive;

  return (
    <div className="grid min-h-[70dvh] place-items-center px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              {rejected ? <XCircle className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg">
                {rejected
                  ? "Your registration was rejected"
                  : deactivated
                    ? "Your workspace has been deactivated"
                    : "Waiting for admin approval"}
              </CardTitle>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {companyName && (
                  <Badge variant="outline" className="max-w-full truncate">
                    {companyName}
                  </Badge>
                )}
                <Badge
                  className={
                    rejected
                      ? "bg-destructive text-destructive-foreground"
                      : deactivated
                        ? "bg-muted text-muted-foreground"
                        : "bg-warning text-warning-foreground"
                  }
                >
                  {rejected ? "Rejected" : deactivated ? "Inactive" : "Pending review"}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {rejected ? (
            <>
              <p className="text-sm text-muted-foreground">
                A Super Admin reviewed your company registration and could not approve it at this
                time.
              </p>
              {rejectionReason && (
                <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <div className="font-medium text-destructive">Reason</div>
                  <div className="mt-1 text-foreground">{rejectionReason}</div>
                </div>
              )}
            </>
          ) : deactivated ? (
            <p className="text-sm text-muted-foreground">
              Your company workspace is currently deactivated. Please contact support to have it
              reactivated.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Your company registration has been received. A Super Admin will review and approve
                it shortly. You'll be able to sign in and set up your workspace as soon as it's
                approved.
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>Reviews typically complete within one business day.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>You can safely sign out and come back later — nothing to do here.</span>
                </li>
              </ul>
            </>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant="outline"
              className="min-h-11 min-w-11"
              onClick={() => void refreshCompany()}
              disabled={companyLoading}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${companyLoading ? "animate-spin" : ""}`} />
              Check again
            </Button>
            <Button
              variant="secondary"
              className="min-h-11 min-w-11"
              onClick={() => void signOut()}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
