import Link from "next/link";
import type { ReactNode } from "react";

import { IntegrationDialog } from "@/components/integrations/integration-dialog";
import { BrandMark } from "@/components/marketing/brand-mark";
import type { Brand } from "@/components/marketing/brands";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { brandOr, INTEGRATION_MARKS as M } from "@/lib/integrations/marks";
import { sectionLabel } from "@/lib/nav/sidebar";
import { cn } from "@/lib/utils";
import { planGate } from "@/server/billing/plan-gate";
import { loadMeetingConnections } from "@/server/conference/connections";
import { getOrgContextBySlug } from "@/server/db/context";
import { resolveOrgMailRouting } from "@/server/email/mailer";
import { loadIntegrations } from "@/server/integrations/service";

import { isPanelApp, loadPanel } from "./panels";

/**
 * Integrations: every app an organization can connect, on one page. What's
 * connected comes first, in its own section; everything else follows by
 * kind, what you can connect today before what's coming. Setting an app up,
 * testing it and disconnecting it happen in a window over this page
 * (`?app=<key>`, src/components/integrations/integration-dialog.tsx), never
 * on a page of its own; the old /integrations/<app> URLs open that window.
 *
 * Owners and admins connect; everyone else sees what's on.
 */

type State = "connected" | "attention" | "off" | "soon";

interface Tile {
  /** Also its window's `?app=` key, when it has one. */
  key: string;
  brand: Brand;
  name: string;
  body: string;
  state: State;
  /** What's connected, once it is ("Connected as ops@…", "Checked Oct 12"). */
  detail?: string;
  /** Opens a window to set it up or manage it. */
  panel?: boolean;
  /** A video-call provider connects in one click (a POST to its OAuth start). */
  connectSlug?: string;
}

