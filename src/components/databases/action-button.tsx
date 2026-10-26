"use client";

import { Loader2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { ItemMenu, type ItemMenuEntry } from "@/components/item-menu";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";

type Variant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";

/**
 * A button that runs one Server Action ({ error?, data? } result) with
 * `args`, shows the error inline, and refreshes the page on success.
 * `confirm` asks first (irreversible actions). Server components pass the
 * action reference and serializable args, never a closure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (...args: any[]) => Promise<{ error?: string }>;

export function ActionButton<A extends AnyAction>({
  action,
  args,
  children,
  confirm,
  variant = "outline",
  size = "sm",
  onDone,
  className,
}: {
  action: A;
  args?: Parameters<A>;
  children: ReactNode;
  confirm?: string;
  variant?: Variant;
  size?: "default" | "sm" | "xs";
  onDone?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [confirmEl, ask] = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {confirmEl}
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={pending}
        className={className}
        onClick={async () => {
          if (
            confirm &&
            !(await ask({
              title: confirm,
              confirmLabel: typeof children === "string" ? children : "Confirm",
              tone: variant === "destructive" ? "destructive" : "default",
            }))
          )
            return;
          setError(null);
          start(async () => {
            const result = await action(...((args ?? []) as Parameters<A>));
            if (result.error) {
              setError(result.error);
              return;
            }
            onDone?.();
            router.refresh();
          });
        }}
      >
        {children}
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}

export interface ActionMenuItem {
  label: string;
  action: AnyAction;
  args?: unknown[];
  /** Asked first, in the confirm dialog ("Delete this check-in?"). */
  confirm?: string;
  /** What happens, under the question. */
  confirmDescription?: string;
  destructive?: boolean;
}

/**
 * The row drawer's "…" menu (the shared ItemMenu) for the Server Actions
 * that are not the row's everyday one: Suppress, Not a duplicate, Delete.
 * Each runs like an ActionButton (confirm first, the error beside the
 * menu, refresh on success). Client parents add their own entries with
 * `extra` (one that opens a form); destructive entries always come last.
 */
export function ActionMenu({
  label,
  items,
  extra = [],
}: {
  label: string;
  items: ActionMenuItem[];
  extra?: ItemMenuEntry[];
}) {
  const router = useRouter();
  const [confirmEl, ask] = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = async (item: ActionMenuItem) => {
    if (
      item.confirm &&
      !(await ask({
        title: item.confirm,
        description: item.confirmDescription,
        confirmLabel: item.label,
        tone: item.destructive ? "destructive" : "default",
      }))
    )
      return;
    setError(null);
    start(async () => {
      const result = await item.action(...(item.args ?? []));
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };
  const entry = (item: ActionMenuItem): ItemMenuEntry => ({
    label: item.label,
    destructive: item.destructive,
    disabled: pending,
    onSelect: () => void run(item),
  });

  return (
    <span className="inline-flex items-center gap-2">
      {confirmEl}
      <ItemMenu
        label={label}
        className="border-input"
        items={[
          ...items.filter((i) => !i.destructive).map(entry),
          ...extra,
          ...items.filter((i) => i.destructive).map(entry),
        ]}
      />
      {pending && (
        <Loader2 className="text-muted-foreground size-4 animate-spin" aria-label="Working" />
      )}
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
