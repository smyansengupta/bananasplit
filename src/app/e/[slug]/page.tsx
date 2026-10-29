import "../rsvp.css";

import {
  CalendarPlus,
  ChevronDown,
  DoorOpen,
  ExternalLink,
  Lock,
  MapPin,
  Mic,
  Video,
} from "@/components/icons";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Logo } from "@/components/brand/logo";
import { pill } from "@/components/brand/pill";
import { ThemeSwitch } from "@/components/brand/theme-switch";
import { BringList, ChipIn, InviteFriends, TicketStub } from "@/components/rsvp/guest-extras";
import { HostYourOwn } from "@/components/rsvp/host-your-own";
import { InstagramLink } from "@/components/rsvp/instagram-link";
import { MapEmbed } from "@/components/rsvp/map-embed";
import { QrCode } from "@/components/rsvp/qr-code";
import { RegistrationCard } from "@/components/rsvp/registration-card";
import { SharePage } from "@/components/rsvp/share-page";
import { StickyRegister } from "@/components/rsvp/sticky-register";
import { OrgThemeRoot } from "@/components/theme/org-theme-root";
import { PublicThemeRoot } from "@/components/theme/public-theme-root";
import { Gauge } from "@/components/ui/meters";
import { avatarTint } from "@/components/user-avatar";
import { appUrl } from "@/lib/app-url";
import { clubIcons, FALLBACK_CARDS } from "@/lib/metadata/share";
import { orgLogoVariants } from "@/lib/org-logo";
import {
  googleCalendarUrl,
  initials,
  mapsEmbedUrl,
  mapsSearchUrl,
  splitLocation,
} from "@/lib/rsvp/format";
import { dateLine, dateTile, startShort, timeLine } from "@/lib/rsvp/when";
import { getPublicOrgTheme } from "@/lib/theme/loader";
import { themeProviderMode } from "@/lib/theme/resolve";
import { cn } from "@/lib/utils";
import {
  loadRsvpPage,
  rsvpPageTarget,
  type RsvpGuest,
  type RsvpPageData,
} from "@/server/rsvp/page";
import { readRsvpManageKey, rsvpCookieName } from "@/server/rsvp/token";

/**
 * A public RSVP page (docs/features/rsvp.md): anyone with the link sees the
 * event and signs up. Rendered per request (the counts move, and the card
 * depends on this browser's sign-up cookie). Not indexed: a club's event is
 * shared by link, not found by search.
 *
 * Moonstone (redesign guide 10.2): the hosting club's whole theme, dark
 * first, on its own ground with the corona lit in the host's chosen colour.
 * A glass bar on top. Left: the cover and one people card (how full, who's
 * going, who's hosting). Right: the title, the when block with Register and
 * Add to calendar, then surface cards (sign up, bring list, about, where).
 */
export const dynamic = "force-dynamic";

/**
 * The page's data, once per request: generateMetadata and the page both
 * ask for it with the same slug and ?via=, and cache() hands the second
 * caller the first one's result instead of reading it all again.
 */
const targetFor = cache((slug: string) => rsvpPageTarget(slug));

const load = cache(async (slug: string, via: string | null): Promise<RsvpPageData | null> => {
  const target = await targetFor(slug);
  if (!target) return null;
  const viewerId = readRsvpManageKey((await cookies()).get(rsvpCookieName(target.eventId))?.value);
  return loadRsvpPage(slug, target, viewerId, { via });
});

/** The hosting club's theme (colours, default mode, lock, look and feel). */
const clubTheme = cache(async (slug: string) => {
  const target = await targetFor(slug);
  return target ? getPublicOrgTheme(target.organizationId) : null;
});

/** ?via= from a guest's invite link (one value, the code's own shape). */
function viaParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && /^[a-z0-9]{6,12}$/.test(value) ? value : null;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/e/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await load(slug, viaParam((await searchParams).via));
  if (!page) return { title: "Event not found", robots: { index: false } };
  const when = `${dateLine(page.startsAt, page.timeZone)}, ${timeLine(page.startsAt, page.endsAt, page.timeZone, page.allDay)}`;
  const description = `${when}. Hosted by ${page.org.name}.`;
  // The cover first; failing that the host club's logo, so an event with no
  // picture still previews as that club's; failing both, the drawn event
  // card (public/og/event.png, not a file beside this page: one there would
  // outrank the cover).
  const club = await clubTheme(slug);
  const logo = orgLogoVariants(club?.logo);
  const picture = page.cover
    ? { url: page.cover.s960, width: 960, height: 960 }
    : logo
      ? { url: logo.s512, width: 512, height: 512 }
      : { url: FALLBACK_CARDS.event.url, width: 1200, height: 630 };
  return {
    title: `${page.title}, hosted by ${page.org.name}`,
    description,
    robots: { index: false, follow: false },
    // The tab wears the host club's picture, like the club's own pages.
    ...(logo ? { icons: clubIcons(club?.logo) } : {}),
    openGraph: {
      title: page.title,
      description,
      url: appUrl(`/e/${slug}`),
      images: [picture],
    },
    // Without this, X shows the site-wide card instead. A logo is square, so
    // it takes the small card; a cover or the drawn card, the big one.
    twitter: {
      card: !page.cover && logo ? "summary" : "summary_large_image",
      images: [picture.url],
    },
  };
}

