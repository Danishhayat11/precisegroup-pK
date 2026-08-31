import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CompanyInfo {
  id: string | null;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
}

const FALLBACK: CompanyInfo = {
  id: null,
  name: "Precise Realtors & Builders (Pvt.) Ltd.",
  address: null,
  city: null,
  phone: null,
  email: null,
  logo_url: null,
};

export function useCompany() {
  const q = useQuery({
    queryKey: ["active-company"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CompanyInfo> => {
      const { data } = await supabase
        .from("companies")
        .select("id,name,address,city,phone,email,logo_url")
        .limit(1)
        .maybeSingle();
      if (!data) return FALLBACK;
      return {
        id: data.id ?? null,
        name: data.name || FALLBACK.name,
        address: data.address ?? null,
        city: data.city ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        logo_url: data.logo_url ?? null,
      };
    },
  });
  return q.data ?? FALLBACK;
}
