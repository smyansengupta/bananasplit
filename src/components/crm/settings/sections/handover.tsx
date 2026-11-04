import Link from "next/link";

import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import type { CrmSettingsShell } from "@/app/app/[orgSlug]/crm/shell";
import { HandOverCard, Unowned, type OwnerChoice } from "@/components/crm/outreach/handover";
import { crmRecordHref } from "@/lib/crm/href";
import { briefs, departedOwners, unowned } from "@/server/crm/outreach/handover";
import { withOrgTx } from "@/server/db/context";

/**
 * Handover, in CRM settings (it was its own page, /crm/handover, which
 * redirects here). Team and access holds handing people over: members who
 * left, anyone with no owner, and members changing roles. You holds the
 * brief on each person handed to you lately, or that a position you hold
 * looks after (?role=). Never in a Personal space.
 */

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function ownerChoices(shell: CrmSettingsShell): OwnerChoice[] {
  return [
    ...shell.members.map((m) => ({ value: `u:${m.id}`, label: m.name })),
    ...[...shell.roles.values()].map((r) => ({
      value: `r:${r.key}`,
      label: `${r.title} (${r.holderName?.split(" ")[0] ?? "open"})`,
    })),
  ];
}

/** Team and access: hand people over (owners and admins). */
export async function HandoverCards({ shell, orgSlug }: { shell: CrmSettingsShell; orgSlug: string }) {
  const orgId = shell.org.id;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const data = await withOrgTx(orgId, async ({ db }) => {
    const left = await departedOwners(db, orgId);
    const counts = await db.crmPerson.groupBy({
      by: ["ownerId"],
      where: {
        organizationId: orgId,
        deletedAt: null,
        ownerId: { in: shell.members.map((m) => m.id) },
      },
      _count: { _all: true },
    });
    return {
      left,
      members: counts.map((c) => ({
        userId: c.ownerId!,
        name: names.get(c.ownerId!) ?? "A member",
        people: c._count._all,
      })),
      unowned: await unowned(db, orgId, shell.roles),
    };
  });
  const choices = ownerChoices(shell);
  return (
    <>
      {data.left.length > 0 && (
        <SettingsCard
          title="Members who left"
          description="Give everyone they looked after to someone else in one step."
        >
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
            {data.left.map((l) => (
              <HandOverCard key={l.userId} orgId={orgId} from={{ ...l, left: true }} choices={choices} />
            ))}
          </ul>
        </SettingsCard>
      )}
      <SettingsCard
        title="No owner"
        description="People nobody looks after. Pick some and give them to someone."
      >
        <Unowned orgId={orgId} orgSlug={orgSlug} rows={data.unowned} choices={choices} />
      </SettingsCard>
      {data.members.length > 0 && (
        <SettingsCard
          title="Hand people over"
          description="When someone steps back or changes role, hand their relationships to whoever takes over, or to a position so they follow it."
        >
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
            {data.members.map((m) => (
              <HandOverCard key={m.userId} orgId={orgId} from={{ ...m, left: false }} choices={choices} />
            ))}
          </ul>
        </SettingsCard>
      )}
    </>
  );
}

/** You: the brief on each person handed to you (or your position's, with ?role=). */
export async function HandedToYou({
  shell,
  orgSlug,
  role: asked,
}: {
  shell: CrmSettingsShell;
  orgSlug: string;
  role?: string;
}) {
  if (shell.access.personal) return null;
  const orgId = shell.org.id;
  const userId = shell.user.id;
  const role = asked && shell.roles.has(asked) ? asked : null;
  const rows = await withOrgTx(orgId, async ({ db }) => {
    if (role) return briefs(db, orgId, { ownerRoleKey: role });
    // People handed to me in the last 90 days (field history) that I still own.
    const handed = await db.crmFieldHistory.findMany({
      where: {
        organizationId: orgId,
        targetKind: "person",
        field: "ownerId",
        newValue: { equals: userId },
        changedAt: { gte: daysAgo(90) },
      },
      select: { targetId: true },
      take: 500,
    });
    if (handed.length === 0) return [];
    return briefs(db, orgId, { id: { in: [...new Set(handed.map((h) => h.targetId))] }, ownerId: userId });
  });
  // Nothing handed over lately: no card, unless a link asked for a position's.
  if (rows.length === 0 && !role) return null;
  const title = role
    ? `What ${shell.roles.get(role)?.title ?? "this position"} looks after`
    : "Handed to you";
  return (
    <SettingsCard
      title={title}
      description={
        role
          ? "With a brief on each, so you know where things stand before you write."
          : "People handed to you lately, with what you need before you write."
      }
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody here yet.</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {rows.map((b) => (
            <li key={b.id} className="bg-card ring-foreground/6 rounded-card space-y-2 p-4 ring-1">
              <Link
                href={crmRecordHref(orgSlug, "person", b.id)}
                className="heading text-[15px] hover:underline"
              >
                {b.name}
              </Link>
              {b.lines.map((l, i) => (
                <p key={i} className="text-sm">
                  {l}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