export default async function RsvpPage({ params, searchParams }: PageProps<"/e/[slug]">) {
  const { slug } = await params;
  const via = viaParam((await searchParams).via);
  const page = await load(slug, via);
  // A real 404 (not-found.tsx), so link checkers and crawlers see it's gone.
  if (!page) notFound();
  const club = await clubTheme(slug);
  const modeLocked = club ? Boolean(themeProviderMode(club.theme).forcedTheme) : false;

  const viewer = page.viewer;
  const going = viewer?.status === "GOING";
  const open = !page.closed && !viewer;
  const pageUrl = appUrl(`/e/${page.slug}`);
  const calendarUrl = googleCalendarUrl({
    title: page.title,
    startsAt: page.startsAt,
    endsAt: page.endsAt,
    allDay: page.allDay,
    timeZone: page.timeZone,
    details: pageUrl,
    location: page.location,
  });
  const registerLabel = page.waitlistOnly ? "Join the waitlist" : "Register";

  const body = (
    <div
      className={cn(
        "brand rsvp-page flex min-h-svh flex-1 flex-col",
        `rsvp-glow-${page.background.id}`,
      )}
    >
      {page.background.id === "cover" && page.cover && (
        <div aria-hidden="true" className="rsvp-cover-light">
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored WebP variant */}
          <img src={page.cover.s480} alt="" />
        </div>
      )}

      {/* The glass bar: floating chrome, the one glass surface on the page. */}
      <header className="sticky top-3 z-30 mx-auto w-full max-w-[1120px] px-4 sm:px-10">
        <div className="glass-light flex h-14 items-center justify-between gap-3 rounded-full pr-2 pl-5">
          <Link href="/" aria-label="Bananasplit home page" className="flex-none">
            <Logo size={22} textSize={16} />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <StatusChip page={page} />
            {open && (
              <a href="#register" className={cn(pill({ size: "sm" }), "max-sm:hidden")}>
                {registerLabel}
              </a>
            )}
          </div>
        </div>
      </header>

      {/*
        Two columns. Left: the cover, then one card for the people (how
        full it is, who's going, who's hosting). Right: the title, the when
        block with the big Register button, then sign-up and the rest. On a
        phone: cover, title, when, people, sign-up, the rest.
      */}
      <main className="mx-auto grid w-full max-w-[1120px] flex-1 grid-cols-1 gap-[18px] px-4 pt-8 pb-28 sm:px-10 md:grid-cols-[340px_minmax(0,1fr)] md:items-start md:gap-x-[30px] md:pt-14 md:pb-16">
        <div className="flex flex-col gap-[18px] max-md:contents">
          <Cover page={page} />
          <People page={page} />
        </div>

        <div className="flex min-w-0 flex-col gap-[18px] max-md:contents">
          <div className="rsvp-rise flex min-w-0 flex-col gap-[18px] max-md:order-2">
            <div className="flex flex-col gap-4 md:pt-2">
              {page.invitedBy && !viewer && (
                <p className="bg-card edge m-0 inline-flex w-fit items-center gap-2 rounded-full py-1 pr-4 pl-1 text-[14px] font-semibold">
                  <Avatar name={page.invitedBy} label={initials(page.invitedBy)} size="sm" />
                  {page.invitedBy} invited you
                </p>
              )}
              <h1 className="font-heading m-0 text-[clamp(2.5rem,1.6rem+3.6vw,4rem)] leading-[0.98] font-[640] tracking-[-0.038em] text-balance break-words">
                {page.title}
              </h1>
            </div>
            <WhenBlock
              page={page}
              open={open}
              going={going}
              registerLabel={registerLabel}
              calendarUrl={calendarUrl}
              pageUrl={pageUrl}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-[18px] max-md:order-4">
            {/* After it ends, only a guest who signed up still has a card here. */}
            {(!page.ended || viewer) && (
              <div id="register" className="rsvp-rise [animation-delay:60ms]">
                <RegistrationCard
                  slug={page.slug}
                  viewer={page.viewer}
                  closed={page.closed}
                  waitlistOnly={page.waitlistOnly}
                  spotsLeft={page.spotsLeft}
                  joinUrl={page.joinUrl}
                  googleCalendarUrl={calendarUrl}
                  icsUrl={`/e/${page.slug}/calendar.ics`}
                  via={via}
                  cost={
                    page.cost
                      ? {
                          mode: page.cost.mode,
                          shareIfJoining: page.cost.shareIfJoining,
                          payWith: page.cost.payWith,
                        }
                      : null
                  }
                  signedExtras={
                    viewer ? (
                      <>
                        {viewer.owes !== null && page.cost && (
                          <ChipIn
                            slug={page.slug}
                            owes={viewer.owes}
                            note={page.cost.note}
                            split={page.cost.mode === "SPLIT"}
                            payLinks={viewer.payLinks}
                            paid={viewer.paid}
                          />
                        )}
                        {going && !page.ended && (
                          <TicketStub
                            ticketUrl={viewer.ticketUrl}
                            checkedIn={viewer.checkedIn}
                            qr={
                              <QrCode
                                value={viewer.ticketUrl}
                                label="Your ticket"
                                className="size-full"
                              />
                            }
                          />
                        )}
                        {!page.ended && (
                          <InviteFriends
                            inviteUrl={viewer.inviteUrl}
                            invitedCount={viewer.invitedCount}
                            title={page.title}
                          />
                        )}
                      </>
                    ) : null
                  }
                />
              </div>
            )}

            {page.items.length > 0 && (
              <Panel title="Bring list" count={page.items.length}>
                <BringList
                  slug={page.slug}
                  items={page.items}
                  canClaim={Boolean(viewer) && !page.ended}
                />
              </Panel>
            )}

            {page.description && (
              <Panel title="About">
                <p className="m-0 max-w-[62ch] text-[15px] leading-[1.6] whitespace-pre-line">
                  {page.description}
                </p>
              </Panel>
            )}

            {(page.location || page.locationDetails) && <Where page={page} />}
          </div>
        </div>
      </main>

      {open && (
        <StickyRegister
          label={registerLabel}
          detail={
            page.waitlistOnly
              ? "This event is full"
              : page.spotsLeft !== null
                ? `${page.spotsLeft} ${page.spotsLeft === 1 ? "spot" : "spots"} left`
                : startShort(page.startsAt, page.timeZone, page.allDay, new Date())
          }
        />
      )}

      <HostYourOwn />

      <footer className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-4 px-4 pb-10 sm:px-10">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-[13px]"
        >
          Event page by <Logo size={16} textSize={13} />
        </Link>
        {!modeLocked && <ThemeSwitch />}
      </footer>
    </div>
  );

  return club ? (
    <OrgThemeRoot theme={club.theme}>{body}</OrgThemeRoot>
  ) : (
    <PublicThemeRoot>{body}</PublicThemeRoot>
  );
}

