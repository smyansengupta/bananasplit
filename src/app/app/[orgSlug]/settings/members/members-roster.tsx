"use client";

import { useRouter } from "next/navigation";

import { PeopleTable, type InvitedRow, type RosterAccess } from "@/components/profile/people-table";
import { personHref } from "@/lib/profile/href";
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
  access,
}: {
  orgId: string;
  orgSlug: string;
  viewerId: string;
  people: DirectoryPerson[];
  emails: Record<string, string>;
  invites: InvitedRow[];
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
      access={access}
      onSelect={(id) => router.push(personHref(orgSlug, id))}
    />
  );
}
