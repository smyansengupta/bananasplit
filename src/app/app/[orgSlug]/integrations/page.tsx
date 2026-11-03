import Link from "next/link";

import { AddOnCards } from "@/components/addons/addon-cards";
import { DataConnectorsSection } from "@/components/crm/ai/data-connectors-section";
import { IntegrationDialog } from "@/components/integrations/integration-dialog";
import { BrandMark } from "@/components/marketing/brand-mark";
import type { Brand } from "@/components/marketing/brands";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { ADD_ON_INFO, ADD_ONS, readAddOns } from "@/lib/addons";
import { spaceIncludes } from "@/lib/billing/space";
import { brandOr, INTEGRATION_MARKS as M } from "@/lib/integrations/marks";
import { planGate } from "@/server/billing/plan-gate";
import { loadMeetingConnections } from "@/server/conference/connections";
import { getOrgContextBySlug } from "@/server/db/context";
import { resolveOrgMailRouting } from "@/server/email/mailer";
import { loadIntegrations } from "@/server/integrations/service";

import { isPanelApp, loadPanel } from "./panels";

/**
 * Integrations and apps. First the add-ons (src/lib/addons.ts): Forms and
 * Finance and the CRM, which an organization adds when it wants them;
 * each has its own page (/integrations/forms, …). Then the apps it
 * can connect: what's connected first, then what can be connected today,
 * and one line naming what's coming. Setting an app up, testing it and
 * disconnecting it happen in a window over this page (`?app=<key>`,
 * src/components/integrations/integration-dialog.tsx); the old
 * /integrations/<app> URLs open that window.
 *
 * Owners and admins add and connect; everyone else sees what's on.
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
  const ctx = await getOrgContextBySlug(orgSlug);
  const { organization: org } = ctx;
  // A Personal space has no add-ons (its sidebar is fixed); a team keeps
  // its add-ons here even on a plan without connected apps, since Forms is
  // on every plan.
  const addOns =
    org.kind === "PERSONAL" ? null : (
      <section className="space-y-4" aria-labelledby="int-addons">
        <h2 id="int-addons" className="heading text-[20px]">
          Add-ons
        </h2>
        <AddOnCards
          orgId={org.id}
          orgSlug={orgSlug}
          added={readAddOns(ctx.settings?.addOns)}
          canManage={can({ role: ctx.role }, "settings.general.write")}
          locked={ADD_ONS.filter((id) => !spaceIncludes(org, ADD_ON_INFO[id].feature))}
        />
      </section>
    );
  const header = (
    <PageHeader
      title="Integrations and apps"
      description="Add only what your organization uses. Added ones show in the sidebar under Integrations and apps. Turn one off and it's hidden; nothing is deleted."
    />
  );
  if (planLock) {
    if (!addOns) return planLock;
    return (
      <div className="space-y-9">
        {header}
        {addOns}
        {planLock}
      </div>
    );
  }
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
      name: "Calendar and mail",
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
          body: "Calendar and mail for Microsoft accounts.",
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

  const all = groups.flatMap((g) => g.tiles);
  // Needs reconnecting first: it's the one thing here that's broken; then
  // what's connected, then what can be connected today.
  const rank = (t: Tile) => (t.state === "attention" ? 0 : t.state === "connected" ? 1 : 2);
  const usable = all.filter((t) => t.state !== "soon").sort((a, b) => rank(a) - rank(b));
  const half = Math.ceil(usable.length / 2);
  const soon = all.filter((t) => t.state === "soon").map((t) => t.name);

  // The window that's open, if any: loaded only then.
  const app = canManage && isPanelApp(sp.app) ? sp.app : null;
  const panel = app ? await loadPanel(app, orgSlug, sp) : null;
  const panelTile = app ? all.find((t) => t.key === app) : undefined;
  const base = `/app/${orgSlug}/integrations`;
  const rowProps = { orgId: org.id, base, canManage };

  return (
    <div className="space-y-9">
      {header}
      {addOns}

      <section className="space-y-4" aria-labelledby="int-apps">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="int-apps" className="heading text-[20px]">
            Integrations
          </h2>
          <span className="text-muted-foreground text-[13.5px]">
            Other apps your organization already uses
          </span>
        </div>
        <div className="grid gap-[18px] lg:grid-cols-2">
          {[usable.slice(0, half), usable.slice(half)]
            .filter((col) => col.length > 0)
            .map((col, i) => (
              <ul
                key={i}
                className="bg-card text-card-foreground ring-foreground/6 rounded-card edge divide-border h-fit min-w-0 divide-y px-[22px] py-1.5 ring-1"
              >
                {col.map((t) => (
                  <AppRow key={t.key} tile={t} {...rowProps} />
                ))}
              </ul>
            ))}
        </div>
        {soon.length > 0 && (
          <p className="text-muted-foreground text-[13px]">
            Coming later: {soon.slice(0, -1).join(", ")}
            {soon.length > 1 ? " and " : ""}
            {soon[soon.length - 1]}.
          </p>
        )}
      </section>

      <DataConnectorsSection orgSlug={orgSlug} />

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

/** One app: its mark, name, what it does (or what's connected), and its one action. */
function AppRow({
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
    <li className="flex flex-wrap items-center gap-x-3.5 gap-y-2 py-3">
      <span className="shrink-0">
        <BrandMark brand={t.brand} size={36} />
      </span>
      <div className="min-w-0 flex-[1_1_150px]">
        <p className="text-[14.5px] font-semibold">{t.name}</p>
        <p className="text-muted-foreground truncate text-[12.5px]">
          {on && t.detail ? t.detail : t.body}
        </p>
      </div>
      <StateBadge state={t.state} />
      {canManage && <TileAction tile={t} orgId={orgId} base={base} />}
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
