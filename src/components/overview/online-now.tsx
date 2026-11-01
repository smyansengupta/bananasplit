"use client";

import Link from "next/link";

import { useLivePeople, type OnlinePeople } from "@/components/shell/presence-store";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";

/**
 * Who's online now, beside the date under Overview's greeting: a few faces
 * (yours when you're the only one) and how many members are here, opening
 * People on its Online filter. Follows the shell's heartbeat (PresenceBeat)
 * after the first paint.
 */
export function OnlineNow({
  orgId,
  orgSlug,
  you,
  initial,
}: {
  orgId: string;
  orgSlug: string;
  you: UserAvatarUser & { id: string };
  initial: OnlinePeople;
}) {
  const people = useLivePeople(orgId) ?? initial;
  const faces = people.faces.length > 0 ? people.faces : [you];
  const label = `${people.count} ${people.count === 1 ? "member" : "members"} online`;
  return (
    <Link
      href={`/app/${orgSlug}/people?online=1`}
      className="focus-glow hover:text-foreground inline-flex items-center gap-2 rounded-full align-middle whitespace-nowrap outline-none"
    >
      <span className="relative flex shrink-0">
        {faces.map((face, i) => (
          <span key={face.id} className={i > 0 ? "-ml-1.5" : undefined}>
            <UserAvatar user={face} size="xs" className="ring-background ring-2" />
          </span>
        ))}
        <span
          aria-hidden="true"
          className="bg-success ring-background absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2"
        />
      </span>
      {label}
    </Link>
  );
}
