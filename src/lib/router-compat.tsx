/**
 * Compatibility shim mapping the small subset of react-router-dom APIs the
 * legacy pages use onto TanStack Router. Keeps the port mechanical.
 */
import * as React from "react";
import {
  Link as TanstackLink,
  Navigate as TanstackNavigate,
  useLocation as useTanstackLocation,
  useNavigate as useTanstackNavigate,
  useParams as useTanstackParams,
} from "@tanstack/react-router";

type AnyProps = Record<string, any>;

/** Drop-in for react-router's Link. Accepts a plain path string. */
export const Link = React.forwardRef<HTMLAnchorElement, AnyProps>((props, ref) => {
  const { to, replace, state: _state, ...rest } = props;
  return <TanstackLink ref={ref} to={to as any} replace={replace} {...rest} />;
});
Link.displayName = "Link";

/**
 * Drop-in for react-router's NavLink.
 *
 * Supports `end`, a plain string `className`, and separate
 * `activeClassName` / `inactiveClassName` string props. We deliberately
 * do NOT accept a function-typed `className` — the dev-only source
 * tagger stringifies function-valued JSX props into the DOM `class`
 * attribute, which corrupts the render. Callers that need active-state
 * styling MUST use the two string props instead.
 */
export const NavLink = React.forwardRef<HTMLAnchorElement, AnyProps>((props, ref) => {
  const { to, end, className, activeClassName, inactiveClassName, children, ...rest } = props;
  const active = activeClassName ?? className;
  const inactive = inactiveClassName ?? className;
  return (
    <TanstackLink
      ref={ref}
      to={to as any}
      activeOptions={end ? { exact: true } : undefined}
      activeProps={{ "aria-current": "page", className: active }}
      inactiveProps={{ className: inactive }}
      {...rest}
    >
      {typeof children === "function"
        ? ((({ isActive }: { isActive: boolean }) =>
            children({ isActive, isPending: false })) as any)
        : children}
    </TanstackLink>
  );
});
NavLink.displayName = "NavLink";

/** Drop-in Navigate component. */
export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  return <TanstackNavigate to={to as any} replace={replace} />;
}

/** Drop-in useLocation that mirrors react-router's shape closely enough. */
export function useLocation() {
  const loc = useTanstackLocation();
  return {
    pathname: loc.pathname,
    search: loc.searchStr ?? "",
    hash: loc.hash ?? "",
    state: (loc.state as any) ?? null,
  };
}

/** Drop-in useNavigate: returns a function called as navigate("/path", { replace }). */
export function useNavigate() {
  const nav = useTanstackNavigate();
  return (to: string | number, opts?: { replace?: boolean; state?: unknown }) => {
    if (typeof to === "number") {
      if (typeof window !== "undefined") window.history.go(to);
      return;
    }
    // Split path/search/hash so TanStack receives them correctly.
    const url = new URL(to, "http://_");
    nav({
      to: (url.pathname || "/") as any,
      search: url.search ? (Object.fromEntries(new URLSearchParams(url.search)) as any) : undefined,
      hash: url.hash ? url.hash.replace(/^#/, "") : undefined,
      replace: opts?.replace,
    });
  };
}

/** Drop-in useParams. Returns string-keyed params from the matched route. */
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  // `strict: false` is valid at runtime for the loose overload, but the
  // generated router types (via `Register`) narrow the options object to a
  // per-route shape and no longer accept it as a bare object. Cast the
  // options through `unknown` so the loose overload is selected at the call
  // site without losing the typed return elsewhere in the app.
  return useTanstackParams({ strict: false } as unknown as Parameters<
    typeof useTanstackParams
  >[0]) as T;
}

type SearchInit =
  | URLSearchParams
  | Record<string, string>
  | ((p: URLSearchParams) => URLSearchParams | Record<string, string>);

/** Drop-in useSearchParams. Returns [URLSearchParams, setter]. */
export function useSearchParams(): [URLSearchParams, (next: SearchInit) => void] {
  const loc = useTanstackLocation();
  const nav = useTanstackNavigate();
  const sp = new URLSearchParams((loc.searchStr ?? "").replace(/^\?/, ""));
  const setter = (next: SearchInit) => {
    const resolved = typeof next === "function" ? next(new URLSearchParams(sp)) : next;
    const entries = resolved instanceof URLSearchParams ? Object.fromEntries(resolved) : resolved;
    nav({
      to: loc.pathname as any,
      search: entries as any,
    });
  };
  return [sp, setter];
}

/** Drop-in Outlet re-export for AppShell. */
export { Outlet } from "@tanstack/react-router";
