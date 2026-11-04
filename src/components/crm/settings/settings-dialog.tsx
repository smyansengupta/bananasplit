"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import {
  FormDialog,
  FormDialogBody,
  FormDialogHead,
  keepOpenForToasts,
} from "@/components/ui/form-dialog";
import { OPEN_PARAM } from "@/lib/crm/overlay";
import { cn } from "@/lib/utils";

/**
 * What used to be a page under CRM settings, opened in place (?open=): the
 * app's dialog, with the black Close. Closing takes `open` off the URL, and
 * `describe`, the sentence a new automation started from.
 */
export function CrmSettingsDialog({
  title,
  description,
  wide = false,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  /** For a grid of cards. */
  wide?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const close = () => {
    const params = new URLSearchParams(search?.toString() ?? "");
    params.delete(OPEN_PARAM);
    params.delete("describe");
    const rest = params.toString();
    router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
  };
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && close()}
      onInteractOutside={keepOpenForToasts}
      className={cn("sm:max-w-3xl", wide && "sm:max-w-4xl")}
    >
      <FormDialogHead title={title} description={description} />
      <FormDialogBody>{children}</FormDialogBody>
    </FormDialog>
  );
}
