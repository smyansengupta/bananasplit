"use client";

import { MoreHorizontal, X } from "@/components/icons";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

import { useCrmOpen } from "./use-crm-open";

/**
 * The one card everything in the CRM opens as (a person, company, deal,
 * Power hour, Done on its own, Ask, New, a goal): Tasks' task dialog at
 * 680px. A fixed header (avatar, title, subtitle, the card's round
 * buttons, "…" and Close), the pill tab segment under it, a body that
 * scrolls and an optional fixed foot. Closing removes `?open=` and keeps
 * the rest of the URL (useCrmOpen), so the list underneath never moved.
 *
 * Tabs are the card's own state (`tab` + `onTab`, or uncontrolled with
 * `defaultTab`); `children` is a function of the tab when there are tabs.
 */

export interface CrmCardTab {
  value: string;
  label: string;
  count?: number;
}

export function CrmCard({
  title,
  subtitle,
  avatar,
  actions,
  menu,
  menuLabel = "More",
  strip,
  tabs,
  tab,
  defaultTab,
  onTab,
  foot,
  description,
  onClose,
  bodyClassName,
  children,
}: {
  title: ReactNode;
  /** One quiet line under the title. */
  subtitle?: ReactNode;
  /** A round mark left of the title (CrmAvatar). */
  avatar?: ReactNode;
  /** Round buttons before "…" (CrmCardButton). */
  actions?: ReactNode;
  /** DropdownMenuItems for the round "…" (none, no "…"). */
  menu?: ReactNode;
  menuLabel?: string;
  /** A row between the title and the tabs (a deal's stage pills). */
  strip?: ReactNode;
  tabs?: readonly CrmCardTab[];
  tab?: string;
  defaultTab?: string;
  onTab?: (value: string) => void;
  /** Fixed under the body (a composer, Send and Skip). */
  foot?: ReactNode;
  /** For screen readers: what the card is for. */
  description?: string;
  /** Instead of removing ?open= (a card opened some other way). */
  onClose?: () => void;
  bodyClassName?: string;
  children: ReactNode | ((tab: string) => ReactNode);
}) {
  const { close } = useCrmOpen();
  const [own, setOwn] = useState(defaultTab ?? tabs?.[0]?.value ?? "");
  const current = tab ?? own;
  const pick = (value: string) => {
    if (tab === undefined) setOwn(value);
    onTab?.(value);
  };
  const shut = onClose ?? close;
  const plainTitle = typeof title === "string" ? title : "Details";
  return (
    <Dialog open onOpenChange={(o) => !o && shut()}>
      <DialogContent
        showCloseButton={false}
        className="bg-background flex h-[min(88vh,860px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]"
      >
        <DialogDescription className="sr-only">{description ?? plainTitle}</DialogDescription>
        <header className="border-border/60 flex shrink-0 flex-col gap-4 border-b px-6 pt-5 pb-3.5">
          <div className="flex items-center gap-3.5">
            {avatar}
            <div className="min-w-0 flex-1">
              <DialogTitle className="display-title truncate text-[26px] leading-tight">
                {title}
              </DialogTitle>
              {subtitle && (
                <div className="text-muted-foreground truncate pt-1 text-sm">{subtitle}</div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {actions}
              {menu && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label={menuLabel} title={menuLabel}>
                      <MoreHorizontal className="size-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {menu}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="outline" size="icon" onClick={shut} aria-label="Close" title="Close">
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
          {strip}
          {tabs && tabs.length > 0 && (
            <Segmented
              label={`${plainTitle}: sections`}
              value={current}
              onSelect={pick}
              className="self-start"
              options={tabs.map((t) => ({ value: t.value, label: t.label, count: t.count }))}
            />
          )}
        </header>
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", bodyClassName)}>
          {typeof children === "function" ? children(current) : children}
        </div>
        {foot && (
          <footer className="border-border/60 shrink-0 border-t px-6 pt-3.5 pb-5">{foot}</footer>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A round icon button in a card's header (Call, Settings). A link with `href`. */
export function CrmCardButton({
  label,
  children,
  href,
  onClick,
  external,
}: {
  label: string;
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  external?: boolean;
}) {
  if (href) {
    return (
      <Button asChild variant="outline" size="icon" title={label}>
        <a
          href={href}
          aria-label={label}
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          {children}
        </a>
      </Button>
    );
  }
  return (
    <Button variant="outline" size="icon" onClick={onClick} aria-label={label} title={label}>
      {children}
    </Button>
  );
}

/** Initials in a round mark, the colour of the name (theme tag tones). */
export function CrmAvatar({ name, size = 52 }: { name: string; size?: number }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  const tones = [
    "var(--tag-ochre)",
    "var(--tag-forest)",
    "var(--tag-navy)",
    "var(--tag-plum)",
    "var(--tag-rust)",
    "var(--tag-teal)",
    "var(--tag-burgundy)",
  ];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tone = tones[h % tones.length];
  return (
    <span
      aria-hidden="true"
      className="text-foreground grid shrink-0 place-items-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
        background: `color-mix(in oklab, ${tone} 26%, var(--card))`,
      }}
    >
      {initials}
    </span>
  );
}
