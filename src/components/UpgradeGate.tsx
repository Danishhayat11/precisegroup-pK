import { Lock, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PLAN_LABEL,
  UPGRADE_WHATSAPP,
  buildUpgradeWhatsappLink,
  type FeatureMeta,
  type Plan,
} from "@/lib/plans";
import { useAuth } from "@/lib/auth";

/**
 * Full-screen upgrade card shown in place of a route the current plan can't
 * access. Used by <PlanGate /> in AppShell.
 *
 * The WhatsApp CTA is built with `buildUpgradeWhatsappLink()` so the
 * prefilled message body always names the exact feature the user tried
 * to open plus their current plan — no more generic "hi I want to
 * upgrade" messages that force us to ask which page they were on.
 */
export function UpgradeScreen({ feature }: { feature: FeatureMeta }) {
  const requiredPlan = PLAN_LABEL[feature.minPlan];
  const { plan, companyName } = useAuth();
  const href = buildUpgradeWhatsappLink(feature, {
    currentPlan: plan,
    companyName: companyName ?? null,
  });
  return (
    <div className="min-h-[70vh] grid place-items-center px-4">
      <Card className="max-w-lg w-full p-8 text-center space-y-5">
        <div
          className="mx-auto grid place-items-center h-14 w-14 rounded-2xl bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Lock className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            This feature requires {requiredPlan} plan
          </h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{feature.label}</span> —{" "}
            {feature.description}
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-border p-4 text-left space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Upgrade manually
          </div>
          <p className="text-sm text-muted-foreground">
            Message us on WhatsApp and we'll activate {requiredPlan} for your workspace — usually
            within a few hours.
          </p>
        </div>
        <Button asChild size="lg" className="w-full min-h-11">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Contact us on WhatsApp to upgrade to ${requiredPlan} for ${feature.label}`}
          >
            <MessageCircle className="h-4 w-4 mr-2" />
            Contact us to upgrade — WhatsApp: {UPGRADE_WHATSAPP}
          </a>
        </Button>
      </Card>
    </div>
  );
}

/**
 * Dialog variant — used when the app wants to gate an in-page action
 * (e.g. a "New booking" button) instead of a whole route.
 */
export function UpgradeDialog({
  open,
  onOpenChange,
  feature,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  feature: FeatureMeta;
}) {
  const requiredPlan = PLAN_LABEL[feature.minPlan];
  const { plan, companyName } = useAuth();
  const href = buildUpgradeWhatsappLink(feature, {
    currentPlan: plan,
    companyName: companyName ?? null,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>This feature requires {requiredPlan} plan</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{feature.label}</span>
            {" — "}
            {feature.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button asChild size="lg" className="min-h-11 w-full">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Contact us on WhatsApp to upgrade to ${requiredPlan} for ${feature.label}`}
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Contact us — WhatsApp: {UPGRADE_WHATSAPP}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small pill badge for the current plan — sidebar footer, admin screens. */
export function PlanBadge({
  plan,
  className,
}: {
  plan: Plan | null | undefined;
  className?: string;
}) {
  if (!plan) return null;
  const label = PLAN_LABEL[plan];
  const tone =
    plan === "builder"
      ? "bg-primary/15 text-primary border-primary/30"
      : plan === "professional"
        ? "bg-info/15 text-info border-info/30"
        : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
        tone +
        (className ? " " + className : "")
      }
    >
      <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
      {label}
    </span>
  );
}
