/**
 * Dev-only Supabase mock.
 *
 * Enabled only when `import.meta.env.VITE_SUPABASE_MOCK === "1"` AND
 * `import.meta.env.DEV` is true. In every other build this module is a no-op
 * and the interceptor is never installed.
 *
 * What it does (browser only):
 *  - Stubs `*.supabase.co/auth/v1/user` and `.../token?...` so the
 *    `_authenticated` gate can hydrate a fake session with no network egress.
 *  - Returns empty `[]` for `*.supabase.co/rest/v1/*` reads so any incidental
 *    PostgREST call resolves cleanly.
 *  - Returns deterministic mock rows for the two report server functions
 *    (`listOverdueInstallments`, `listPaymentCollections`) at the TanStack
 *    `/_serverFn/*` URL, matched by function name.
 *
 * Anything that doesn't match falls through to the real fetch.
 */

const MOCK_USER = {
  id: "00000000-0000-0000-0000-0000000000aa",
  aud: "authenticated",
  role: "authenticated",
  email: "dev-mock@example.test",
  email_confirmed_at: new Date(0).toISOString(),
  phone: "",
  confirmed_at: new Date(0).toISOString(),
  last_sign_in_at: new Date(0).toISOString(),
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { name: "Dev Mock" },
  identities: [],
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

const MOCK_SESSION = {
  access_token: "dev-mock-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "dev-mock-refresh-token",
  user: MOCK_USER,
};

const MOCK_OVERDUE = [
  {
    ledger_id: "mock-overdue-1",
    booking_id: "mock-booking-1",
    client_name: "Ali Raza (mock)",
    project: "Precise Heights",
    unit_no: "A-101",
    term_no: 3,
    due_date: "2025-05-01",
    due_amount: 250000,
    paid_amount: 0,
    days_overdue: 76,
    status: "overdue",
  },
  {
    ledger_id: "mock-overdue-2",
    booking_id: "mock-booking-2",
    client_name: "Sara Khan (mock)",
    project: "Precise Gardens",
    unit_no: "B-204",
    term_no: 5,
    due_date: "2025-06-15",
    due_amount: 180000,
    paid_amount: 50000,
    days_overdue: 31,
    status: "partial",
  },
];

const MOCK_PAYMENTS = [
  {
    receipt_no: "MOCK-0001",
    payment_date: "2025-07-10",
    client_name: "Ali Raza (mock)",
    project: "Precise Heights",
    unit_no: "A-101",
    payment_head: "Installment",
    payment_mode: "Bank Transfer",
    amount: 250000,
    status: "cleared",
  },
  {
    receipt_no: "MOCK-0002",
    payment_date: "2025-07-12",
    client_name: "Sara Khan (mock)",
    project: "Precise Gardens",
    unit_no: "B-204",
    payment_head: "Booking",
    payment_mode: "Cheque",
    amount: 500000,
    status: "cleared",
  },
];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function isSupabaseHost(url: URL): boolean {
  return /\.supabase\.co$/i.test(url.hostname);
}

function mockMatch(input: RequestInfo | URL, init?: RequestInit): Response | null {
  let url: URL;
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }

  // Supabase Auth
  if (isSupabaseHost(url)) {
    if (url.pathname.endsWith("/auth/v1/user")) {
      return jsonResponse(MOCK_USER);
    }
    if (url.pathname.endsWith("/auth/v1/token")) {
      return jsonResponse(MOCK_SESSION);
    }
    if (url.pathname.endsWith("/auth/v1/logout")) {
      return new Response(null, { status: 204 });
    }
    if (url.pathname.includes("/rest/v1/")) {
      // Any incidental PostgREST call gets an empty list.
      return jsonResponse([]);
    }
    // Anything else on supabase.co: harmless empty ok.
    return jsonResponse({});
  }

  // TanStack server functions — match by function name in URL.
  // The runtime encodes the fn id in either the path or the `_serverFnId`
  // search param depending on version; check both.
  const serverFnKey =
    url.pathname.startsWith("/_serverFn") || url.searchParams.has("_serverFnId")
      ? `${url.pathname}?${url.searchParams.toString()}`
      : null;
  if (serverFnKey) {
    if (serverFnKey.includes("listOverdueInstallments")) {
      return jsonResponse({ result: MOCK_OVERDUE });
    }
    if (serverFnKey.includes("listPaymentCollections")) {
      return jsonResponse({ result: MOCK_PAYMENTS });
    }
  }

  // POST body may also carry the fn id when it isn't in the URL.
  if (url.pathname.startsWith("/_serverFn") && typeof init?.body === "string") {
    if (init.body.includes("listOverdueInstallments")) {
      return jsonResponse({ result: MOCK_OVERDUE });
    }
    if (init.body.includes("listPaymentCollections")) {
      return jsonResponse({ result: MOCK_PAYMENTS });
    }
  }

  return null;
}

let installed = false;

export function installSupabaseMockIfEnabled(): void {
  if (typeof window === "undefined") return;
  if (installed) return;
  if (!import.meta.env.DEV) return;
  if (import.meta.env.VITE_SUPABASE_MOCK !== "1") return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      const mocked = mockMatch(input as RequestInfo | URL, init);
      if (mocked) {
        console.debug("[supabase-mock] intercepted", input);
        return mocked;
      }
    } catch (err) {
      // Fall through to real fetch on any matcher error.

      console.warn("[supabase-mock] matcher error, passing through", err);
    }
    return originalFetch(input as RequestInfo, init);
  };

  installed = true;

  console.info("[supabase-mock] enabled (VITE_SUPABASE_MOCK=1). Reports render with mock data.");
}
