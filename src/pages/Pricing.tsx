import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { PricingSection } from "@/components/pricing/PricingSection";

export default function PricingPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <PricingSection
        onSelect={(tierId, period) => {
          if (tierId === "enterprise") {
            navigate({ to: "/site/contact" });
            return;
          }
          toast.success(`Selected ${tierId} (${period}) — contact billing to activate.`);
        }}
      />
    </div>
  );
}
