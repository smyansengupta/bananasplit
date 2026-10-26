"use client";

import { ArrowUpRight, CalendarDays, Ticket } from "@/components/icons";
import type { ReactNode } from "react";

import { ContextActions } from "@/components/context-actions";

/**
 * A meeting card's right-click menu.
 *
 * The card carries no "…" of its own, so without this a right-click on the
 * Meetings page found nothing. The page is a server component and an icon
 * is a function, which cannot be handed to a client component, so the card
 * passes plain strings and the icons are picked here.
 */
export function MeetingCardActions({
  title,
  openLabel,
  openHref,
  signUpHref,
  calendarHref,
  children,
}: {
  title: string;
  openLabel: string;
  openHref: string;
  /** The public sign-up page, when the event has one. */
  signUpHref?: string | null;
  calendarHref: string;
  children: ReactNode;
}) {
  return (
    <ContextActions
      heading={title}
      items={[
        { label: openLabel, icon: ArrowUpRight, href: openHref },
        signUpHref
          ? {
              label: "Open the sign-up page",
              icon: Ticket,
              href: signUpHref,
              separated: true,
            }
          : null,
        { label: "Open it on the calendar", icon: CalendarDays, href: calendarHref },
      ]}
    >
      {children}
    </ContextActions>
  );
}
