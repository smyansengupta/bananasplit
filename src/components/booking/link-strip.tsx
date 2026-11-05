"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import { orgInitials } from "@/lib/theme/logo";
import type { BookingLinkState } from "@/server/booking/view";

import { LinkAction, LinkMenu } from "./link-ambient";

/**
 * A meeting link as one bar across the top of the page, the shape of Video
 * calls on Meetings: a picture, its name and a line, then the short link as a
 * quiet pill and the one thing to do. In an organization it's the
 * organization's own link, so the picture is the organization's and its hosts
 * are only a small stack of faces at the end. In a Personal space it's yours,
 * and `children` is your week under it.
 *
 * One line wherever there's room (it goes by its own width, since the sidebar
 * takes some of the page; the pill gives way first), then two rows.
 */

type Face = UserAvatarUser & { id: string; name: string };

/** The most faces a strip shows before it counts the rest. */
const FACES = 3;

function Faces({ people }: { people: readonly Face[] }) {
  const extra = people.length - FACES;
  const names = people.map((p) => p.name).join(", ");
  return (
    <span role="img" aria-label={`Hosts: ${names}`} title={names} className="flex shrink-0 items-center">
      {people.slice(0, FACES).map((p) => (
        <UserAvatar key={p.id} user={p} size="sm" className="ring-card -me-1.5 ring-2 last:me-0" />
      ))}
      {extra > 0 && <span className="text-muted-foreground ps-2.5 text-xs font-medium tabular-nums">+{extra}</span>}
    </span>
  );
}

/** The organization's picture, or its initials on the same tile. */
export function OrgFace({ name, logo }: { name: string; logo: string | null }) {
  const tile = "size-12 shrink-0 rounded-[14px]";
  return logo ? (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP variant
    <img src={logo} alt="" width={48} height={48} className={`${tile} bg-background object-contain`} />
  ) : (
    <span
      aria-hidden="true"
      className={`${tile} bg-foreground text-background grid place-items-center text-sm font-semibold`}
    >
      {orgInitials(name)}
    </span>
  );
}

/** The link's address without the scheme, for the pill. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function LinkStrip({
  orgId,
  link,
  name,
  picture,
  line,
  hosts = [],
  onEdit,
  menu,
  more,
  children,
}: {
  orgId: string;
  link: BookingLinkState;
  /** What its buttons are about, for screen readers. */
  name: string;
  picture: ReactNode;
  line: string;
  hosts?: readonly Face[];
  onEdit: () => void;
  /** More items for its menu. */
  menu?: ReactNode;
  /** The quiet control for the organization's other links. */
  more?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="@container">
      <section
        aria-label={link.title}
        className="bg-card text-card-foreground edge rounded-card flex flex-col gap-4 px-5 py-4.5"
      >
        <div className="flex flex-col gap-x-5 gap-y-3.5 @2xl:flex-row @2xl:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            {picture}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <h2 className="display-title line-clamp-2 min-w-0 text-[19px] leading-snug @2xl:block @2xl:truncate">
                  {link.title}
                </h2>
                {!link.active ? (
                  <Badge variant="secondary">Off</Badge>
                ) : (
                  link.openSoon === 0 && <Badge variant="destructive">No open times</Badge>
                )}
              </span>
              <span className="text-muted-foreground text-[13px] @2xl:truncate">{line}</span>
            </div>
            {hosts.length > 0 && <Faces people={hosts} />}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 @2xl:flex-nowrap">
            {link.active && (
              <span
                title={link.url}
                className="bg-muted text-muted-foreground block h-8 min-w-0 flex-1 truncate rounded-full px-3 text-[13px] leading-8 font-medium @2xl:hidden @4xl:block @4xl:max-w-52 @4xl:flex-none"
              >
                {shortUrl(link.url)}
              </span>
            )}
            <LinkAction orgId={orgId} link={link} name={name} onEdit={onEdit} />
            <LinkMenu orgId={orgId} link={link} name={name} onEdit={onEdit}>
              {menu}
            </LinkMenu>
            {more}
          </div>
        </div>
        {children && <div className="border-border/70 border-t pt-3.5 pb-1">{children}</div>}
      </section>
    </div>
  );
}
