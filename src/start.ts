import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { tenantScopeLogger } from "@/lib/tenantScopeLogger";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    // Don't swallow "Unauthorized" errors into the generic 500 error page.
    // TanStack Start needs to see the error to trigger client-side auth redirects
    // or handle the failure gracefully in the component boundary.
    if (error instanceof Error && error.message === "Unauthorized") {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, tenantScopeLogger],
  requestMiddleware: [errorMiddleware],
}));
