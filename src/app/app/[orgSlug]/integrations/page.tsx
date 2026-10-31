import Link from "next/link";

import { BrandMark } from "@/components/marketing/brand-mark";
import type { Brand } from "@/components/marketing/brands";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageTabs } from "@/components/ui/page-tabs";
import { can } from "@/lib/auth/permissions";
import { brandOr, INTEGRATION_MARKS as M } from "@/lib/integrations/marks";
import { sectionLabel } from "@/lib/nav/sidebar";
import { cn } from "@/lib/utils";
import { planGate } from "@/server/billing/plan-gate";
import { loadMeetingConnections } from "@/server/conference/connections";
import { getOrgContextBySlug } from "@/server/db/context";
import { resolveOrgMailRouting } from "@/server/email/mailer";
import { loadIntegrations } from "@/server/integrations/service";

/**
 * Integrations: every app an organization can connect, in one grid, as the sidebar's
 * own page (it used to be a page deep in the Admin panel). What works today
 * shows its state and a Connect or Manage button; what's planned shows
 * "Coming soon", so each can be wired up later without moving anything.
 *
 * Owners and admins connect (the setup pages under Admin panel ›
 * Integrations still do the work); everyone else sees what's on.
 */

type State = "connected" | "attention" | "off" | "soon";

interface Tile {
  key: string;
  brand: Brand;
  name: string;
  body: string;
  state: State;
  /** Where Connect or Manage goes, for those who can. */
  href?: string;
  /** A meeting provider connects straight from here (a POST to its OAuth start). */
  connectSlug?: string;
}

