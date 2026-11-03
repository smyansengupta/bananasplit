import { ClipboardList } from "@/components/icons";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageTabs } from "@/components/ui/page-tabs";
import { NewFormButton, TemplateRow } from "@/components/forms/new-form";
import { FormList, type FormListRow } from "@/components/forms/form-list";
import { shareAgain, shareAgainPost, sharedLately } from "@/lib/ambient/forms";
import { appUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone } from "@/lib/calendar/dates";
import { sectionLabel } from "@/lib/nav/sidebar";
import { isPollOpen } from "@/lib/polls/question-poll";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { describeQuestions } from "@/lib/forms/describe";
import { readQuestions } from "@/lib/forms/questions";
import {
  isFormOpen,
  isWebsitePollOpen,
  listForms,
  listWebsitePolls,
  recentFormShares,
} from "@/server/forms/forms";
import { listQuestionPolls } from "@/server/polls/question-polls";
import { planGate } from "@/server/billing/plan-gate";

/**
 * Forms: every form and quick poll the organization runs, newest first,
 * with how many answered and how many wait on a review. Owners and admins
 * make forms (each writes into its own database); any member starts a
 * quick poll, as they always could ask the organization a question.
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

  const { forms, polls, website, shares } = await withOrgTx(org.id, async ({ db }) => ({
    forms: await listForms(db, org.id),
    polls: await listQuestionPolls(db, org.id),
    website: await listWebsitePolls(db, org.id),
    shares: await recentFormShares(db, org.id, now),
  }));

  // Share again compares with the organization's form before it ("fewer than last time").
  const byAge = forms
    .filter((f) => f.form.kind === "FORM" && f.form.publishedAt !== null)
    .sort((a, b) => a.form.createdAt.getTime() - b.form.createdAt.getTime());
  const lastTime = (id: string) => {
    const i = byAge.findIndex((f) => f.form.id === id);
    return i > 0 ? byAge[i - 1]!.responses : null;
  };
  const short = (at: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at);
  const rows: (FormListRow & { at: number })[] = [
    ...forms.map(({ form, responses, toReview, databaseKey, members }) => {
      const open = isFormOpen(form, responses, now);
      const draft = form.publishedAt === null;
      const share = shareAgain(
        {
          open,
          draft,
          closesAt: form.closesAt,
          responses,
          outOf: form.access === "MEMBERS" ? members : null,
          lastTime: form.kind === "FORM" ? lastTime(form.id) : null,
        },
        now,
      );
      const who =
        form.access === "MEMBERS"
          ? form.onePerPerson
            ? "Members only, one per person"
            : "Members only"
          : form.access === "SIGNED_IN"
            ? "Signed in, one per person"
            : null;
      return {
        id: form.id,
        kind: form.kind === "QUICK_POLL" ? ("poll" as const) : ("form" as const),
        title: form.title,
        detail:
          form.kind === "QUICK_POLL"
            ? who
            : [describeQuestions(readQuestions(form.questions)), who].filter(Boolean).join(", "),
        href: `${base}/forms/${form.id}`,
        open,
        draft,
        status: draft
          ? "Draft"
          : open
            ? form.closesAt
              ? `Open until ${short(form.closesAt)}`
              : "Open"
            : "Closed",
        responses,
        outOf: members,
        toReview,
        databaseHref: canMake ? `${base}/databases/${databaseKey}` : null,
        canTrash: canMake,
        shareAgain:
          share && form.closesAt && !sharedLately(form.slug, shares)
            ? {
                reason: share.reason,
                ...shareAgainPost(form.title, form.closesAt, appUrl(`/f/${form.slug}`), timeZone),
              }
            : null,
        at: form.createdAt.getTime(),
      };
    }),
    ...polls.map((p) => {
      const open = isPollOpen(p, now);
      return {
        id: p.id,
        kind: "member-poll" as const,
        title: p.question,
        detail: "Members only, anonymous",
        href: `${base}/forms/polls/${p.id}`,
        open,
        draft: false,
        status: open ? (p.closesAt ? `Open until ${short(p.closesAt)}` : "Open") : "Closed",
        responses: p.voterCount,
        outOf: null,
        toReview: 0,
        databaseHref: null,
        canTrash: p.createdById === user.id || isAdmin,
        at: p.createdAt.getTime(),
      };
    }),
    // Polls from the organization's website: anonymous ballots, results in Ballots.
    ...website.map((p) => {
      const open = isWebsitePollOpen(p, now);
      const results = p.databaseKey
        ? `${base}/databases/${p.databaseKey}?f=${encodeURIComponent(`poll:eq:${p.slug}`)}`
        : `${base}/databases`;
      return {
        id: p.id,
        kind: "website-poll" as const,
        title: p.title,
        detail: "From your website, anonymous",
        href: results,
        open,
        draft: false,
        status: open ? (p.closesAt ? `Open until ${short(p.closesAt)}` : "Open") : "Closed",
        responses: p.responses,
        outOf: null,
        toReview: 0,
        databaseHref: canMake && p.databaseKey ? results : null,
        canTrash: false,
        at: (p.opensAt ?? p.createdAt).getTime(),
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
                  label: "Open",
                  count: openCount,
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
