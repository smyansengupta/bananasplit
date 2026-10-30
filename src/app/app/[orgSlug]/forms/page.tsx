import { ClipboardList } from "@/components/icons";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageTabs } from "@/components/ui/page-tabs";
import { NewFormButton, TemplateRow } from "@/components/forms/new-form";
import { FormList, type FormListRow } from "@/components/forms/form-list";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone } from "@/lib/calendar/dates";
import { sectionLabel } from "@/lib/nav/sidebar";
import { isPollOpen } from "@/lib/polls/question-poll";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { isFormOpen, listForms } from "@/server/forms/forms";
import { listQuestionPolls } from "@/server/polls/question-polls";
import { planGate } from "@/server/billing/plan-gate";

/**
 * Forms: every form and quick poll the club runs, newest first, with how
 * many answered and how many wait on a review. Owners and admins make
 * forms (each writes into its own database); any member starts a quick
 * poll, as they always could ask the club a question.
 */
export default async function FormsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/forms">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const show = sp.show === "open" ? "open" : sp.show === "closed" ? "closed" : "all";
  const planLock = await planGate(orgSlug, "polls");
  if (planLock) return planLock;
  const ctx = await getOrgContextBySlug(orgSlug);
  const { organization: org, user, settings } = ctx;
  const canMake = can({ role: ctx.role }, "databases.write");
  const isAdmin = can({ role: ctx.role }, "events.write");
  const base = `/app/${orgSlug}`;
  const timeZone = safeTimeZone(org.timezone);
  const now = new Date();

  const { forms, polls } = await withOrgTx(org.id, async ({ db }) => ({
    forms: await listForms(db, org.id),
    polls: await listQuestionPolls(db, org.id),
  }));

  const short = (at: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at);
  const rows: (FormListRow & { at: number })[] = [
    ...forms.map(({ form, responses, toReview, databaseKey }) => {
      const open = isFormOpen(form, responses, now);
      return {
        id: form.id,
        kind: form.kind === "QUICK_POLL" ? ("poll" as const) : ("form" as const),
        title: form.title,
        href: `${base}/forms/${form.id}`,
        open,
        status: open ? (form.closesAt ? `Open until ${short(form.closesAt)}` : "Open") : "Closed",
        responses,
        toReview,
        databaseHref: canMake ? `${base}/databases/${databaseKey}` : null,
        canTrash: canMake,
        at: form.createdAt.getTime(),
      };
    }),
    ...polls.map((p) => {
      const open = isPollOpen(p, now);
      return {
        id: p.id,
        kind: "member-poll" as const,
        title: p.question,
        href: `${base}/forms/polls/${p.id}`,
        open,
        status: open ? (p.closesAt ? `Open until ${short(p.closesAt)}` : "Open") : "Closed",
        responses: p.voterCount,
        toReview: 0,
        databaseHref: null,
        canTrash: p.createdById === user.id || isAdmin,
        at: p.createdAt.getTime(),
      };
    }),
  ].sort((a, b) => b.at - a.at);
  const shown = rows.filter((r) => (show === "open" ? r.open : show === "closed" ? !r.open : true));
  const openCount = rows.filter((r) => r.open).length;

  return (
    <div className="space-y-7">
      <PageHeader
        title={sectionLabel(settings?.sidebar, "forms")}
        actions={<NewFormButton orgId={org.id} orgSlug={orgSlug} canMake={canMake} />}
        tabs={
          rows.length > 0 ? (
            <PageTabs
              label="Show"
              tabs={[
                { href: `${base}/forms`, label: "All", active: show === "all" },
                {
                  href: `${base}/forms?show=open`,
                  label: openCount > 0 ? `Open ${openCount}` : "Open",
                  active: show === "open",
                },
                { href: `${base}/forms?show=closed`, label: "Closed", active: show === "closed" },
              ]}
            />
          ) : undefined
        }
      />

      {canMake && <TemplateRow orgId={org.id} orgSlug={orgSlug} />}

      {rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No forms yet" />
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground px-1 text-sm">Nothing here.</p>
      ) : (
        <FormList orgId={org.id} rows={shown} />
      )}
    </div>
  );
}