export default async function IntegrationsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/integrations">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const show = sp.show === "connected" ? "connected" : sp.show === "soon" ? "soon" : "all";
  const planLock = await planGate(orgSlug, "integrations");
  if (planLock) return planLock;
  const ctx = await getOrgContextBySlug(orgSlug);
  const { organization: org } = ctx;
  const canManage = can({ role: ctx.role }, "integrations.write");
  const base = `/app/${orgSlug}`;
  const setup = (segment: string) => `${base}/integrations/${segment}`;

  const [dtos, meetings, mail] = await Promise.all([
    loadIntegrations(org.id),
    loadMeetingConnections(org.id),
    resolveOrgMailRouting(org.id),
  ]);
  const stateOf = (provider: string): State => {
    const dto = dtos.find((d) => d.provider === provider);
    if (!dto) return "off";
    if (dto.status === "CONNECTED") return "connected";
    if (dto.status === "ERROR" || dto.status === "NEEDS_REAUTH") return "attention";
    return "off";
  };
  const meeting = (provider: string): State => {
    const m = meetings.find((x) => x.provider === provider);
    if (!m) return "off";
    if (m.needsReauth) return "attention";
    return m.connected ? "connected" : "off";
  };
  const slugOf = (provider: string) => meetings.find((x) => x.provider === provider)?.slug;

  const groups: { name: string; tiles: Tile[] }[] = [
    {
      name: "Messaging",
      tiles: [
        {
          key: "imessage",
          brand: M.imessage,
          name: "iMessage",
          body: "Text Bananasplit to add tasks, RSVP and answer polls.",
          state: "soon",
        },
        {
          key: "sms",
          brand: M.sms,
          name: "Text messages",
          body: "Reminders and polls by text for anyone without iMessage.",
          state: "soon",
        },
        {
          key: "slack",
          brand: M.slack,
          name: "Slack",
          body: "New forms, polls and reminders in a channel.",
          state: "soon",
        },
        {
          key: "discord",
          brand: M.discord,
          name: "Discord",
          body: "The same, for organizations that live on Discord.",
          state: "soon",
        },
        {
          key: "groupme",
          brand: M.groupme,
          name: "GroupMe",
          body: "Announcements and quick polls in the group chat.",
          state: "soon",
        },
        {
          key: "email",
          brand: M.email,
          name: "Email sender",
          body: "Invites and reminders from your organization's own address.",
          // Organization email sends even without a sender of its own (the
          // platform's address), so the tile says Connected unless it's off.
          state:
            stateOf("EMAIL_RESEND") === "attention"
              ? "attention"
              : mail.mode === "none"
                ? "off"
                : "connected",
          href: setup("email"),
        },
      ],
    },
    {
      name: "Calendar, mail and school",
      tiles: [
        {
          key: "google-calendar",
          brand: brandOr("google-workspace"),
          name: "Google Calendar",
          body: "Your organization's calendar, kept in sync both ways.",
          state: stateOf("GOOGLE_CALENDAR"),
          href: setup("google-calendar"),
        },
        {
          key: "gmail",
          brand: brandOr("google-workspace"),
          name: "Gmail",
          body: "Emails and invites become tasks.",
          state: "soon",
        },
        {
          key: "outlook",
          brand: brandOr("outlook"),
          name: "Outlook",
          body: "Calendar and mail for Microsoft schools.",
          state: "soon",
        },
        {
          key: "canvas",
          brand: brandOr("canvas"),
          name: "Canvas",
          body: "Assignment due dates on your calendar.",
          state: "soon",
        },
      ],
    },
    {
      name: "Video calls",
      tiles: (
        [
          ["GOOGLE_MEET", "google-meet", "Google Meet"],
          ["ZOOM", "zoom", "Zoom"],
          ["MICROSOFT_TEAMS", "microsoft-teams", "Microsoft Teams"],
        ] as const
      ).map(([provider, slug, name]) => ({
        key: slug,
        brand: brandOr(slug),
        name,
        body: "A join link on every online meeting.",
        state: meeting(provider),
        connectSlug: slugOf(provider),
        href: `${base}/meetings`,
      })),
    },
    {
      name: "Notes and AI",
      tiles: [
        {
          key: "granola",
          brand: brandOr("granola"),
          name: "Granola",
          body: "Meeting notes file themselves into the meeting.",
          state: "soon",
        },
        {
          key: "wispr-flow",
          brand: brandOr("wispr-flow"),
          name: "Wispr Flow",
          body: "Dictate into notes and tasks.",
          state: "soon",
        },
        {
          key: "claude",
          brand: brandOr("claude"),
          name: "Claude",
          body: "Imports, and answers about your organization's data.",
          state: stateOf("CLAUDE"),
          href: setup("claude"),
        },
        {
          key: "chatgpt",
          brand: brandOr("chatgpt"),
          name: "Other AI models",
          body: "ChatGPT or any compatible model, instead of Claude.",
          state: stateOf("OPENAI_COMPATIBLE"),
          href: setup("ai-model"),
        },
      ],
    },
    {
      name: "Website and data",
      tiles: [
        {
          key: "supabase",
          brand: brandOr("supabase"),
          name: "Supabase",
          body: "Check-ins, sign-ups and votes from your website.",
          state: stateOf("SUPABASE_SOURCE"),
          href: setup("data-source"),
        },
        {
          key: "website",
          brand: M.website,
          name: "Website build hook",
          body: "Rebuilds your site when public events change.",
          state: stateOf("NETLIFY_BUILD_HOOK"),
          href: setup("website"),
        },
      ],
    },
  ];

  const all = groups.flatMap((g) => g.tiles);
  const connectedCount = all.filter((t) => t.state === "connected").length;
  const keep = (t: Tile) =>
    show === "connected"
      ? t.state === "connected" || t.state === "attention"
      : show === "soon"
        ? t.state === "soon"
        : true;

  return (
    <div className="space-y-7.5">
      <PageHeader
        title={sectionLabel(ctx.settings?.sidebar, "integrations")}
        actions={
          canManage ? (
            <Button asChild variant="outline">
              <Link href={`${base}/setup`}>Guided setup</Link>
            </Button>
          ) : null
        }
        tabs={
          <PageTabs
            label="Show"
            tabs={[
              { href: `${base}/integrations`, label: "All", active: show === "all" },
              {
                href: `${base}/integrations?show=connected`,
                label: connectedCount > 0 ? `Connected ${connectedCount}` : "Connected",
                active: show === "connected",
              },
              {
                href: `${base}/integrations?show=soon`,
                label: "Coming soon",
                active: show === "soon",
              },
            ]}
          />
        }
      />

      {groups.map((g) => {
        const tiles = g.tiles.filter(keep);
        if (tiles.length === 0) return null;
        return (
          <section key={g.name} className="space-y-3" aria-labelledby={`int-${g.name}`}>
            <h2 id={`int-${g.name}`} className="heading text-[17px]">
              {g.name}
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tiles.map((t) => (
                <li
                  key={t.key}
                  className={cn(
                    "bg-card text-card-foreground edge rounded-card flex gap-3.5 p-4",
                    t.state === "soon" && "bg-muted/40",
                  )}
                >
                  <span className={cn("shrink-0", t.state === "soon" && "opacity-80")}>
                    <BrandMark brand={t.brand} size={36} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div>
                      <p className="text-[15px] font-semibold">{t.name}</p>
                      <p className="text-muted-foreground mt-0.5 text-[13px] leading-snug">
                        {t.body}
                      </p>
                    </div>
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      <StateBadge state={t.state} />
                      {canManage && t.state !== "soon" && <TileAction tile={t} orgId={org.id} />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function StateBadge({ state }: { state: State }) {
  if (state === "connected") return <Badge variant="success">Connected</Badge>;
  if (state === "attention") return <Badge variant="destructive">Needs reconnecting</Badge>;
  if (state === "soon") return <Badge variant="secondary">Coming soon</Badge>;
  return null;
}

/**
 * Connect (or Manage, once on). A meeting provider that isn't connected yet
 * goes straight to its sign-in from here; everything else opens its setup.
 */
function TileAction({ tile, orgId }: { tile: Tile; orgId: string }) {
  const on = tile.state === "connected";
  if (!on && tile.connectSlug) {
    return (
      <form action={`/api/integrations/conference/${tile.connectSlug}/start`} method="post">
        <input type="hidden" name="orgId" value={orgId} />
        <Button type="submit" size="sm" variant="outline">
          {tile.state === "attention" ? "Reconnect" : "Connect"}
        </Button>
      </form>
    );
  }
  if (!tile.href) return null;
  return (
    <Button size="sm" variant="outline" asChild>
      <Link href={tile.href}>
        {on ? "Manage" : tile.state === "attention" ? "Reconnect" : "Connect"}
      </Link>
    </Button>
  );
}
