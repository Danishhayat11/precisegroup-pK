import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Home, RefreshCw } from "lucide-react";
import { reportDashboardError } from "@/lib/dashboardDiagnostics";

interface Props {
  children: ReactNode;
  /**
   * Optional callback invoked when the user clicks Retry. Typically wired to
   * `queryClient.invalidateQueries({ queryKey: ["dashboard"] })` so Retry
   * re-runs the dashboard data fetch (and any queries derived from it)
   * instead of only clearing the boundary. If it returns a Promise, the
   * button stays in a pending state until it resolves.
   */
  onRetry?: () => void | Promise<void>;
  /**
   * Optional hook invoked from `componentDidCatch` with the caught error and
   * React's ErrorInfo. Use it to attach caller-specific context (e.g. route
   * label) to diagnostics. Runs BEFORE the default `reportDashboardError`.
   */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
  retrying: boolean;
}

export class DashboardErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retrying: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, retrying: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      this.props.onError?.(error, info);
    } catch {
      // Never let a logging hook break the boundary.
    }
    reportDashboardError("render_error", error, {
      componentStack: info.componentStack,
    });
  }

  private handleRetry = async () => {
    const { onRetry } = this.props;
    if (!onRetry) {
      this.setState({ error: null, retrying: false });
      return;
    }
    this.setState({ retrying: true });
    try {
      await onRetry();
    } catch (err) {
      reportDashboardError("render_error", err, { context: "retry_failed" });
    } finally {
      this.setState({ error: null, retrying: false });
    }
  };

  private handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  private handleGoBack = () => {
    if (typeof window === "undefined") return;
    // If there's real history to pop, go back; otherwise fall back to Home so
    // the user is never left staring at the same error page.
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.assign("/");
    }
  };

  private handleGoHome = () => {
    if (typeof window !== "undefined") window.location.assign("/");
  };

  render() {
    const { error, retrying } = this.state;
    if (!error) return this.props.children;

    const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="mx-auto my-8 max-w-2xl rounded-xl border border-destructive/30 bg-destructive/5 p-6 shadow-sm"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-foreground">The dashboard couldn't render</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Something went wrong while loading your data — but nothing has been changed or lost.
              You can pick up right where you left off.
            </p>

            <div className="mt-4 rounded-md border border-border/60 bg-background/60 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Try one of these
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-foreground">
                <li>
                  <span className="font-medium">Retry</span> — re-run the dashboard queries without
                  leaving the page.
                </li>
                <li>
                  <span className="font-medium">Go back</span> to the previous screen and try a
                  different action.
                </li>
                <li>
                  If it keeps happening, <span className="font-medium">reload</span> the page or
                  share the error details below with support.
                </li>
              </ol>
              {isOffline && (
                <p className="mt-2 text-xs font-medium text-destructive">
                  You appear to be offline — check your connection first.
                </p>
              )}
            </div>

            <details className="mt-3 group">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                Show technical details
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 text-xs text-muted-foreground">
                {error.message || String(error)}
              </pre>
            </details>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={this.handleRetry}
                disabled={retrying}
                aria-busy={retrying}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
                {retrying ? "Retrying…" : "Retry"}
              </button>
              <button
                type="button"
                onClick={this.handleGoBack}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Go back
              </button>
              <button
                type="button"
                onClick={this.handleGoHome}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <Home className="h-3.5 w-3.5" />
                Home
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
