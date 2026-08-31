import type { CSSProperties, ReactNode } from "react";

/**
 * DocumentChrome — the shared A4 header + footer used by the Installment Plan,
 * Client Ledger and Payment Receipt. All content is driven by props (loaded
 * from project_document_branding with company fallbacks) so onboarding a new
 * project needs no code changes.
 */

export interface DocumentBranding {
  projectDisplayName: string;
  tagline?: string | null;
  legalEntity?: string | null;
  ntn?: string | null;
  cui?: string | null;
  headerLogoUrl?: string | null;
  addressLine?: string | null;
  phoneStrip?: string | null;
  email?: string | null;
  website?: string | null;
  footerNote?: string | null;
  accentToken?: string | null; // css variable name segment: 'primary' → var(--primary)
}

interface HeaderProps {
  branding: DocumentBranding;
  docTitle: string;
  docSubtitle?: string;
  copyLabel?: string; // e.g. "OFFICE COPY", "CLIENT COPY"
}

interface FooterProps {
  branding: DocumentBranding;
}

const accentVar = (accent: string | null | undefined): CSSProperties => ({
  // fall back to --primary if no override
  ["--doc-accent" as any]: `var(--${accent || "primary"})`,
});

export function DocumentHeader({ branding, docTitle, docSubtitle, copyLabel }: HeaderProps) {
  return (
    <div
      className="doc-header rounded-lg border border-[hsl(var(--doc-accent)/0.4)] bg-[hsl(var(--doc-accent)/0.06)] px-4 py-3 flex items-start justify-between gap-4"
      style={accentVar(branding.accentToken)}
    >
      <div className="min-w-0">
        <div className="text-2xl font-extrabold uppercase tracking-tight text-[hsl(var(--doc-accent))] leading-tight">
          {branding.projectDisplayName}
        </div>
        {branding.tagline ? (
          <div className="text-[11px] italic text-[hsl(var(--doc-accent)/0.85)] mt-0.5">
            {branding.tagline}
          </div>
        ) : null}
        {branding.legalEntity ? (
          <div className="text-[11px] font-semibold text-foreground/80 mt-0.5 uppercase tracking-wide">
            {branding.legalEntity}
          </div>
        ) : null}
      </div>
      <div className="text-right shrink-0">
        <div className="text-lg font-extrabold uppercase tracking-tight text-[hsl(var(--doc-accent))]">
          {docTitle}
        </div>
        {copyLabel ? (
          <div className="inline-block mt-1 px-2 py-0.5 rounded-md bg-[hsl(var(--doc-accent))] text-[hsl(var(--doc-accent-foreground,var(--primary-foreground)))] text-[10px] font-bold tracking-widest">
            {copyLabel}
          </div>
        ) : null}
        <div className="text-[10px] text-muted-foreground mt-1">
          {branding.ntn ? `NTN # ${branding.ntn}` : null}
          {branding.ntn && branding.cui ? "  |  " : null}
          {branding.cui ? `CUI # ${branding.cui}` : null}
        </div>
        {docSubtitle ? (
          <div className="text-[10px] text-muted-foreground">{docSubtitle}</div>
        ) : null}
      </div>
    </div>
  );
}

export function DocumentFooter({ branding }: FooterProps) {
  const contact = [branding.phoneStrip, branding.email, branding.website]
    .filter(Boolean)
    .join("  |  ");
  return (
    <div className="doc-footer mt-3 pt-2 border-t border-border/60 flex items-center justify-between text-[10px] text-muted-foreground">
      <div className="truncate">{branding.addressLine ?? ""}</div>
      <div className="truncate">{contact}</div>
    </div>
  );
}

export function DocumentSheet({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`doc-sheet mx-auto bg-background text-foreground ${className}`} style={style}>
      {children}
    </div>
  );
}
