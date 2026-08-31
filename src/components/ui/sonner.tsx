import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useEffect, useState } from "react";

/** Tracks `prefers-reduced-motion: reduce`. SSR-safe. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    if (mq.addEventListener) {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);
  return reduced;
}

/** Responsive toast position: top-center on phones, top-right on tablets+. */
function useToastPosition(): ToasterProps["position"] {
  const [pos, setPos] = useState<ToasterProps["position"]>("top-right");
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setPos(mq.matches ? "top-right" : "top-center");
    update();
    if (mq.addEventListener) {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);
  return pos;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const reducedMotion = usePrefersReducedMotion();
  const position = useToastPosition();
  return (
    <Sonner
      className="toaster group"
      position={position}
      richColors
      closeButton
      data-reduced-motion={reducedMotion ? "true" : undefined}
      // 3s spec; reduced-motion viewers get extra dwell to compensate for
      // the removed slide-in animation (see styles.css).
      duration={reducedMotion ? 8000 : (props.duration ?? 3000)}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card/85 group-[.toaster]:backdrop-blur-2xl group-[.toaster]:text-foreground group-[.toaster]:border-border/60 group-[.toaster]:shadow-[0_20px_40px_-12px_rgba(0,0,0,0.18)] group-[.toaster]:rounded-2xl group-[.toaster]:p-4 group-[.toaster]:border-l-4",
          description: "group-[.toast]:text-muted-foreground text-xs",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-full group-[.toast]:font-medium",
          cancelButton: "group-[.toast]:bg-muted/80 group-[.toast]:text-muted-foreground group-[.toast]:rounded-full",
          success: "group-[.toaster]:!border-l-emerald-500",
          error: "group-[.toaster]:!border-l-red-500",
          warning: "group-[.toaster]:!border-l-amber-500",
          info: "group-[.toaster]:!border-l-blue-500",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
