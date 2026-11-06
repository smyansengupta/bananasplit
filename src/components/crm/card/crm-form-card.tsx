"use client";

import type { ReactNode } from "react";

import { FormDialog, keepOpenForToasts } from "@/components/ui/form-dialog";

import { useCardPresence } from "./use-crm-open";

/**
 * A CRM card that is New person's window rather than the 680px CrmCard (Done
 * on its own, a goal): the same FormDialog, opened by `?open=`, closed by
 * removing it. Use the FormDialog pieces inside; a function child gets
 * `shut`, which closes it.
 */
export function CrmFormCard({
  children,
}: {
  children: ReactNode | ((shut: () => void) => ReactNode);
}) {
  const { shown, motion, shut } = useCardPresence();
  return (
    <FormDialog
      open={shown}
      motion={motion}
      onOpenChange={(o) => !o && shut()}
      onInteractOutside={keepOpenForToasts}
    >
      {typeof children === "function" ? children(shut) : children}
    </FormDialog>
  );
}
