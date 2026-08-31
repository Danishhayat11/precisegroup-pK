import { Link } from "@/lib/router-compat";
import { Button } from "@/components/ui/button";
import { Building2, LayoutDashboard, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background relative isolate overflow-hidden p-6">
      {/* Subtle background grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.2]"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(80% 80% at 50% 50%, #000 30%, transparent 80%)",
        }}
      />
      {/* Subtle ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full blur-3xl opacity-20"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--primary) 50%, transparent) 0%, transparent 70%)",
        }}
      />

      <div className="w-full max-w-[460px] text-center relative z-10 flex flex-col items-center">
        {/* Brand crest */}
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-2xl text-primary-foreground shadow-md mb-6"
          style={{
            backgroundColor: "var(--primary)",
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--primary) 85%, #fff 15%) 0%, var(--primary) 100%)",
          }}
        >
          <Building2 className="w-7 h-7" aria-hidden="true" />
        </div>

        {/* 404 Headline */}
        <span className="text-[12px] font-bold tracking-widest uppercase text-primary px-3 py-1 rounded-full bg-primary/10 mb-3 border border-primary/20">
          Page Not Found
        </span>
        <h1 className="text-6xl sm:text-7xl font-extrabold tracking-tight text-foreground font-display mb-3">
          404
        </h1>
        <p className="text-base text-muted-foreground max-w-sm mx-auto mb-8 leading-relaxed">
          The requested page could not be located on the Precise ERP network or may have moved.
        </p>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-xs">
          <Button
            asChild
            className="w-full min-h-11 rounded-xl font-semibold shadow-sm text-[13.5px]"
            style={{
              backgroundColor: "var(--primary)",
              background:
                "linear-gradient(180deg, color-mix(in oklab, var(--primary) 90%, #fff 10%) 0%, var(--primary) 100%)",
            }}
          >
            <Link to="/dashboard" className="inline-flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4" />
              Return to Dashboard
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            className="w-full min-h-11 rounded-xl font-medium border-border/80 text-[13.5px] bg-card hover:bg-muted/50"
          >
            <Link to="/site" className="inline-flex items-center gap-2">
              <Home className="h-4 w-4" />
              Marketing Website
            </Link>
          </Button>
        </div>

        {/* Footer info */}
        <p className="mt-12 text-[11px] text-muted-foreground/70">
          Precise Realtors &amp; Builders · Enterprise Resource Platform
        </p>
      </div>
    </div>
  );
}
