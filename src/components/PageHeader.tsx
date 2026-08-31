import { ReactNode } from "react";

/**
 * PageHeader — the canonical top-of-page header used by app screens.
 *
 * Uses the semantic <h1> tag (typography scale is defined globally in
 * src/styles.css under @layer base) and the `.lead` utility for the
 * subtitle, so every page inherits the same fluid clamp-based hierarchy.
 * Do not add `text-*` / `font-*` overrides here — that would fork the
 * design system.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div className="stack-tight">
        <h1>{title}</h1>
        {description && <p className="lead">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
