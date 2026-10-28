"use client";

import { Banknote, Check, Copy, Gift, Share2, Ticket, Users } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";

import { claimBringItem, markMyPayment } from "@/app/e/[slug]/actions";
import { FormMessage } from "@/components/brand/fields";
import { pill } from "@/components/brand/pill";
import { formatCents, type PayLink } from "@/lib/rsvp/pay";
import type { RsvpPageItem } from "@/server/rsvp/page";
import { cn } from "@/lib/utils";

/**
 * What a signed-up guest does after "You're going": pay their share, show
 * their ticket, bring friends with their own link, and grab something off
 * the bring list. Inset tiles inside the registration card (the bring
 * list sits on the page itself).
 */

const noSubscribe = () => () => {};

function useCopy(): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        window.prompt("Copy this link", text);
      }
    },
  ];
}

function Block({
  icon,
  title,
  children,
  aside,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="bg-muted/60 rounded-tile flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-3 text-[15px] font-semibold">
          <span className="bg-card text-foreground grid size-9 flex-none place-items-center rounded-full [&_svg]:size-[18px]">
            {icon}
          </span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

// ---- Chip in -----------------------------------------------------------------

export function ChipIn({
  slug,
  owes,
  note,
  split,
  payLinks,
  paid,
}: {
  slug: string;
  owes: number;
  note: string | null;
  /** A shared total: the share can still shrink as more people sign up. */
  split: boolean;
  payLinks: PayLink[];
  paid: { cents: number | null; confirmed: boolean } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, copy] = useCopy();

  function sayPaid() {
    setError(null);
    start(async () => {
      const result = await markMyPayment({ slug });
      if (!result.ok) {
        setError(result.error ?? "That didn't work. Try again.");
        return;
      }
      router.refresh();
    });
  }

  const badge = paid ? (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[12px] font-bold whitespace-nowrap",
        paid.confirmed
          ? "bg-tint-success text-tint-success-foreground"
          : "bg-tint-accent text-tint-accent-foreground",
      )}
    >
      {paid.confirmed ? "Paid" : "Waiting for the host"}
    </span>
  ) : null;

  return (
    <Block
      icon={<Banknote className="size-4" aria-hidden="true" />}
      title={
        <>
          Chip in <span className="numeral text-[18px]">{formatCents(owes)}</span>
        </>
      }
      aside={badge}
    >
      <p className="text-muted-foreground m-0 text-[14px] leading-[1.5]">
        {paid
          ? paid.confirmed
            ? `The host got your ${formatCents(paid.cents ?? owes)}. You're all set.`
            : `You said you sent ${formatCents(paid.cents ?? owes)}. The host will tick you off.`
          : `${note ? `${note}. ` : ""}${
              split
                ? "Your share of the total. It only goes down as more people sign up."
                : "Pay the host directly. No fees, nothing through us."
            }`}
      </p>
      {!paid?.confirmed && payLinks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {payLinks.map((link) =>
            link.href ? (
              <a
                key={link.app}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={pill({ tone: paid ? "outline" : "ink", size: "sm" })}
              >
                {link.label}
                <span className="opacity-70">{link.detail}</span>
              </a>
            ) : (
              <button
                key={link.app}
                type="button"
                onClick={() => void copy(link.detail ?? "")}
                className={pill({ tone: "outline", size: "sm" })}
                title="Copy who to send it to"
              >
                {link.label}
                <span className="opacity-70">{copied ? "Copied" : link.detail}</span>
              </button>
            ),
          )}
        </div>
      )}
      {!paid && (
        <button
          type="button"
          onClick={sayPaid}
          disabled={pending}
          className="text-foreground w-fit cursor-pointer text-[14px] font-semibold underline-offset-4 hover:underline disabled:opacity-50"
        >
          {pending ? "Saving…" : `I've paid ${formatCents(owes)}`}
        </button>
      )}
      {error && <FormMessage>{error}</FormMessage>}
    </Block>
  );
}

// ---- Ticket ------------------------------------------------------------------

export function TicketStub({
  ticketUrl,
  checkedIn,
  qr,
}: {
  ticketUrl: string;
  checkedIn: boolean;
  qr: React.ReactNode;
}) {
  return (
    <Block
      icon={<Ticket className="size-4" aria-hidden="true" />}
      title="Your ticket"
      aside={
        checkedIn ? (
          <span className="bg-tint-success text-tint-success-foreground rounded-full px-2.5 py-1 text-[12px] font-bold">
            Checked in
          </span>
        ) : null
      }
    >
      <div className="flex items-center gap-4">
        <a
          href={ticketUrl}
          className="rounded-field block size-[92px] flex-none overflow-hidden bg-white p-1.5"
          aria-label="Open your ticket full screen"
        >
          {qr}
        </a>
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-muted-foreground m-0 text-[14px] leading-[1.5]">
            {checkedIn
              ? "You're in. Enjoy it."
              : "Show this at the door and the host scans you in. It's in your email too."}
          </p>
          <a
            href={ticketUrl}
            className="text-foreground w-fit text-[14px] font-semibold underline-offset-4 hover:underline"
          >
            Open full screen
          </a>
        </div>
      </div>
    </Block>
  );
}

