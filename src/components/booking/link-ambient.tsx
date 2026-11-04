"use client";

import { useSyncExternalStore } from "react";

import { saveBookingLinkAction } from "@/app/app/[orgSlug]/meetings/booking/actions";
import { AmbientActions, type AmbientAction } from "@/components/ambient/ambient-button";
import { CalendarClock, Copy, Users } from "@/components/icons";
import type { BookingLinkState } from "@/server/booking/view";

/**
 * A link's ambient buttons, on its strip or your card. What shows comes from
 * the page (linkAmbient, src/lib/ambient/booking.ts); these do each job.
 *
 * The signature one stays true until someone books, and copying leaves
 * nothing on the server to read, so this browser remembers it's been done.
 */

const noSubscribe = () => () => undefined;
const signatureKey = (id: string) => `booking-signature:${id}`;

export function LinkAmbient({
  orgId,
  link,
  onEdit,
  className = "items-start",
}: {
  orgId: string;
  link: BookingLinkState;
  onEdit: () => void;
  className?: string;
}) {
  const copied = useSyncExternalStore(
    noSubscribe,
    () => window.localStorage.getItem(signatureKey(link.id)) === "1",
    () => false,
  );
  const actions = link.ambient.map(({ kind, reason }): AmbientAction | null => {
    switch (kind) {
      case "turn-on":
        return {
          key: kind,
          label: "Turn it on",
          tone: "solid",
          reason,
          run: () => saveBookingLinkAction(orgId, link.id, { active: true }),
          done: "It's on",
        };
      case "add-host":
        return { key: kind, label: "Add a host", icon: Users, tone: "spark", reason, open: onEdit };
      case "fix-hours":
        return { key: kind, label: "Fix the hours", icon: CalendarClock, tone: "spark", reason, open: onEdit };
      case "signature":
        return copied
          ? null
          : {
              key: kind,
              label: "Copy for your signature",
              icon: Copy,
              reason,
              run: async () => {
                try {
                  const line = link.personal ? "Book time with me" : "Book time with us";
                  await navigator.clipboard.writeText(`${line}: ${link.url}`);
                  window.localStorage.setItem(signatureKey(link.id), "1");
                  return {};
                } catch {
                  return { error: "Couldn't copy. Your browser blocked the clipboard." };
                }
              },
              done: "Copied. Paste it into your email signature.",
            };
    }
  });
  return <AmbientActions why className={className} actions={actions} />;
}
