import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  currentBookingId: string | null;
  setCurrentBookingId: (id: string | null) => void;
  currentBookingLabel: string | null;
  setCurrentBookingLabel: (label: string | null) => void;
  seedPrompt: string | null;
  pushPrompt: (text: string) => void;
  consumeSeedPrompt: () => string | null;
};

const AssistantCtx = createContext<Ctx | null>(null);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [currentBookingId, setCurrentBookingId] = useState<string | null>(null);
  const [currentBookingLabel, setCurrentBookingLabel] = useState<string | null>(null);
  const [seedPrompt, setSeedPrompt] = useState<string | null>(null);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  const pushPrompt = useCallback((text: string) => {
    setSeedPrompt(text);
    setOpen(true);
  }, []);

  const consumeSeedPrompt = useCallback(() => {
    const v = seedPrompt;
    setSeedPrompt(null);
    return v;
  }, [seedPrompt]);

  // Ctrl/Cmd + Shift + A
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      open,
      setOpen,
      toggle,
      currentBookingId,
      setCurrentBookingId,
      currentBookingLabel,
      setCurrentBookingLabel,
      seedPrompt,
      pushPrompt,
      consumeSeedPrompt,
    }),
    [
      open,
      toggle,
      currentBookingId,
      currentBookingLabel,
      seedPrompt,
      pushPrompt,
      consumeSeedPrompt,
    ],
  );

  return <AssistantCtx.Provider value={value}>{children}</AssistantCtx.Provider>;
}

export function useAssistant() {
  const ctx = useContext(AssistantCtx);
  if (!ctx) throw new Error("useAssistant must be used inside <AssistantProvider>");
  return ctx;
}

/**
 * Helper hook for booking pages — call inside an effect to set the active
 * booking context that Precise Assistant uses.
 */
export function useAssistantBookingContext(bookingId?: string | null, label?: string | null) {
  const { setCurrentBookingId, setCurrentBookingLabel } = useAssistant();
  useEffect(() => {
    setCurrentBookingId(bookingId ?? null);
    setCurrentBookingLabel(label ?? null);
    return () => {
      setCurrentBookingId(null);
      setCurrentBookingLabel(null);
    };
  }, [bookingId, label, setCurrentBookingId, setCurrentBookingLabel]);
}