/*
 * Block colours (src/components/ui/block-card.tsx, a client module, so the
 * classes are repeated here for this server page): "Coming up" and
 * "Progress", with their meta colour for the small lines.
 */
const QUIET_BLOCK =
  "bg-block-quiet text-block-quiet-foreground ring-1 ring-inset ring-block-quiet-foreground/10 [--meta:var(--block-quiet-meta)]";
const GOAL_BLOCK =
  "bg-block-goal text-block-goal-foreground [--meta:var(--block-goal-meta)] [--ring-bg:var(--block-goal)]";

/** The bar's status, in words: only when it changes what a guest can do. */
function StatusChip({ page }: { page: RsvpPageData }) {
  const status = page.ended
    ? { label: "This event has ended", dot: "bg-muted-foreground" }
    : page.closed === "closed"
      ? { label: "Registration closed", dot: "bg-muted-foreground" }
      : page.closed === "full"
        ? { label: "Full", dot: "bg-destructive" }
        : page.waitlistOnly
          ? { label: "Waitlist open", dot: "bg-glow" }
          : null;
  if (!status) return null;
  return (
    <span className="bg-muted text-foreground inline-flex h-8 min-w-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold">
      <span className={cn("size-1.5 flex-none rounded-full", status.dot)} aria-hidden="true" />
      <span className="truncate">{status.label}</span>
    </span>
  );
}

