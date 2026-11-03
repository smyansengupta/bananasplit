"use client";

import { Mail, MessageCircle, Send, Users } from "@/components/icons";

import { sendMemberNoteAction } from "@/app/app/[orgSlug]/people/actions";
import { resendInvitation } from "@/app/app/[orgSlug]/settings/members/actions";
import { AmbientActions } from "@/components/ambient/ambient-button";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";

/**
 * People's ambient rows, over the list (Buttons canvas, People): someone
 * who joined this week, with Say hi and Add to a team, and an invite left
 * three days, with Resend invite. Gone once there's nothing to do.
 */

export interface Newcomer {
  id: string;
  name: string | null;
  user: UserAvatarUser;
  /** "Joined 2 days ago, no team yet". */
  reason: string;
  hasTeam: boolean;
  /** The viewer already said hi. */
  saidHi?: boolean;
}

export interface WaitingInvite {
  id: string;
  email: string;
  /** "Invited 4 days ago". */
  reason: string;
}

export function PeopleAmbient({
  orgId,
  orgSlug,
  newcomers,
  invites,
}: {
  orgId: string;
  orgSlug: string;
  newcomers: Newcomer[];
  invites: WaitingInvite[];
}) {
  if (newcomers.length === 0 && invites.length === 0) return null;
  const row = "flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5";
  return (
    <section
      aria-label="New and invited"
      className="bg-card edge rounded-card divide-border/70 divide-y px-[18px] py-1.5 sm:px-6"
    >
      {newcomers.map((p) => {
        const first = p.name?.trim().split(/\s+/)[0] ?? "them";
        return (
          <div key={p.id} className={row}>
            <UserAvatar user={p.user} size="md" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-semibold break-words">{p.name ?? "New member"}</span>
              <span className="text-muted-foreground"> joined this week</span>
            </span>
            <AmbientActions
              why
              actions={[
                !p.saidHi && {
                  key: "hi",
                  label: "Say hi",
                  icon: MessageCircle,
                  reason: p.reason,
                  tone: "solid",
                  ariaLabel: `Say hi to ${first}`,
                  run: () => sendMemberNoteAction(orgId, p.id, "hi"),
                  done: `Said hi to ${first}`,
                },
                !p.hasTeam && {
                  key: "team",
                  label: "Add to a team",
                  icon: Users,
                  reason: p.reason,
                  href: `/app/${encodeURIComponent(orgSlug)}/people?view=chart`,
                },
              ]}
            />
          </div>
        );
      })}
      {invites.map((i) => (
        <div key={i.id} className={row}>
          <span className="bg-muted grid size-8 shrink-0 place-items-center rounded-full">
            <Mail className="size-3.5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 text-sm break-all">{i.email}</span>
          <AmbientActions
            why
            actions={[
              {
                key: "resend",
                label: "Resend invite",
                icon: Send,
                reason: i.reason,
                ariaLabel: `Resend the invite to ${i.email}`,
                run: () => resendInvitation(orgId, i.id),
                done: "Resent",
              },
            ]}
          />
        </div>
      ))}
    </section>
  );
}
