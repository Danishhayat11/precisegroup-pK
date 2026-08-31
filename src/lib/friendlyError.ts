import { toast } from "sonner";

/**
 * Map common API/network failures to plain, user-facing messages.
 *
 * Returns `{ title, detail }`:
 *  - `title` is a short, always-safe message to show as the primary line
 *    (toast title, banner heading).
 *  - `detail` is the raw error text — pass it as toast description or in a
 *    "Show details" section so power users / support still see the real error.
 *
 * Recognises:
 *  - Fetch/network failures (offline, DNS, CORS pre-flight, timeout)
 *  - Supabase PostgREST error codes (duplicate, FK, RLS, not-found)
 *  - Supabase Auth common errors (invalid credentials, rate-limit, email-taken)
 *  - HTTP status hints in the message (401/403/404/408/409/422/429/5xx)
 */

export type FriendlyError = { title: string; detail: string; transient: boolean };

type AnyErr =
  | { message?: unknown; status?: unknown; code?: unknown; name?: unknown; details?: unknown }
  | string
  | null
  | undefined;

const rawMessage = (e: AnyErr): string => {
  if (!e) return "";
  if (typeof e === "string") return e;
  if (typeof e.message === "string") return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
};

const pick = (e: AnyErr) => {
  if (!e || typeof e === "string")
    return { status: undefined, code: undefined, details: undefined };
  const status = typeof e.status === "number" ? e.status : undefined;
  const code = typeof e.code === "string" ? e.code : undefined;
  const details = typeof e.details === "string" ? e.details : undefined;
  return { status, code, details };
};

// Humanise a snake_case / kebab-case column name for user-facing copy.
// "unit_price" → "unit price", "SIZE_SQFT" → "size sqft".
const humaniseField = (raw: string): string =>
  raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

// Postgres unique-violation messages include one of:
//   Key (email)=(x@y.com) already exists.
//   duplicate key value violates unique constraint "profiles_email_key"
// Extract the offending column when possible so we can name it in the toast.
const extractUniqueField = (detail: string): string | null => {
  const keyMatch = detail.match(/Key \(([^)]+)\)=/i);
  if (keyMatch) return humaniseField(keyMatch[1].split(",")[0]);
  const cxMatch = detail.match(/unique constraint "([^"]+)"/i);
  if (cxMatch) {
    // Common Postgres naming: <table>_<column>_key / <table>_<column>_unique.
    const stripped = cxMatch[1].replace(/_(key|unique|uniq|idx)$/i, "");
    const parts = stripped.split("_");
    if (parts.length >= 2) return humaniseField(parts.slice(1).join("_"));
  }
  return null;
};

// 23502 (not-null) messages: `null value in column "phone" of relation "..."`.
const extractNullField = (detail: string): string | null => {
  const m = detail.match(/null value in column "([^"]+)"/i);
  return m ? humaniseField(m[1]) : null;
};

// 22001 (string too long): `value too long for type character varying(N)`.
const extractMaxLength = (detail: string): number | null => {
  const m = detail.match(/character varying\((\d+)\)/i);
  return m ? Number(m[1]) : null;
};