/**
 * When and where, under the title (a "Coming up" block: it needs nothing
 * from the guest yet), with the one big Register button and Add to
 * calendar. Who's going lives in the people card, not here.
 */
function WhenBlock({
  page,
  open,
  going,
  registerLabel,
  calendarUrl,
  pageUrl,
}: {
  page: RsvpPageData;
  open: boolean;
  going: boolean;
  registerLabel: string;
  calendarUrl: string;
  pageUrl: string;
}) {
  const place = page.location ? splitLocation(page.location) : null;
  const where = place
    ? { icon: MapPin, text: [place.venue, place.rest].filter(Boolean).join(", ") }
    : page.online
      ? {
          icon: Video,
          text: page.joinUrl
            ? "Online. Your join link is in your registration."
            : "Online. The join link comes when you sign up.",
        }
      : page.locationHidden
        ? { icon: Lock, text: "The address comes when you sign up." }
        : null;
  const onBlock =
    "border border-block-quiet-foreground/25 text-block-quiet-foreground hover:bg-block-quiet-foreground/10";

  return (
    <section
      aria-label="When and where"
      className={cn(QUIET_BLOCK, "rounded-block relative z-10 flex flex-col gap-5 p-6 sm:p-7")}
    >
      <div className="flex items-start gap-4">
        <DateTile start={page.startsAt} timeZone={page.timeZone} />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="display-title m-0 text-[clamp(1.375rem,1.1rem+1vw,1.75rem)]">
            {page.ended ? "This event has ended" : dateLine(page.startsAt, page.timeZone)}
          </h2>
          <p className="m-0 text-[15px] text-(--meta)">
            {page.ended
              ? dateLine(page.startsAt, page.timeZone)
              : timeLine(page.startsAt, page.endsAt, page.timeZone, page.allDay)}
          </p>
        </div>
      </div>

      {where && (
        <p className="m-0 flex items-start gap-2.5 text-[15px] leading-[1.45]">
          <where.icon
            className="mt-0.5 size-[18px] flex-none text-(--meta)"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          {where.text}
        </p>
      )}

      {!page.ended && (
        <div className="flex flex-wrap items-center gap-2.5">
          {open ? (
            <a
              id="hero-cta"
              href="#register"
              className="bg-block-quiet-foreground text-block-quiet inline-flex h-12 flex-1 items-center justify-center rounded-full px-8 text-[16px] font-semibold transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97] sm:flex-none"
            >
              {registerLabel}
            </a>
          ) : going ? (
            <span className="bg-block-goal text-block-goal-foreground inline-flex h-12 items-center gap-2.5 rounded-full pr-6 pl-3 text-[16px] font-semibold">
              <span className="grid size-7 place-items-center rounded-full bg-white/20">
                <CheckMark />
              </span>
              You&apos;re going
            </span>
          ) : null}
          <CalendarMenu
            googleUrl={calendarUrl}
            icsUrl={`/e/${page.slug}/calendar.ics`}
            className={onBlock}
          />
          <SharePage url={pageUrl} title={page.title} className={cn(onBlock, "size-12")} />
        </div>
      )}
    </section>
  );
}

/** The calendar page's tile: the month on top, the day big. */
function DateTile({ start, timeZone }: { start: Date; timeZone: string }) {
  const tile = dateTile(start, timeZone);
  return (
    <span className="bg-block-quiet-foreground text-block-quiet flex w-14 flex-none flex-col overflow-hidden rounded-[14px] text-center">
      <span className="pt-1.5 text-[11px] font-semibold">
        {tile.month.charAt(0) + tile.month.slice(1).toLowerCase()}
      </span>
      <span className="numeral pb-2 text-[26px]">{tile.day}</span>
    </span>
  );
}

/**
 * Add to calendar: one pill that opens a small menu (Google, or a file for
 * Apple Calendar and Outlook). A <details>, so it works without scripts.
 */
