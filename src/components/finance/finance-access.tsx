import { Receipt, UserCog, Wallet } from "@/components/icons";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";

/**
 * What Finance says to someone who doesn't manage the club's money (only
 * owners, admins and treasurers do, enforced by the database): who does, and what
 * they can do from here. An admin can make another member treasurer; an
 * owner can give anyone access; anyone can ask to be paid back. Shown in
 * place of the treasurer pages, never as an error: a calm card with
 * Finance's wallet and one way on (My requests). The compact version shows
 * over My requests only when an admin can fix something (no treasurer).
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
  const body = who
    ? `${who} ${people.owners.length + people.treasurers.length === 1 ? "manages" : "manage"} the money. You can still ask to be paid back.`
    : "You can still ask to be paid back.";

  // Over a member's own requests: nothing to say unless they can fix it
  // (an admin, and nobody is treasurer yet).
  if (compact) {
    if (!canAppoint || people.treasurers.length > 0) return null;
    return (
      <section
        aria-label="No treasurer yet"
        className="bg-muted/60 rounded-tile flex flex-wrap items-center gap-3 p-3 ps-4"
      >
        <Wallet className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-medium">No treasurer yet</p>
        <Button asChild size="sm" variant="outline">
          <Link href={membersHref}>
            <UserCog aria-hidden="true" />
            Choose a treasurer
          </Link>
        </Button>
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
          Only treasurers see the money
        </h2>
        <p className="text-muted-foreground text-sm">{body}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href={`/app/${orgSlug}/finance/my-reimbursements`}>
            <Receipt aria-hidden="true" />
            My requests
          </Link>
        </Button>
        {canAppoint && people.treasurers.length === 0 && (
          <Button asChild variant="outline">
            <Link href={membersHref}>
              <UserCog aria-hidden="true" />
              Choose a treasurer
            </Link>
          </Button>
        )}
      </div>
    </Card>
  );
}