const checked = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export default async function IntegrationsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/integrations">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const planLock = await planGate(orgSlug, "integrations");
  if (planLock) return planLock;
  const ctx = await getOrgContextBySlug(orgSlug);
  const { organization: org } = ctx;
  const canManage = can({ role: ctx.role }, "integrations.write");

  const [dtos, meetings, mail] = await Promise.all([
    loadIntegrations(org.id),
    loadMeetingConnections(org.id),
    resolveOrgMailRouting(org.id),
  ]);
  const dtoOf = (provider: string) => dtos.find((d) => d.provider === provider);
  const stateOf = (provider: string): State => {
    const dto = dtoOf(provider);
    if (!dto) return "off";
    if (dto.status === "CONNECTED") return "connected";
    if (dto.status === "ERROR" || dto.status === "NEEDS_REAUTH") return "attention";
    return "off";
  };
  const checkedOn = (provider: string) => {
    const at = dtoOf(provider)?.lastVerifiedAt;
    return at ? `Checked ${checked.format(new Date(at))}` : undefined;
  };
  const stored = (
    key: string,
    provider: string,
    tile: Omit<Tile, "key" | "state" | "panel" | "detail">,
  ): Tile => ({ key, state: stateOf(provider), panel: true, detail: checkedOn(provider), ...tile });

  const groups: { name: string; tiles: Tile[] }[] = [
    {
      name: "Messaging",
      tiles: [
        {
          key: "imessage",
          brand: M.imessage,
          name: "iMessage",
          body: "Text Bananasplit to add tasks, RSVP, answer polls.",
          state: "soon",
        },
        {
          key: "sms",
          brand: M.sms,
          name: "Text messages",
          body: "Reminders and polls by SMS for anyone without iMessage.",
          state: "soon",
        },
        {
          key: "slack",
          brand: M.slack,
          name: "Slack",
          body: "Post polls, new forms and reminders to a channel.",
          state: "soon",
        },
        {
          key: "discord",
          brand: M.discord,
          name: "Discord",
          body: "Same as Slack, for organizations that live on Discord.",
          state: "soon",
        },
        {
          key: "groupme",
          brand: M.groupme,
          name: "GroupMe",
          body: "Announcements and quick polls to the organization chat.",
          state: "soon",
        },
        {
          key: "email",
          brand: M.email,
          name: "Email",
          body: "Invites, reminders and form receipts from your organization's address.",
          // Email sends even without a sender of its own (the platform's
          // address), so it counts as connected unless it's off.
          state:
            stateOf("EMAIL_RESEND") === "attention"
              ? "attention"
              : mail.mode === "none"
                ? "off"
                : "connected",
          detail: mail.mode === "org" ? "From your own address" : "From Bananasplit's address",
          panel: true,
        },
      ],
    },
    {
      name: "Calendar, mail and school",
      tiles: [
        stored("google-calendar", "GOOGLE_CALENDAR", {
          brand: brandOr("google-workspace"),
          name: "Google Calendar",
          body: "Two-way sync with an organization calendar.",
        }),
        {
          key: "gmail",
          brand: brandOr("google-workspace"),
          name: "Gmail",
          body: "Turn emails and invites into tasks.",
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
          body: "Assignment due dates on your personal calendar.",
          state: "soon",
        },
      ],
    },
    {
      name: "Video calls",
      tiles: meetings.map((m) => {
        const held = m.connected || m.needsReauth;
        return {
          key: m.slug,
          brand: brandOr(m.slug),
          name: m.label,
          body: "A meeting link on any event.",
          // A provider this Bananasplit has no app for can't be connected by
          // anyone in the organization yet: it waits with the rest.
          state: m.needsReauth
            ? "attention"
            : m.connected
              ? "connected"
              : m.available
                ? "off"
                : "soon",
          detail: m.connected && m.accountEmail ? m.accountEmail : undefined,
          panel: held,
          connectSlug: held || !m.available ? undefined : m.slug,
        } satisfies Tile;
      }),
    },
    {
      name: "Notes, AI and data",
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
          body: "Dictation into notes and tasks.",
          state: "soon",
        },
        stored("claude", "CLAUDE", {
          brand: brandOr("claude"),
          name: "Claude",
          body: "Ask about your organization's data, including form responses.",
        }),
        {
          key: "chatgpt",
          brand: brandOr("chatgpt"),
          name: "ChatGPT",
          body: "The same, for organizations on ChatGPT.",
          state: "soon",
        },
        stored("data-source", "SUPABASE_SOURCE", {
          brand: brandOr("supabase"),
          name: "Supabase",
          body: "Keep your own tables in sync with a database.",
        }),
        // Beyond the plan's tiles, so nothing that works today is lost: a
        // model of your choice instead of Claude, and the website's rebuild.
        stored("ai-model", "OPENAI_COMPATIBLE", {
          brand: M.generic,
          name: "Other AI models",
          body: "Any compatible model, instead of Claude.",
        }),
        stored("website", "NETLIFY_BUILD_HOOK", {
          brand: M.website,
          name: "Website build hook",
          body: "Rebuilds your site when public events change.",
        }),
      ],
    },
  ];

  const isOn = (t: Tile) => t.state === "connected" || t.state === "attention";
  const all = groups.flatMap((g) => g.tiles);
  // Needs reconnecting first: it's the one thing here that's broken.
  const connected = all
    .filter(isOn)
    .sort((a, b) => Number(b.state === "attention") - Number(a.state === "attention"));
  const rank: Record<State, number> = { connected: 0, attention: 0, off: 0, soon: 1 };
  const rest = groups
    .map((g) => ({
      name: g.name,
      tiles: g.tiles.filter((t) => !isOn(t)).sort((a, b) => rank[a.state] - rank[b.state]),
    }))
    .filter((g) => g.tiles.length > 0);

  // The window that's open, if any: loaded only then.
  const app = canManage && isPanelApp(sp.app) ? sp.app : null;
  const panel = app ? await loadPanel(app, orgSlug, sp) : null;
  const panelTile = app ? all.find((t) => t.key === app) : undefined;
  const base = `/app/${orgSlug}/integrations`;
  const tileProps = { orgId: org.id, base, canManage };

  return (
    <div className="space-y-7.5">
      <PageHeader title={sectionLabel(ctx.settings?.sidebar, "integrations")} />

      {connected.length > 0 && (
        <Section title="Connected" count={connected.length}>
          {connected.map((t) => (
            <TileCard key={t.key} tile={t} {...tileProps} />
          ))}
        </Section>
      )}

      {rest.map((g) => (
        <Section key={g.name} title={g.name}>
          {g.tiles.map((t) => (
            <TileCard key={t.key} tile={t} {...tileProps} />
          ))}
        </Section>
      ))}

      {panel && (
        <IntegrationDialog
          key={app}
          title={panel.title}
          summary={panel.summary}
          mark={<BrandMark brand={panelTile?.brand ?? M.generic} size={32} />}
        >
          {panel.body}
        </IntegrationDialog>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const id = `int-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section className="space-y-3" aria-labelledby={id}>
      <h2 id={id} className="heading flex items-center gap-2 text-[17px]">
        {title}
        {count !== undefined && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 font-mono text-[12px] leading-5 font-medium">
            {count}
          </span>
        )}
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</ul>
    </section>
  );
}

function TileCard({
  tile: t,
  orgId,
  base,
  canManage,
}: {
  tile: Tile;
  orgId: string;
  base: string;
  canManage: boolean;
}) {
  const on = t.state === "connected" || t.state === "attention";
  return (
    <li
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
            {on && t.detail ? t.detail : t.body}
          </p>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <StateBadge state={t.state} />
          {canManage && t.state !== "soon" && <TileAction tile={t} orgId={orgId} base={base} />}
        </div>
      </div>
    </li>
  );
}

function StateBadge({ state }: { state: State }) {
  if (state === "connected") return <Badge variant="success">Connected</Badge>;
  if (state === "attention") return <Badge variant="destructive">Needs reconnecting</Badge>;
  if (state === "soon") return <Badge variant="secondary">Coming soon</Badge>;
  return null;
}

/**
 * Connect, Manage or Reconnect. A video-call provider that isn't connected
 * goes straight to its sign-in from here; everything else opens its window.
 */
function TileAction({ tile, orgId, base }: { tile: Tile; orgId: string; base: string }) {
  const label =
    tile.state === "connected" ? "Manage" : tile.state === "attention" ? "Reconnect" : "Connect";
  if (tile.connectSlug) {
    return (
      <form action={`/api/integrations/conference/${tile.connectSlug}/start`} method="post">
        <input type="hidden" name="orgId" value={orgId} />
        <Button type="submit" size="sm" variant="outline">
          {label}
        </Button>
      </form>
    );
  }
  if (!tile.panel) return null;
  return (
    <Button size="sm" variant="outline" asChild>
      <Link href={`${base}?app=${tile.key}`} scroll={false}>
        {label}
      </Link>
    </Button>
  );
}