function CalendarMenu({
  googleUrl,
  icsUrl,
  className,
}: {
  googleUrl: string;
  icsUrl: string;
  className?: string;
}) {
  const item =
    "hover:bg-muted flex h-10 items-center gap-2.5 rounded-[12px] px-3 text-[14px] font-medium";
  return (
    <details className="group relative">
      <summary
        className={cn(
          "inline-flex h-12 cursor-pointer list-none items-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-[background-color,transform] duration-150 select-none active:scale-[0.97] [&::-webkit-details-marker]:hidden",
          className,
        )}
      >
        <CalendarPlus className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
        Add to calendar
        <ChevronDown
          className="size-4 transition-transform duration-200 group-open:rotate-180"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </summary>
      <div className="bg-popover text-popover-foreground shadow-e2 rounded-tile absolute top-full left-0 z-20 mt-2 flex w-60 flex-col p-1.5">
        <a href={googleUrl} target="_blank" rel="noopener noreferrer" className={item}>
          Google Calendar
        </a>
        <a href={icsUrl} className={item}>
          Apple Calendar or Outlook
        </a>
      </div>
    </details>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OrgMark({ page }: { page: RsvpPageData }) {
  const box = "size-10 rounded-[12px] text-[17px]";
  return page.org.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- a stored 64px WebP variant
    <img src={page.org.logoUrl} alt="" className={cn("flex-none object-cover", box)} />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        "bg-primary text-primary-foreground font-heading grid flex-none place-items-center",
        box,
      )}
    >
      {page.org.name.trim()[0]?.toUpperCase()}
    </span>
  );
}

function Cover({ page }: { page: RsvpPageData }) {
  const frame =
    "rsvp-rise rounded-card aspect-square w-full shadow-e2 max-md:order-1 max-md:max-w-[420px] max-md:justify-self-center";
  if (page.cover) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a stored WebP variant
      <img
        src={page.cover.s960}
        alt=""
        width={960}
        height={960}
        className={cn(frame, "object-cover")}
      />
    );
  }
  // No cover yet: the event's initial, lit by the glow.
  return (
    <div
      aria-hidden="true"
      className={cn(
        frame,
        "bg-card edge relative grid place-items-center overflow-hidden",
        "bg-[radial-gradient(110%_90%_at_22%_12%,color-mix(in_oklab,var(--rsvp-light)_50%,transparent),transparent_68%)]",
      )}
    >
      <span className="font-heading text-[150px] leading-none font-[640] tracking-[-0.05em]">
        {page.title.trim()[0]?.toUpperCase() ?? "B"}
      </span>
    </div>
  );
}

/** A surface card (level 1): heading on space, no rule under it. */
function Panel({
  title,
  count,
  children,
  className,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("bg-card edge rounded-card flex flex-col gap-4 p-6", className)}>
      <div className="flex items-center gap-2.5">
        <h2 className="heading m-0 text-[17px]">{title}</h2>
        {count !== undefined && <CountChip>{count}</CountChip>}
      </div>
      {children}
    </section>
  );
}

function CountChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[12px] font-semibold tabular-nums">
      {children}
    </span>
  );
}

function IconChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-muted text-foreground grid size-10 flex-none place-items-center rounded-full">
      {children}
    </span>
  );
}

/**
 * The people card, under the cover: how full it is (the Progress block,
 * with the seat gauge, when there's a cap), who's going (a face stack that
 * opens into the full list), and who's hosting. One card, so the counts are
 * said once.
 */
