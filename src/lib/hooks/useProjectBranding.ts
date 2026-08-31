import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DocumentBranding } from "@/components/documents/DocumentChrome";

/**
 * Loads per-project branding with fallback to the company row.
 * If no project row exists, we synthesise a DocumentBranding from company info.
 */
export function useProjectBranding(
  projectCode: string | undefined,
  projectName: string | undefined,
) {
  return useQuery<DocumentBranding>({
    queryKey: ["project-branding", projectCode],
    enabled: !!projectCode,
    queryFn: async () => {
      const [pdb, comp] = await Promise.all([
        supabase
          .from("project_document_branding" as any)
          .select("*")
          .eq("project_code", projectCode!)
          .maybeSingle(),
        supabase.from("companies").select("*").maybeSingle(),
      ]);
      const row: any = pdb.data ?? null;
      const c: any = comp.data ?? {};
      return {
        projectDisplayName: row?.project_display_name || projectName || c.name || "PROJECT",
        tagline: row?.tagline ?? "Crafting Landmarks  |  Creating Trust",
        legalEntity: row?.legal_entity ?? c.name ?? null,
        ntn: row?.ntn ?? null,
        cui: row?.cui ?? null,
        headerLogoUrl: row?.header_logo_url ?? c.logo_url ?? null,
        addressLine: row?.address_line ?? [c.address, c.city].filter(Boolean).join(", ") ?? null,
        phoneStrip: row?.phone_strip ?? c.phone ?? null,
        email: row?.email ?? c.email ?? null,
        website: row?.website ?? null,
        footerNote: row?.footer_note ?? null,
        accentToken: row?.accent_token ?? "primary",
      };
    },
  });
}
