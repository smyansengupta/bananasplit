"use client";

import { useRouter } from "next/navigation";

import { PeopleTable, type InvitedRow, type RosterAccess } from "@/components/profile/people-table";
import { personHref } from "@/lib/profile/href";
import type { Role } from "@/generated/prisma/enums";
import type { DirectoryPerson } from "@/server/profiles/directory";

/**
 * Admin > Members' roster (PeopleTable): roles and titles edited in place,
 * invites waiting as rows. A name opens that person's page.
 */
export function MembersRoster({
  orgId,
  orgSlug,
  viewerId,
  people,
  emails,
  invites,
  roleFixes,
  access,
}: {
  orgId: string;
  orgSlug: string;
  viewerId: string;
  people: DirectoryPerson[];
  emails: Record<string, string>;
  invites: InvitedRow[];
  roleFixes?: Record<string, { to: Role; reason: string }>;
  access: RosterAccess;
}) {
  const router = useRouter();
  return (
    <PeopleTable
      orgId={orgId}
      viewerId={viewerId}
      people={people}
      emails={emails}
      invites={invites}
      roleFixes={roleFixes}
      access={access}
      onSelect={(id) => router.push(personHref(orgSlug, id))}
    />
  );
}
