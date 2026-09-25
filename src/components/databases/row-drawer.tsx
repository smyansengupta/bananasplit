"use client";

import type { ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { useViewParams } from "./view-params";

/**
 * The row detail drawer (?row=id). The server page loads the row through the
 * same RLS-scoped transaction as the table and passes the rendered detail as
 * children; closing the drawer removes ?row= from the URL.
 */
export function RowDrawer({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const view = useViewParams();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) view.update((p) => p.delete("row"), { keepPage: true });
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