export function friendlyError(e: AnyErr, fallback = "Something went wrong"): FriendlyError {
  const detail = rawMessage(e) || fallback;
  const low = detail.toLowerCase();
  const { status, code, details } = pick(e);
  // Some Postgres details live on `error.details`, some inline in `message`.
  // Search both so field extraction works either way.
  const searchable = `${detail}\n${details ?? ""}`;

  // ---- Network / transport (transient — safe to retry) -------------------
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      title: "You appear to be offline — check your connection and try again.",
      detail,
      transient: true,
    };
  }
  if (
    low.includes("failed to fetch") ||
    low.includes("networkerror") ||
    low.includes("network request failed") ||
    low.includes("load failed") ||
    (e && typeof e !== "string" && e.name === "TypeError" && low.includes("fetch"))
  ) {
    return {
      title: "Can't reach the server — check your connection and try again.",
      detail,
      transient: true,
    };
  }
  if (low.includes("aborted") || low.includes("timeout") || status === 408 || code === "57014") {
    return { title: "The request timed out. Please try again.", detail, transient: true };
  }

  // ---- Postgres transient errors (retriable) -----------------------------
  // 40001 serialization_failure, 40P01 deadlock_detected, 53300 too_many_connections,
  // 08006 connection_failure, 08003 connection_does_not_exist.
  if (code === "40001" || code === "40P01" || low.includes("deadlock detected")) {
    return { title: "The system is busy — please try again.", detail, transient: true };
  }
  if (code === "53300" || low.includes("too many connections")) {
    return {
      title: "The service is under heavy load. Please try again in a moment.",
      detail,
      transient: true,
    };
  }
  if (code === "08006" || code === "08003" || low.includes("connection failure")) {
    return { title: "Lost connection to the server. Please try again.", detail, transient: true };
  }

  // ---- Custom RAISE from triggers/RPC (must come before 23505/22P02) -----
  // P0001 is plpgsql RAISE — the MESSAGE is already user-facing (we author
  // it), so surface it verbatim. Checked before the constraint/type branches
  // because a message like "Company already exists…" would otherwise match
  // the generic "already exists" substring in the 23505 branch.
  if (code === "P0001") {
    return { title: detail, detail, transient: false };
  }

  // ---- Integrity / constraint violations ---------------------------------
  if (code === "23505" || low.includes("duplicate key") || low.includes("already exists")) {
    const field = extractUniqueField(searchable);
    return {
      title: field
        ? `That ${field} is already in use — please choose a different one.`
        : "That record already exists. Use a different value or edit the existing one.",
      detail,
      transient: false,
    };
  }
  if (code === "23503" || low.includes("foreign key")) {
    // Direction of the FK matters: violating on insert = referenced row missing;
    // violating on delete = dependent rows still exist. Message hints at which.
    if (low.includes("still referenced") || low.includes("update or delete")) {
      return {
        title:
          "Can't remove this — other records still depend on it. Delete or reassign those first.",
        detail,
        transient: false,
      };
    }
    return {
      title: "A related record is missing. Pick an existing option and try again.",
      detail,
      transient: false,
    };
  }
  if (code === "23P01" || low.includes("exclusion constraint") || low.includes("conflicting key")) {
    return {
      title: "That conflicts with another record — please adjust and try again.",
      detail,
      transient: false,
    };
  }
  if (code === "23514" || low.includes("check constraint")) {
    return {
      title: "One of the values isn't allowed here. Please review and try again.",
      detail,
      transient: false,
    };
  }
  if (code === "23502" || low.includes("null value in column") || low.includes("not-null")) {
    const field = extractNullField(searchable);
    return {
      title: field
        ? `${field.charAt(0).toUpperCase()}${field.slice(1)} is required.`
        : "A required field is missing.",
      detail,
      transient: false,
    };
  }

  // ---- Data type / range / format ----------------------------------------
  // Specific type codes (22007/22008 date, 22001 length, 22003 range, 22012
  // div-by-zero) MUST come before the generic 22P02 "invalid input syntax"
  // fallback, or a date-typed message would match the generic branch first.
  if (
    code === "22007" ||
    code === "22008" ||
    low.includes("invalid date") ||
    low.includes("date/time field") ||
    (code === "22P02" && low.includes("type date"))
  ) {
    return {
      title: "That date isn't valid. Please check the format and try again.",
      detail,
      transient: false,
    };
  }
  if (code === "22001" || low.includes("value too long")) {
    const max = extractMaxLength(searchable);
    return {
      title: max
        ? `One of the values is too long (max ${max} characters).`
        : "One of the values is too long. Please shorten it.",
      detail,
      transient: false,
    };
  }
  if (code === "22003" || low.includes("out of range") || low.includes("numeric field overflow")) {
    return { title: "That number is out of the allowed range.", detail, transient: false };
  }
  if (code === "22012" || low.includes("division by zero")) {
    return { title: "That calculation isn't valid (division by zero).", detail, transient: false };
  }
  if (code === "22P02" || low.includes("invalid input syntax")) {
    if (low.includes("uuid")) {
      return {
        title: "That ID doesn't look right. Please pick from the list.",
        detail,
        transient: false,
      };
    }
    if (low.includes("integer") || low.includes("numeric") || low.includes("double precision")) {
      return { title: "That value must be a number.", detail, transient: false };
    }
    if (low.includes("boolean")) {
      return { title: "That value must be true or false.", detail, transient: false };
    }
    return {
      title: "One of the values is in the wrong format. Please review and try again.",
      detail,
      transient: false,
    };
  }

  // ---- PostgREST framing errors ------------------------------------------
  if (code === "PGRST116" || low.includes("no rows")) {
    return {
      title: "That record wasn't found. It may have been removed.",
      detail,
      transient: false,
    };
  }
  if (code === "PGRST200" || low.includes("could not find a relationship")) {
    return {
      title: "Couldn't load related data. Please refresh and try again.",
      detail,
      transient: false,
    };
  }
  if (code === "PGRST202" || low.includes("could not find the function")) {
    return {
      title: "That action isn't available right now. Please refresh the page.",
      detail,
      transient: false,
    };
  }
  if (code === "PGRST301" || low.includes("jwt expired")) {
    return { title: "Your session expired. Please sign in again.", detail, transient: false };
  }
  if (code?.startsWith("PGRST10") || low.includes("parse error")) {
    return {
      title: "The request couldn't be processed. Please refresh and try again.",
      detail,
      transient: false,
    };
  }
  if (
    code === "42501" ||
    low.includes("permission denied") ||
    low.includes("rls") ||
    low.includes("row-level security")
  ) {
    return { title: "You don't have permission to do that.", detail, transient: false };
  }
  if (code === "42P01" || low.includes("does not exist")) {
    // 42P01 = undefined_table; 42703 = undefined_column; both usually schema drift.
    return {
      title: "This feature is temporarily unavailable. Please refresh the page.",
      detail,
      transient: false,
    };
  }

  // ---- Supabase Auth ------------------------------------------------------
  if (low.includes("invalid login") || low.includes("invalid credentials")) {
    return { title: "Email or password is incorrect.", detail, transient: false };
  }
  if (low.includes("email not confirmed")) {
    return {
      title: "Please confirm your email first — check your inbox.",
      detail,
      transient: false,
    };
  }
  if (low.includes("user already registered") || low.includes("already been registered")) {
    return {
      title: "An account with that email already exists. Try signing in instead.",
      detail,
      transient: false,
    };
  }
  if (low.includes("password should be") || low.includes("weak password")) {
    return {
      title: "Password is too weak. Use at least 8 characters with a mix of letters and numbers.",
      detail,
      transient: false,
    };
  }

  // ---- HTTP status --------------------------------------------------------
  const statusFromMsg = (() => {
    const m = detail.match(/\b(4\d\d|5\d\d)\b/);
    return m ? Number(m[1]) : undefined;
  })();
  const s = status ?? statusFromMsg;
  if (s === 401)
    return { title: "You're signed out. Please sign in again.", detail, transient: false };
  if (s === 403)
    return { title: "You don't have permission to do that.", detail, transient: false };
  if (s === 404)
    return { title: "We couldn't find what you were looking for.", detail, transient: false };
  if (s === 409)
    return {
      title: "That conflicts with existing data. Please refresh and try again.",
      detail,
      transient: false,
    };
  if (s === 422)
    return {
      title: "Some of the information looks invalid. Please review and try again.",
      detail,
      transient: false,
    };
  if (s === 429)
    return {
      title: "Too many requests. Please wait a moment and try again.",
      detail,
      transient: true,
    };
  if (s && s >= 500 && s <= 599) {
    return {
      title: "The server had a problem. Please try again in a moment.",
      detail,
      transient: true,
    };
  }

  // ---- Fallback -----------------------------------------------------------
  return { title: fallback, detail, transient: false };
}

/**
 * Sonner-friendly helper: shows the plain message as the toast title and the
 * raw error as the description (only when it differs from the title).
 *
 * Pass `retry` to attach a "Retry" action button — it's only rendered when
 * the error is transient (offline, timeout, 429, 5xx, fetch failures) so we
 * never invite users to retry an operation that will keep failing (e.g. a
 * duplicate row or an auth error).
 *
 *   toastError(err, "Couldn't save project", { retry: () => saveProject() });
 */
export function toastError(
  e: AnyErr,
  fallback = "Something went wrong",
  opts?: { retry?: () => void },
): FriendlyError {
  const result = friendlyError(e, fallback);
  const { title, detail, transient } = result;
  const showRetry = transient && typeof opts?.retry === "function";
  toast.error(title, {
    ...(detail && detail !== title ? { description: detail } : {}),
    ...(showRetry ? { action: { label: "Retry", onClick: () => opts!.retry!() } } : {}),
  });
  return result;
}