// ---- Bring friends -------------------------------------------------------------

export function InviteFriends({
  inviteUrl,
  invitedCount,
  title,
}: {
  inviteUrl: string;
  invitedCount: number;
  title: string;
}) {
  const [copied, copy] = useCopy();
  // The share sheet exists only in some browsers, and never on the server.
  const canShare = useSyncExternalStore(
    noSubscribe,
    () => typeof navigator.share === "function",
    () => false,
  );

  async function share() {
    try {
      await navigator.share({ title, text: `Come to ${title} with me`, url: inviteUrl });
    } catch {
      // Closed the share sheet: nothing to do.
    }
  }

  return (
    <Block
      icon={<Users className="size-4" aria-hidden="true" />}
      title="Bring your friends"
      aside={
        invitedCount > 0 ? (
          <span className="bg-brand-accent text-brand-accent-foreground rounded-full px-2.5 py-1 text-[12px] font-bold whitespace-nowrap">
            {invitedCount} joined with your link
          </span>
        ) : null
      }
    >
      <p className="text-muted-foreground m-0 text-[14px] leading-[1.5]">
        Your own link. Friends who open it see you invited them, and the host sees who brought who.
      </p>
      <div className="bg-card flex items-center gap-2 rounded-full py-1 pr-1 pl-4">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
          {inviteUrl.replace(/^https?:\/\//, "")}
        </span>
        {canShare && (
          <button
            type="button"
            onClick={() => void share()}
            className={pill({ tone: "outline", size: "sm" })}
          >
            <Share2 className="size-3.5" aria-hidden="true" />
            Share
          </button>
        )}
        <button type="button" onClick={() => void copy(inviteUrl)} className={pill({ size: "sm" })}>
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </Block>
  );
}

// ---- The bring list --------------------------------------------------------------

export function BringList({
  slug,
  items,
  canClaim,
}: {
  slug: string;
  items: RsvpPageItem[];
  /** This browser's guest is signed up. */
  canClaim: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(item: RsvpPageItem) {
    setError(null);
    setBusy(item.id);
    start(async () => {
      const result = await claimBringItem({ slug, itemId: item.id, claim: !item.mine });
      setBusy(null);
      if (!result.ok) {
        setError(result.error ?? "That didn't work. Try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item) => {
          const full = item.taken >= item.slots;
          return (
            <li
              key={item.id}
              className={cn(
                "rounded-tile flex items-center gap-3 px-4 py-3",
                item.mine ? "bg-tint-accent text-foreground" : "bg-muted/60",
              )}
            >
              <Gift
                className={cn(
                  "size-[18px] flex-none",
                  item.mine ? "text-tint-accent-foreground" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] leading-[1.35] font-semibold break-words">
                  {item.label}
                </span>
                <span className={cn("text-[13px] leading-[1.4]", "text-muted-foreground")}>
                  {item.mine
                    ? "You're bringing this"
                    : item.names.length > 0
                      ? `${item.names.join(", ")}${full ? "" : ` · ${item.slots - item.taken} more needed`}`
                      : full
                        ? "Covered"
                        : item.slots > 1
                          ? `${item.slots - item.taken} of ${item.slots} still needed`
                          : "Still needed"}
                </span>
              </span>
              {canClaim && (item.mine || !full) ? (
                <button
                  type="button"
                  disabled={pending && busy === item.id}
                  onClick={() => toggle(item)}
                  className={cn(
                    pill({ tone: item.mine ? "outline" : "ink", size: "sm" }),
                    "flex-none",
                  )}
                >
                  {busy === item.id ? "…" : item.mine ? "Never mind" : "I'll bring it"}
                </button>
              ) : full && !item.mine ? (
                <Check
                  className="text-muted-foreground size-[18px] flex-none"
                  aria-label="Covered"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {!canClaim && (
        <p className="text-muted-foreground m-0 text-[13px]">
          Sign up to grab something off the list.
        </p>
      )}
      {error && <FormMessage>{error}</FormMessage>}
    </div>
  );
}
