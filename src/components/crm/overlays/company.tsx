import { CompanyCard, type CompanyCardData } from "@/components/crm/cards/company-card";
import { formatMoney } from "@/lib/crm/fields";
import { crmDatabaseIds } from "@/server/crm/databases";
import { readEnrichment, summaryOf } from "@/server/crm/enrichment-store";
import { companyForm, formContext, withRelationLabels } from "@/server/crm/forms";
import { ownerLabel } from "@/server/crm/owners";
import { presentHistory } from "@/server/crm/present";
import { loadCompany } from "@/server/crm/records";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

const DAY = 86_400_000;
/** Someone at a company nobody has talked to in this long gets the intro button. */
const QUIET_DAYS = 60;

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function lastLabel(d: Date | null, now: Date): string {
  if (!d) return "Never";
  const n = Math.floor((now.getTime() - d.getTime()) / DAY);
  return n <= 0 ? "Today" : n === 1 ? "Yesterday" : shortDate(d);
}

/**
 * A company's card (?open=company:<id>, Company.dc.html): what it is and
 * the one next thing in Overview, then its People, its Deals and Details.
 */
export async function CompanyOverlay({ shell, orgSlug, open }: OverlayProps<"company">) {
  const orgId = shell.org.id;
  const now = new Date();
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const data = await withOrgTx(orgId, async ({ db }) => {
    const loaded = await loadCompany(db, orgId, orgSlug, open.id);
    if (!loaded) return null;
    const ids = await crmDatabaseIds(db, orgId);
    const def = ids.companies
      ? await db.databaseDefinition.findFirst({
          where: { id: ids.companies, organizationId: orgId },
          select: { columns: true },
        })
      : null;
    const fctx = await formContext(db, orgId, shell.roles);
    const form = await withRelationLabels(
      db,
      orgId,
      companyForm(loaded.company, loaded.fields, fctx, def?.columns),
    );
    const summary = summaryOf(await readEnrichment(db, orgId, { kind: "company", id: open.id }));
    // The next thing anyone here is due to do: someone's follow-up, or an open deal's next step.
    const person = await db.crmPerson.findFirst({
      where: { organizationId: orgId, companyId: open.id, deletedAt: null, nextFollowUpAt: { not: null } },
      orderBy: { nextFollowUpAt: "asc" },
      select: { id: true, name: true, nextFollowUpAt: true },
    });
    const deal = await db.crmDeal.findFirst({
      where: {
        organizationId: orgId,
        companyId: open.id,
        deletedAt: null,
        closedAt: null,
        nextStep: { not: null },
      },
      orderBy: { nextStepAt: { sort: "asc", nulls: "last" } },
      select: { id: true, title: true, nextStep: true, nextStepAt: true },
    });
    return { ...loaded, form, summary, person, deal };
  });
  if (!data) return <CompanyCard orgId={orgId} orgSlug={orgSlug} data={null} />;
  const { company } = data;

  // The soonest of the two, as one line with where it's done.
  type Next = CompanyCardData["next"];
  const candidates: { at: number; next: NonNullable<Next> }[] = [];
  if (company.nextFollowUpAt) {
    candidates.push({
      at: company.nextFollowUpAt.getTime(),
      next: { text: `Follow up, ${shortDate(company.nextFollowUpAt)}`, open: null, label: null },
    });
  }
  if (data.person?.nextFollowUpAt) {
    const first = data.person.name.split(" ")[0] ?? data.person.name;
    candidates.push({
      at: data.person.nextFollowUpAt.getTime(),
      next: {
        text: `${first}, follow up ${shortDate(data.person.nextFollowUpAt)}`,
        open: { kind: "person", id: data.person.id },
        label: `Open ${first}`,
      },
    });
  }
  if (data.deal?.nextStep) {
    candidates.push({
      at: data.deal.nextStepAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
      next: {
        text: `${data.deal.nextStep}${data.deal.nextStepAt ? `, ${shortDate(data.deal.nextStepAt)}` : ""}`,
        open: { kind: "deal", id: data.deal.id },
        label: "Open the deal",
      },
    });
  }
  candidates.sort((a, b) => a.at - b.at);

  // Someone here nobody has talked to lately, and who to ask for an intro.
  const talked = data.people
    .filter((p) => p.lastContactedAt)
    .sort((a, b) => b.strength - a.strength || b.lastContactedAt!.getTime() - a.lastContactedAt!.getTime());
  const best = talked[0] ?? null;
  const quiet = data.people.find(
    (p) =>
      p.id !== best?.id &&
      (!p.lastContactedAt || now.getTime() - p.lastContactedAt.getTime() > QUIET_DAYS * DAY),
  );
  const openDeals = data.deals.filter((d) => !d.closedAt);
  const firstOpen = openDeals[0] ?? null;

  const card: CompanyCardData = {
    id: company.id,
    name: company.name,
    subtitle:
      [
        company.industry,
        company.domain ?? company.website,
        data.people.length === 1 ? "1 person" : data.people.length ? `${data.people.length} people` : null,
      ]
        .filter(Boolean)
        .join(", ") || null,
    deleted: Boolean(company.deletedAt),
    about: company.description ?? data.summary?.text ?? null,
    next: candidates[0]?.next ?? null,
    facts: [
      ...(data.money.count
        ? [
            { label: "Given in all", value: formatMoney(data.money.received) },
            {
              label: "Paid so far",
              value: `${formatMoney(data.money.received)} of ${formatMoney(data.money.pledged)}`,
            },
          ]
        : []),
      { label: "Owner", value: ownerLabel(company, shell.roles, names) ?? "Nobody" },
    ],
    openDeal: firstOpen
      ? {
          id: firstOpen.id,
          label: `${firstOpen.title}${
            firstOpen.amountCents !== null ? `, ${formatMoney(firstOpen.amountCents, firstOpen.currency)}` : ""
          }`,
        }
      : null,
    intro:
      quiet && best
        ? {
            quiet: quiet.name,
            best: { id: best.id, name: best.name },
            why: quiet.lastContactedAt
              ? `${Math.floor((now.getTime() - quiet.lastContactedAt.getTime()) / DAY)} days`
              : "Never talked",
          }
        : null,
    people: data.people.map((p) => ({
      id: p.id,
      name: p.name,
      sub: p.title,
      last: lastLabel(p.lastContactedAt, now),
    })),
    deals: data.deals.map((d) => ({
      id: d.id,
      title: d.title,
      kind: d.stage.kind,
      stage: d.closedAt ? `${d.stage.name} ${shortDate(d.closedAt)}` : d.stage.name,
      amount: d.amountCents !== null ? formatMoney(d.amountCents, d.currency) : null,
    })),
    form: data.form,
    history: presentHistory(data.history, "company", data.fields, names),
  };
  return <CompanyCard orgId={orgId} orgSlug={orgSlug} data={card} />;
}
