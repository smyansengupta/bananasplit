"use client";

import { Check } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  setGuestCheckedIn,
  setGuestPaid,
} from "@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions";
import { FormMessage } from "@/components/brand/fields";
import { pill } from "@/components/brand/pill";
import { formatCents } from "@/lib/rsvp/pay";
import { cn } from "@/lib/utils";

/**
 * What a host sees after scanning a guest's ticket: their name, where they
 * stand, and one button. Before check-in it says "Check in Maya Patel";
 * after, a green line says when, with a quiet Undo. A payment the guest
 * still owes sits between the two with "Mark paid".
 */
export function TicketCheckIn({
  organizationId,
  eventId,
  registrationId,
  name,
  status,
  checkedInAt,
  cost,
  doorHref,
}: {
  organizationId: string;
  eventId: string;
  registrationId: string;
  name: string;
  status: "GOING" | "WAITLIST" | "CANCELLED";
  /** "7:02 PM" once checked in, else null. */
  checkedInAt: string | null;
  cost: { owes: number; paidCents: number | null; claimed: boolean; confirmed: boolean } | null;
  doorHref: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const checkedIn = checkedInAt !== null;

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const standing =
    status === "CANCELLED"
      ? "Cancelled their spot"
      : status === "WAITLIST"
        ? "On the waitlist, not the going list"
        : checkedIn
          ? "Going"
          : "Going, not checked in yet";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-heading text-[30px] leading-[1.08] tracking-[-0.02em] break-words">
          {name}
        </span>
        <span
          className={cn(
            "text-[15px]",
            status === "GOING" ? "text-muted-foreground" : "text-destructive font-semibold",
          )}
        >
          {standing}
        </span>
      </div>

      {checkedIn && (
        <p className="bg-tint-success text-tint-success-foreground rounded-field m-0 flex items-center gap-2 px-4 py-3 text-[15px] font-semibold">
          <Check className="size-5 flex-none" strokeWidth={2.6} aria-hidden="true" />
          Checked in at {checkedInAt}
        </p>
      )}

      {cost && status === "GOING" && (
        <div className="border-border rounded-field flex items-center justify-between gap-3 border px-4 py-3">
          <span className="text-[15px]">
            {cost.confirmed
              ? `Paid ${formatCents(cost.paidCents ?? cost.owes)}`
              : cost.claimed
                ? `Says they paid ${formatCents(cost.paidCents ?? cost.owes)}`
                : `Owes ${formatCents(cost.owes)}`}
          </span>
          {!cost.confirmed && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setGuestPaid(organizationId, eventId, registrationId, true))}
              className={pill({ tone: "outline", size: "sm" })}
            >
              Mark paid
            </button>
          )}
        </div>
      )}

      {status !== "CANCELLED" &&
        (checkedIn ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => setGuestCheckedIn(organizationId, eventId, registrationId, false))
            }
            className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-[14px] font-semibold underline-offset-4 hover:underline"
          >
            Undo check-in
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => setGuestCheckedIn(organizationId, eventId, registrationId, true, "QR"))
            }
            className={cn(pill({ size: "lg" }), "w-full")}
          >
            {pending
              ? "Checking in…"
              : status === "WAITLIST"
                ? `Check in ${name} anyway`
                : `Check in ${name}`}
          </button>
        ))}
      {error && <FormMessage>{error}</FormMessage>}

      <Link
        href={doorHref}
        className="border-border text-muted-foreground hover:text-foreground border-t pt-4 text-[14px] font-semibold"
      >
        Open the full guest list at the door
      </Link>
    </div>
  );
}