function People({ page }: { page: RsvpPageData }) {
  const count = page.going;
  const guests = page.guests ?? [];
  const capped = page.capacity !== null && count !== null;
  const left = capped ? Math.max(0, page.capacity! - count!) : null;

  return (
    <section
      aria-label="Who's going"
      className="rsvp-rise bg-card edge rounded-card flex flex-col gap-1 p-2 [animation-delay:120ms] max-md:order-3"
    >
      {capped ? (
        <div className={cn(GOAL_BLOCK, "rounded-block flex items-center gap-3 p-5")}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <b className="numeral text-[40px]">{count}</b>
            <span className="text-[15px] font-semibold">{page.ended ? "went" : "going"}</span>
            <span className="text-[13px] text-(--meta)">
              {page.ended
                ? `${page.capacity} spots in all`
                : left === 0
                  ? `Every spot is taken${page.waitlisting ? `, ${page.waitlisting} waitlisted` : ""}`
                  : `${left} of ${page.capacity} ${left === 1 ? "spot" : "spots"} left`}
            </span>
          </div>
          <Gauge value={(count! / page.capacity!) * 100} size={104} />
        </div>
      ) : count !== null ? (
        <div className="flex items-baseline gap-2 px-4 pt-4">
          <b className="numeral text-[32px]">{count}</b>
          <span className="text-muted-foreground text-[15px]">
            {page.ended ? "went" : "going"}
            {page.waitlisting ? `, ${page.waitlisting} waitlisted` : ""}
          </span>
        </div>
      ) : null}

      {count !== null && count > 0 && page.guests && <GuestList page={page} guests={guests} />}
      {count === 0 && (
        <p className="text-muted-foreground m-0 px-4 pt-3 text-[14px]">
          {page.ended ? "No one signed up." : "No one yet. Be the first to sign up."}
        </p>
      )}

      <div className="flex flex-col gap-3 px-4 pt-4 pb-4">
        <h2 className="text-muted-foreground m-0 text-[13px] font-medium">Hosted by</h2>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          <li className="flex items-center gap-3">
            <OrgMark page={page} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[15px] font-semibold">{page.org.name}</span>
              <span className="text-muted-foreground text-[13px]">Organization</span>
            </span>
          </li>
          {page.host && (
            <li className="flex items-center gap-3">
              <IconChip>
                <Mic className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
              </IconChip>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-semibold">{page.host}</span>
                <span className="text-muted-foreground text-[13px]">Host</span>
              </span>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

/** Faces in the stack before "+N". */
const AVATARS = 5;

/** Who's going: a face stack that opens into the full list. */
function GuestList({ page, guests }: { page: RsvpPageData; guests: RsvpGuest[] }) {
  const count = page.going ?? guests.length;
  return (
    <details className="group">
      <summary className="hover:bg-muted/60 rounded-tile flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center" aria-hidden="true">
          {guests.slice(0, AVATARS).map((g, i) => (
            <Avatar
              key={i}
              name={g.name}
              label={g.initials}
              className={cn("ring-card ring-2", i > 0 && "-ml-2")}
            />
          ))}
          {count > AVATARS && (
            <span className="bg-muted ring-card -ml-2 grid h-9 min-w-9 place-items-center rounded-full px-2 text-[12px] font-bold ring-2">
              +{count - AVATARS}
            </span>
          )}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[14px] font-semibold">
          <span className="group-open:hidden">See all</span>
          <span className="hidden group-open:inline">Hide</span>
          <ChevronDown
            className="size-4 transition-transform duration-200 group-open:rotate-180"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </span>
      </summary>
      {/* One name a line, in full, with their Instagram when they shared it. */}
      <ul className="divide-border m-0 flex max-h-[420px] list-none flex-col divide-y overflow-y-auto px-4 pb-1">
        {guests.map((g, i) => (
          <GuestRow key={i} guest={g} />
        ))}
        {count > guests.length && (
          <li className="text-muted-foreground py-2 text-[14px]">
            and {count - guests.length} more
          </li>
        )}
      </ul>
    </details>
  );
}

function Where({ page }: { page: RsvpPageData }) {
  const place = page.location ? splitLocation(page.location) : null;
  return (
    <Panel title="Location">
      {place && (
        <div className="flex items-center gap-3.5">
          <IconChip>
            <MapPin className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </IconChip>
          <span className="flex min-w-0 flex-col">
            <span className="text-[16px] font-semibold break-words">{place.venue}</span>
            {place.rest && <span className="text-muted-foreground text-[14px]">{place.rest}</span>}
          </span>
        </div>
      )}
      {page.locationDetails && (
        <div className="bg-muted/60 rounded-tile flex gap-3 p-4">
          <DoorOpen
            className="text-muted-foreground mt-0.5 size-5 flex-none"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-semibold">How to find it</span>
            <p className="text-muted-foreground m-0 text-[14px] leading-[1.55] whitespace-pre-line">
              {page.locationDetails}
            </p>
          </div>
        </div>
      )}
      {page.location && (
        <>
          <MapEmbed
            title={`Map of ${place?.venue ?? "the location"}`}
            src={mapsEmbedUrl(page.location)}
          />
          <a
            href={mapsSearchUrl(page.location)}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(pill({ tone: "outline", size: "sm" }), "self-start")}
          >
            <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
            Open in Google Maps
          </a>
        </>
      )}
    </Panel>
  );
}

function Avatar({
  name,
  label,
  size = "md",
  className,
}: {
  name: string;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid flex-none place-items-center rounded-full font-bold",
        size === "sm" ? "size-7 text-[11px]" : "size-9 text-[12px]",
        avatarTint(name),
        className,
      )}
    >
      {label}
    </span>
  );
}

function GuestRow({ guest }: { guest: RsvpGuest }) {
  return (
    <li className="flex min-h-12 items-center gap-3 py-1.5">
      <Avatar name={guest.name} label={guest.initials} />
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{guest.name}</span>
      {guest.instagramUrl && <InstagramLink url={guest.instagramUrl} name={guest.name} />}
    </li>
  );
}
