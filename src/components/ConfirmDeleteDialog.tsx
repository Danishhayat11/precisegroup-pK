/**
 * Reusable confirm-delete dialog. Ships the standard project-wide copy —
 * "Are you sure? This cannot be undone." — while still allowing pages to
 * override the title / description / labels when they need a more specific
 * warning (e.g. cascade deletes).
 *
 * Two usage modes:
 *  1. Controlled — pass `open` + `onOpenChange` (for menus / row actions
 *     that manage state themselves).
 *  2. Trigger-based — pass a `trigger` prop and the dialog owns its own
 *     open state.
 */
import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BaseProps = {
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
};

type ControlledProps = BaseProps & {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger?: never;
};

type TriggerProps = BaseProps & {
  open?: never;
  onOpenChange?: never;
  trigger: ReactNode;
};

export function ConfirmDeleteDialog(props: ControlledProps | TriggerProps) {
  const [uOpen, setUOpen] = useState(false);
  const controlled = "open" in props && props.open !== undefined;
  const open = controlled ? (props as ControlledProps).open : uOpen;
  const setOpen = (v: boolean) => {
    if (controlled) (props as ControlledProps).onOpenChange(v);
    else setUOpen(v);
  };
  const [busy, setBusy] = useState(false);

  const {
    title = "Are you sure?",
    description = "This cannot be undone.",
    confirmLabel = "Delete",
    cancelLabel = "Cancel",
    onConfirm,
    destructive = true,
  } = props;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      {"trigger" in props && props.trigger ? (
        <AlertDialogTrigger asChild>{props.trigger}</AlertDialogTrigger>
      ) : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            disabled={busy}
            className={cn(destructive && buttonVariants({ variant: "destructive" }))}
          >
            {busy ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmDeleteDialog;
