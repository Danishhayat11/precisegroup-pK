import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import preciseColor from "./eslint-rules/no-raw-color.js";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/exhaustive-deps": "warn",
      "no-control-regex": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "prefer-const": "off",
      "react-hooks/rules-of-hooks": "off",
    },
  },

  // ───────────────────────────────────────────────────────────────
  // Protected surfaces: enforce `precise/no-raw-color`.
  //
  // Scope mirrors scripts/ci/no-hex-in-marketing-shell.mjs exactly so the
  // editor rule and the CI guardrail flag the same code.
  //   Included:
  //     - src/routes/site*.tsx                    (marketing routes)
  //     - src/components/site/**                  (marketing components)
  //     - src/components/*Chrome*.tsx             (any chrome component)
  //     - src/components/AppShell*.{ts,tsx}       (app shell)
  //     - src/routes/_authenticated/**            (auth-gated routes)
  //     - src/pages/**                            (dashboard/admin pages)
  //   Allowlisted (skipped via the next `ignores` block):
  //     - Print / letterhead rendering surfaces
  //     - Error / not-found surfaces
  //     - Dashboard hero photography backdrop
  //     - Test files
  // ───────────────────────────────────────────────────────────────
  {
    files: [
      "src/routes/site*.{ts,tsx}",
      "src/components/site/**/*.{ts,tsx}",
      "src/components/*Chrome*.{ts,tsx}",
      "src/components/AppShell*.{ts,tsx}",
      "src/routes/_authenticated/**/*.{ts,tsx}",
      "src/pages/**/*.{ts,tsx}",
    ],
    ignores: [
      // Print / letterhead — raw print CSS colors are the point
      "src/pages/DocumentView.tsx",
      "src/components/print/**",
      "src/components/PrintPreviewModal.tsx",
      "src/components/PaymentReceipt.tsx",
      "src/components/PaymentHistoryDoc.tsx",
      "src/components/BookingDocumentEditor.tsx",
      "src/lib/letterhead.tsx",
      // Error surfaces
      "src/pages/NotFound.tsx",
      "src/components/DashboardErrorBoundary.tsx",
      // Dashboard hero photography
      "src/components/DashboardHero.tsx",
      // Tests
      "**/__tests__/**",
      "**/*.test.{ts,tsx}",
    ],
    plugins: { precise: preciseColor },
    rules: {
      "precise/no-raw-color": "error",
    },
  },

  // ───────────────────────────────────────────────────────────────
  // Client-side `supabase.rpc(...)` ban.
  //
  // All client-side RPC calls MUST route through `callRpc` from
  // `@/integrations/supabase/approvedRpc` so the runtime allowlist,
  // revoked-mapping layer, and audit logging apply. Server-function
  // handlers use `callServerRpc` and are covered by the separate CI
  // guard in `scripts/check-rpc-allowlist.mjs`.
  // ───────────────────────────────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      // The wrappers themselves must call the raw client.
      "src/integrations/supabase/approvedRpc.ts",
      "src/integrations/supabase/serverRpc.ts",
      // Server-function handlers — enforced by callServerRpc guard instead.
      "src/**/*.functions.ts",
      "src/**/*.functions.tsx",
      "src/**/*.server.ts",
      "src/**/*.server.tsx",
      // Tests may assert on the raw client behavior.
      "**/__tests__/**",
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='rpc'][callee.object.name='supabase']",
          message:
            "Do not call `supabase.rpc(...)` directly from client-side code. Import { callRpc } from '@/integrations/supabase/approvedRpc' and route the call through it so the approved-RPC allowlist is enforced.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='rpc'][callee.object.type='MemberExpression'][callee.object.property.name='supabase']",
          message:
            "Do not call `<obj>.supabase.rpc(...)` directly from client-side code. Route the call through `callRpc` (client) or `callServerRpc` (server functions) so the approved-RPC allowlist is enforced.",
        },
      ],
    },
  },

  eslintPluginPrettier,
);
