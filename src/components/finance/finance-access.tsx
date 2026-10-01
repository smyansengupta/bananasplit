import { Landmark, Receipt, UserCog } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

/**
 * What Finance says to someone who doesn't manage the club's money (only
 * owners and treasurers do, enforced by the database): who does, and what
 * they can do from here. An admin can make another member treasurer; an
 * owner can give anyone access; anyone can ask to be paid back. Shown in
 * place of the treasurer pages, never as an error.
 */

export interface FinancePeople {
  owners: string[];
  treasurers: string[];
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function FinanceAccessNotice({
  orgSlug,
  role,
  people,
  compact = false,
}: {
  orgSlug: string;
  role: Role;
  people: FinancePeople;
  /** The one-line version over My reimbursements. */
  compact?: boolean;
}) {
  const canAppoint = can({ role }, "members.changeRole");
  const who = [
    people.owners.length ? `${list(people.owners)} (owner${people.owners.length === 1 ? "" : "s"})` : null,
    people.treasurers.length ? `${list(people.treasurers)} (treasurer${people.treasurers.length === 1 ? "" : "s"})` : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const advice =
    role === Role.ADMIN
      ? `As an admin you can make another member treasurer in Settings › Members. Only an owner can give you access to the club's money${people.owners.length ? `: ask ${list(people.owners)}` : ""}.`
      : `To help with the club's money, ask ${people.owners.length ? list(people.owners) : "an owner"} to make you treasurer.`;

  return (
    <section
      className={cn(
        "bg-muted/40 flex flex-wrap items-start gap-3 rounded-xl border",
        compact ? "p-3" : "p-5 sm:p-6",
      )}
    >
      <span className={cn("bg-primary/10 text-primary grid shrink-0 place-items-center rounded-xl", compact ? "size-9" : "size-11")}>
        <Landmark className={compact ? "size-4" : "size-5"} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className={cn("font-semibold", compact ? "text-sm" : "text-base")}>
          {compact ? "The club's money is managed by its owners and treasurers" : "Only owners and treasurers see the club's money"}
        </h2>
        <p className="text-muted-foreground text-sm">
          {who ? `That's ${who}. ` : ""}
          {people.treasurers.length === 0 ? "There's no treasurer yet. " : ""}
          {advice} You can still ask to be paid back for anything you bought for the club.
        </p>
        {!compact && (
          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild>
              <Link href={`/app/${orgSlug}/finance/my-reimbursements`}>
                <Receipt className="size-4" aria-hidden="true" />
                My reimbursements
              </Link>
            </Button>
            {canAppoint && (
              <Button asChild variant="outline">
                <Link href={`/app/${orgSlug}/settings/members`}>
                  <UserCog className="size-4" aria-hidden="true" />
                  Choose a treasurer
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>
      {compact && canAppoint && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/app/${orgSlug}/settings/members`}>
            <UserCog className="size-4" aria-hidden="true" />
            Choose a treasurer
          </Link>
        </Button>
      )}
    </section>
  );
}
