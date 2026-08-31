import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Copy, Link2 } from "lucide-react";
import { tryCopyToClipboard } from "@/lib/shareLink";

type Props = {
  open: boolean;
  link: string | null;
  description?: string;
  onOpenChange: (open: boolean) => void;
};

/**
 * Manual-copy fallback shown when clipboard access is blocked
 * (insecure context, denied permission, sandboxed iframe, etc.).
 * Renders the full URL in a selectable input plus a retry button.
 */
export function ShareFallbackDialog({ open, link, description, onOpenChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setCopied(false);
      // Auto-select for keyboard users: Cmd/Ctrl+C completes the copy.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, link]);

  const retry = async () => {
    if (!link) return;
    const ok = await tryCopyToClipboard(link);
    if (ok) {
      setCopied(true);
      setTimeout(() => onOpenChange(false), 700);
    } else {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Copy share link
          </DialogTitle>
          <DialogDescription>
            {description ??
              "Your browser blocked automatic clipboard access. Select the link below and copy it manually (Ctrl/Cmd+C)."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={link ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Shareable link"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={retry}
            aria-label="Try copying to clipboard again"
          >
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
