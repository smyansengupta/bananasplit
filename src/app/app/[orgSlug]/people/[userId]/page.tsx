import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { LinkedSection } from "@/components/links/linked-section";
import { PersonProfile } from "@/components/profile/person-profile";
import { peopleHref } from "@/lib/profile/href";
import { getOrgContextBySlug } from "@/server/db/context";
import { getPersonSheet } from "@/server/profiles/directory";
import { planGate } from "@/server/billing/plan-gate";

/**
 * One member's full page: the same profile the directory's sheet shows
 * (src/components/profile/person-profile.tsx), on its own URL.
 * Membership-checked twice: the viewer must be a member of this org
 * (getOrgContextBySlug answers 404 otherwise), and the person must be a
 * CURRENT member of it (getPersonSheet returns null for a user of another
 * org, a former member or an unknown id, and the page answers 404 without
 * saying which). Shows only this org's title; the email only to those the
 * org's privacy settings allow.
 */
export default async function PersonPage({ params }: PageProps<"/app/[orgSlug]/people/[userId]">) {
  const { orgSlug, userId } = await params;
  const planLock = await planGate(orgSlug, "people");
  if (planLock) return planLock;
  const { organization, user, role, settings } = await getOrgContextBySlug(orgSlug);
  const person = await getPersonSheet(
    organization.id,
    userId,
    { id: user.id, role, membersSeeEmails: settings?.showMemberEmailsToMembers === true },
    organization.timezone,
  );
  if (!person) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <BackLink href={peopleHref(orgSlug)} label="People" />
      <article className="bg-card edge rounded-card overflow-hidden">
        <PersonProfile
          person={person}
          orgSlug={orgSlug}
          viewerId={user.id}
          timeZone={organization.timezone}
          headingLevel="h1"
        />
      </article>
      <LinkedSection
        orgId={organization.id}
        orgSlug={orgSlug}
        at={{ kind: "person", id: userId }}
      />
    </div>
  );
}
