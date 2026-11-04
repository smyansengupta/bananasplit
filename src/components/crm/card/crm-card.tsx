"use client";

import { MoreHorizontal } from "@/components/icons";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHead } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PHONE_FULL_SCREEN } from "@/components/ui/form-dialog";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

import { useCrmOpen, usePendingOpen } from "./use-crm-open";

/** The card's frame: Tasks' task dialog at 680px (CrmPendingCard draws the same one while loading). */
export const CRM_CARD_FRAME =
  "bg-background flex h-[min(88vh,860px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]";

/**
 * The one card everything in the CRM opens as (a person, company, deal,
 * Power hour, Done on its own, Ask, New, a goal): Tasks' task dialog at
 * 680px. A fixed header (DialogHead: avatar, title and subtitle; the black
 * Close in the corner with the card's round buttons and "…" under it), the
 * pill tab segment under it (with `tabsAside` beside it), a body that
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
  tabsAside,
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
  /** A row between the title and the tabs. */
  strip?: ReactNode;
  tabs?: readonly CrmCardTab[];
  /** Beside the tabs, on their row (a deal's stages), wrapping under on a narrow card. */
  tabsAside?: ReactNode;
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
  const { close, raw } = useCrmOpen();
  // Closing hides the card on the click; the URL catches up after. Another
  // card on its way (CrmPendingCard) takes this one's place too.
  const [closing, setClosing] = useState(false);
  const pending = usePendingOpen();
  const [own, setOwn] = useState(defaultTab ?? tabs?.[0]?.value ?? "");
  const current = tab ?? own;
  const pick = (value: string) => {
    if (tab === undefined) setOwn(value);
    onTab?.(value);
  };
  const shut = () => {
    setClosing(true);
    (onClose ?? close)();
  };
  const shown = !closing && !(pending !== null && pending !== raw);
  const plainTitle = typeof title === "string" ? title : "Details";
  return (
    <Dialog open={shown} onOpenChange={(o) => !o && shut()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          CRM_CARD_FRAME,
          // On a phone the card is the whole screen, rounded at the top.
          PHONE_FULL_SCREEN,
        )}
        // A toast's Undo sits outside the card: clicking it mustn't close the card.
        onInteractOutside={(e) => {
          if (e.target instanceof Element && e.target.closest("[data-toaster]")) e.preventDefault();
        }}
      >
        <DialogDescription className="sr-only">{description ?? plainTitle}</DialogDescription>
        <header className="border-border/60 flex shrink-0 flex-col gap-4 border-b ps-6 pe-4 pt-4 pb-3.5 max-sm:ps-4">
          <DialogHead
            // At 375px the avatar and the title give way to the round buttons.
            leading={
              avatar && (
                <div className="max-sm:[&>span]:!size-10 max-sm:[&>span]:!text-[14px]">{avatar}</div>
              )
            }
            title={title}
            titleClassName="display-title truncate text-[26px] leading-tight max-sm:text-[22px]"
            subtitle={subtitle && <div className="truncate">{subtitle}</div>}
            onClose={shut}
            actions={
              actions || menu ? (
                <>
                  {actions}
                  {menu && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label={menuLabel}
                          title={menuLabel}
                        >
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {menu}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              ) : undefined
            }
          />
          {(strip || (tabs && tabs.length > 0) || tabsAside) && (
            <div className="flex flex-col gap-4 pe-2">
              {strip}
              {((tabs && tabs.length > 0) || tabsAside) && (
                // The sections, then anything beside them (a deal's stages),
                // like Tasks' view switch with Mine / My team / Everyone next
                // to it; on a narrow card the second group wraps under.
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  {tabs && tabs.length > 0 && (
                    // On a phone the pills stay inside the card: tighter, and
                    // they scroll sideways within it if they still don't fit.
                    <div className="max-w-full min-w-0 [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden max-sm:[&_button]:px-2.5">
                      <Segmented
                        label={`${plainTitle}: sections`}
                        value={current}
                        onSelect={pick}
                        options={tabs.map((t) => ({
                          value: t.value,
                          label: t.label,
                          count: t.count,
                        }))}
                      />
                    </div>
                  )}
                  {tabsAside}
                </div>
              )}
            </div>
          )}
        </header>
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5 max-sm:px-4", bodyClassName)}>
          {typeof children === "function" ? children(current) : children}
        </div>
        {foot && (
          <footer className="border-border/60 shrink-0 border-t px-6 pt-3.5 pb-5 max-sm:px-4">{foot}</footer>
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
