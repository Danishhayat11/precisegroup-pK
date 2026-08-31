import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUTO_DOC_CATALOG,
  AUTO_STYLE_DEFAULTS,
  LOGO_OPTIONS,
  type AutoDocType,
  type LetterheadStyleHint,
  loadAutoLogoMap,
  loadAutoStyleMap,
  saveAutoLogoMap,
  saveAutoStyleMap,
  getLogoOption,
} from "@/lib/logos";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const AUTO_VALUE = "__auto__";

export default function AutoLogoEditor({ open, onOpenChange }: Props) {
  const [docMap, setDocMap] = useState<Partial<Record<AutoDocType, string>>>({});
  const [styleMap, setStyleMap] = useState<Partial<Record<LetterheadStyleHint, string>>>({});

  // Re-load whenever the dialog opens so we reflect the latest persisted state.
  useEffect(() => {
    if (!open) return;
    setDocMap(loadAutoLogoMap());
    setStyleMap(loadAutoStyleMap());
  }, [open]);

  const handleSave = () => {
    saveAutoLogoMap(docMap);
    saveAutoStyleMap(styleMap);
    toast.success("Auto-logo mapping saved");
    onOpenChange(false);
  };

  const handleResetAll = () => {
    setDocMap({});
    setStyleMap({});
  };

  const effectiveForDoc = (id: AutoDocType, style: LetterheadStyleHint): string =>
    docMap[id] || styleMap[style] || AUTO_STYLE_DEFAULTS[style];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Auto-logo editor</DialogTitle>
          <DialogDescription>
            Choose which logo Auto mode picks for each document type. Per-document overrides take
            priority over the style-level defaults below.
          </DialogDescription>
        </DialogHeader>

        {/* Style-level defaults */}
        <section className="mt-2">
          <h3 className="text-sm font-semibold mb-2">Letterhead style defaults</h3>
          <div className="rounded-md border divide-y">
            {(["A", "B"] as LetterheadStyleHint[]).map((style) => {
              const current = styleMap[style];
              const fallback = AUTO_STYLE_DEFAULTS[style];
              const label =
                style === "A"
                  ? "Style A — Notices & schedules"
                  : "Style B — Transactional & contractual";
              return (
                <div key={style} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Default: {getLogoOption(fallback).label}
                    </div>
                  </div>
                  <ResolvedPreview logoId={current ?? fallback} />
                  <LogoSelect
                    value={current ?? AUTO_VALUE}
                    onChange={(v) =>
                      setStyleMap((m) => {
                        const next = { ...m };
                        if (v === AUTO_VALUE) delete next[style];
                        else next[style] = v;
                        return next;
                      })
                    }
                    autoLabel={`Default (${getLogoOption(fallback).label})`}
                  />
                </div>
              );
            })}
          </div>
        </section>

        {/* Per-document overrides */}
        <section className="mt-5">
          <h3 className="text-sm font-semibold mb-2">Per-document overrides</h3>
          <div className="rounded-md border divide-y">
            {AUTO_DOC_CATALOG.map((spec) => {
              const current = docMap[spec.id];
              const effective = effectiveForDoc(spec.id, spec.style);
              return (
                <div key={spec.id} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{spec.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Style {spec.style} · Auto will pick:{" "}
                      <span className="font-medium text-foreground">
                        {getLogoOption(effective).label}
                      </span>
                      {current ? " (overridden)" : ""}
                    </div>
                  </div>
                  <ResolvedPreview logoId={effective} />
                  <LogoSelect
                    value={current ?? AUTO_VALUE}
                    onChange={(v) =>
                      setDocMap((m) => {
                        const next = { ...m };
                        if (v === AUTO_VALUE) delete next[spec.id];
                        else next[spec.id] = v;
                        return next;
                      })
                    }
                    autoLabel={`Use style default (${getLogoOption(styleMap[spec.style] || AUTO_STYLE_DEFAULTS[spec.style]).label})`}
                  />
                  {current && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 min-h-11 min-w-11"
                      title="Reset to style default"
                      aria-label="Reset to style default"
                      onClick={() =>
                        setDocMap((m) => {
                          const next = { ...m };
                          delete next[spec.id];
                          return next;
                        })
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <DialogFooter className="mt-4 gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={handleResetAll}>
            Reset all to defaults
          </Button>
          <div className="flex-1" />
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogoSelect({
  value,
  onChange,
  autoLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  autoLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[230px] text-xs shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO_VALUE} className="text-xs">
          {autoLabel}
        </SelectItem>
        {LOGO_OPTIONS.map((o) => (
          <SelectItem key={o.id} value={o.id} className="text-xs">
            <span className="flex items-center gap-2">
              <span
                className="inline-block w-5 h-5 rounded-sm border"
                style={{ background: o.bg === "dark" ? "#1B2B4B" : "#fff" }}
              >
                <img src={o.url} alt="" className="w-full h-full object-contain" />
              </span>
              {o.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ResolvedPreview({ logoId }: { logoId: string }) {
  const opt = getLogoOption(logoId);
  const dark = opt.bg === "dark";
  return (
    <div
      className="shrink-0 rounded-md border flex items-center justify-center overflow-hidden"
      style={{ width: 92, height: 44, background: dark ? "#1B2B4B" : "#fff" }}
      title={`Auto will pick: ${opt.label}`}
    >
      <img src={opt.url} alt={opt.label} className="max-w-full max-h-full object-contain p-1" />
    </div>
  );
}
