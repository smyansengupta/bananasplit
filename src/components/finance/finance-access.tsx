import { Receipt, UserCog, Wallet } from "@/components/icons";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";

/**
 * What Finance says to someone who doesn't manage the club's money (only
 * owners and treasurers do, enforced by the database): who does, and what
 * they can do from here. An admin can make another member treasurer; an
 * owner can give anyone access; anyone can ask to be paid back. Shown in
 * place of the treasurer pages, never as an error: a calm card with
 * Finance's wallet and one way on (My reimbursements). The compact version
 * is a one-line tile over My reimbursements.
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
  const membersHref = `/app/${orgSlug}/settings/members`;
  const who = [
    people.owners.length
      ? `${list(people.owners)} (owner${people.owners.length === 1 ? "" : "s"})`
      : null,
    people.treasurers.length
      ? `${list(people.treasurers)} (treasurer${people.treasurers.length === 1 ? "" : "s"})`
      : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const advice =
    role === Role.ADMIN ? (
      <>
        As an admin you can make another member treasurer in{" "}
        <Link
          href={membersHref}
          className="text-foreground focus-glow rounded-sm font-medium underline underline-offset-3"
        >
          Admin panel › Members
        </Link>
        . Only an owner can give you access to the organization&apos;s money
        {people.owners.length ? `: ask ${list(people.owners)}` : ""}.
      </>
    ) : (
      `To help with the organization's money, ask ${people.owners.length ? list(people.owners) : "an owner"} to make you treasurer.`
    );
  const body = (
    <>
      {who ? `That's ${who}. ` : ""}
      {people.treasurers.length === 0 ? "There's no treasurer yet. " : ""}
      {advice} You can still ask to be paid back for anything you bought for the organization.
    </>
  );

  if (compact) {
    return (
      <section
        aria-labelledby="finance-access-title"
        className="bg-muted/60 rounded-tile flex flex-wrap items-start gap-3 p-4"
      >
        <Wallet className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="finance-access-title" className="heading text-sm">
            The organization&apos;s money is managed by its owners and treasurers
          </h2>
          <p className="text-muted-foreground text-sm">{body}</p>
        </div>
        {canAppoint && (
          <Button asChild size="sm" variant="outline" className="self-center">
            <Link href={membersHref}>
              <UserCog aria-hidden="true" />
              Choose a treasurer
            </Link>
          </Button>
        )}
      </section>
    );
  }

  return (
    <Card
      role="region"
      aria-labelledby="finance-access-title"
      className="items-center px-6 py-10 text-center sm:py-12"
    >
      <span className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-full">
        <Wallet className="size-6" aria-hidden="true" />
      </span>
      <div className="max-w-prose space-y-2">
        <h2 id="finance-access-title" className="heading text-[17px]">
          Only owners and treasurers see the organization&apos;s money
        </h2>
        <p className="text-muted-foreground text-sm">{body}</p>
      </div>
      <Button asChild>
        <Link href={`/app/${orgSlug}/finance/my-reimbursements`}>
          <Receipt aria-hidden="true" />
          My reimbursements
        </Link>
      </Button>
    </Card>
  );
}
