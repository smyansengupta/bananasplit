import Link from "next/link";

import { CrmHeader } from "@/components/crm/chrome/crm-header";
import { CrmOverlays } from "@/components/crm/overlays/crm-overlays";
import { MailSettings, Suggestions } from "@/components/crm/outreach/mail-settings";
import { NewPlanButton, OutreachToolbar, PlansGrid } from "@/components/crm/outreach/plans-view";
import { TemplatesView } from "@/components/crm/outreach/templates";
import { appUrl } from "@/lib/app-url";
import { filterPlans, sortPlans, type PlanStatus } from "@/lib/crm/outreach/plans";
import { inboundDomain } from "@/server/crm/outreach/mailbox";
import { ensureMemberSettings } from "@/server/crm/outreach/member";
import { listPlans } from "@/server/crm/outreach/plans";
import { ensureStarters } from "@/server/crm/outreach/templates";
import { listQueue } from "@/server/crm/review";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Outreach" };

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

const STATUSES: readonly PlanStatus[] = ["running", "draft", "paused", "done"];

/**
 * Outreach (docs/features/crm.md, "Redesign"): one list of plans, whether
 * a plan is steps over days, a list split among members or one email to a
 * list. Each opens as its card (?open=plan:...). Templates and Your mail
 * are the bar's other round buttons (?view=templates, ?view=mail); the
 * first visit adds three starter templates to edit.
 */
export default async function OutreachPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/outreach">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Search;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const view =
    one(sp.view) === "templates" ? "templates" : one(sp.view) === "mail" ? "mail" : "plans";
  const q = one(sp.q);
  const status = STATUSES.find((s) => s === one(sp.status)) ?? null;
  const relationships = new Map(
    (shell.access.settings?.relationshipTypes ?? []).map((t) => [t.id, t.label]),
  );
  const members = new Map(shell.members.map((m) => [m.id, m.name]));

  const header = (
    <CrmHeader
      orgSlug={orgSlug}
      settings={shell.access.manager}
      create={<NewPlanButton orgId={orgId} />}
      toolbar={<OutreachToolbar tabs={shell.tabs} view={view} />}
    />
  );

  if (view === "templates") {
    const templates = await withOrgTx(orgId, async (ctx) => {
      await ensureStarters(ctx);
      const rows = await ctx.db.crmTemplate.findMany({
        where: { organizationId: orgId, archivedAt: null },
        orderBy: [{ updatedAt: "desc" }],
        take: 200,
        select: {
          id: true,
          name: true,
          category: true,
          subject: true,
          body: true,
          shared: true,
          createdById: true,
        },
      });
      const uses = await ctx.db.crmEmailMessage.groupBy({
        by: ["templateId"],
        where: { organizationId: orgId, templateId: { in: rows.map((r) => r.id) }, status: "SENT" },
        _count: { _all: true },
      });
      return rows.map((r) => ({
        ...r,
        mine: r.createdById === ctx.userId,
        uses: uses.find((u) => u.templateId === r.id)?._count._all ?? 0,
      }));
    });
    const words = q?.toLowerCase();
    const shown = words
      ? templates.filter(
          (t) => t.name.toLowerCase().includes(words) || t.body.toLowerCase().includes(words),
        )
      : templates;
    return (
      <div>
        {header}
        <TemplatesView orgId={orgId} templates={shown} canEditAll={shell.access.admin} />
        <CrmOverlays shell={shell} orgSlug={orgSlug} searchParams={sp} />
      </div>
    );
  }

  if (view === "mail") {
    const data = await withOrgTx(orgId, async ({ db, userId }) => ({
      settings: await ensureMemberSettings(db, orgId, userId),
      suggestions: (
        await listQueue(db, orgId, userId, { source: "EMAIL", mine: true, take: 50 })
      ).filter((s) => s.kind === "CREATE_PERSON"),
    }));
    return (
      <div className="space-y-6">
        {header}
        <p className="text-muted-foreground -mt-3 max-w-3xl text-sm">
          What reaches the CRM from your mail is your choice. Gmail and Outlook connect here once
          email connections arrive.
        </p>
        <MailSettings
          orgId={orgId}
          inboundReady={Boolean(inboundDomain())}
          initial={{
            bccAddress: data.settings.bccAddress,
            shareMode: data.settings.shareMode,
            neverLog: data.settings.neverLog,
            signature: data.settings.signature,
          }}
        />
        <Suggestions
          orgId={orgId}
          rows={data.suggestions.map((s) => {
            const person = (s.payload.person ?? {}) as { primaryEmail?: string | null };
            return {
              id: s.id,
              title: s.title,
              summary: s.summary,
              from: person.primaryEmail ?? null,
            };
          })}
        />
        {data.suggestions.length > 0 && (
          <p className="text-muted-foreground max-w-4xl text-sm">
            These wait in{" "}
            <Link
              href={`/app/${orgSlug}/crm`}
              className="text-foreground underline-offset-2 hover:underline"
            >
              Today
            </Link>{" "}
            too, with everything else the CRM suggests.
          </p>
        )}
        <CrmOverlays shell={shell} orgSlug={orgSlug} searchParams={sp} />
      </div>
    );
  }

  const data = await withOrgTx(orgId, async ({ db }) => {
    const plans = await listPlans(db, orgId, shell.user.id, { relationships, members });
    const mine = await db.crmBookingPage.findFirst({
      where: { organizationId: orgId, active: true, hostIds: { has: shell.user.id } },
      orderBy: { createdAt: "asc" },
      select: { id: true, slug: true, title: true },
    });
    const any = mine
      ? null
      : await db.crmBookingPage.findFirst({
          where: { organizationId: orgId, active: true },
          orderBy: { createdAt: "asc" },
          select: { id: true, slug: true, title: true },
        });
    return { plans, booking: mine ?? any, mine: Boolean(mine) };
  });
  const shown = sortPlans(filterPlans(data.plans, { status, q }));
  return (
    <div>
      {header}
      <PlansGrid
        orgId={orgId}
        orgSlug={orgSlug}
        plans={shown}
        filtered={Boolean(status || q)}
        booking={
          data.booking
            ? {
                id: data.booking.id,
                title: data.booking.title,
                url: appUrl(`/book/${data.booking.slug}`),
                path: `/book/${data.booking.slug}, also "Insert my booking link" in every composer`,
                mine: data.mine,
              }
            : null
        }
      />
      <CrmOverlays shell={shell} orgSlug={orgSlug} searchParams={sp} />
    </div>
  );
}
