import { notFound, redirect } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { FormBuilder, FormSettingsPanel, SharePanel } from "@/components/forms/form-editor";
import { LinkedSection } from "@/components/links/linked-section";
import { FormResponses } from "@/components/forms/form-responses";
import { PageHeader } from "@/components/page-header";
import { PageTabs } from "@/components/ui/page-tabs";
import { appUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { readQuestions } from "@/lib/forms/questions";
import { summarize } from "@/lib/forms/summary";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { isFormOpen, loadForm, loadResponses } from "@/server/forms/forms";
import { planGate } from "@/server/billing/plan-gate";

const TABS = ["build", "settings", "share", "responses"] as const;
type Tab = (typeof TABS)[number];
const VIEWS = ["table", "review", "summary", "ask"] as const;
type View = (typeof VIEWS)[number];

/**
 * One form, for the owners and admins who run it: Build (questions, saved as
 * you go), Settings, Share (the link and a QR code) and Responses (the
 * table, one at a time for review, a summary, and asking Claude). Anyone
 * else who opens this is sent to the form itself.
 */
export default async function FormPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/forms/[formId]">) {
  const { orgSlug, formId } = await params;
  const sp = await searchParams;
  const planLock = await planGate(orgSlug, "polls");
  if (planLock) return planLock;
  const ctx = await getOrgContextBySlug(orgSlug);
  const { organization: org } = ctx;
  const loaded = await withOrgTx(org.id, async ({ db }) => {
    const form = await loadForm(db, org.id, formId);
    if (!form || form.deletedAt) return null;
    if (!can({ role: ctx.role }, "databases.write")) return { form, admin: false as const };
    const { rows, choices } = await loadResponses(db, org.id, form.id);
    const members = await db.membership.findMany({
      where: { organizationId: org.id },
      select: { user: { select: { id: true, name: true, email: true } } },
      take: 500,
    });
    return { form, admin: true as const, rows, choices, members };
  });
  if (!loaded) notFound();
  if (!loaded.admin) redirect(`/f/${loaded.form.slug}`);

  const { form, rows, choices, members } = loaded;
  const base = `/app/${orgSlug}`;
  const tab: Tab = TABS.find((t) => t === sp.tab) ?? (rows.length > 0 ? "responses" : "build");
  const view: View = VIEWS.find((v) => v === sp.view) ?? (form.review ? "review" : "summary");
  const questions = readQuestions(form.questions);
  const open = isFormOpen(form, rows.length);
  const link = appUrl(`/f/${form.slug}`);
  const href = (t: Tab, v?: View) => `${base}/forms/${form.id}?tab=${t}${v ? `&view=${v}` : ""}`;
  const fresh = rows.filter((r) => r.status === "NEW").length;

  return (
    <div className="space-y-7">
      <div className="space-y-3">
        <BackLink href={`${base}/forms`} label="Forms" />
        <PageHeader
          title={form.title}
          tabs={
            <PageTabs
              label="Form"
              tabs={[
                { href: href("build"), label: "Build", active: tab === "build" },
                { href: href("settings"), label: "Settings", active: tab === "settings" },
                { href: href("share"), label: "Share", active: tab === "share" },
                {
                  href: href("responses"),
                  label: rows.length > 0 ? `Responses ${rows.length}` : "Responses",
                  active: tab === "responses",
                },
              ]}
            />
          }
        />
      </div>

      {tab === "build" && (
        <FormBuilder
          orgId={org.id}
          formId={form.id}
          initial={questions}
          databaseName={form.database.name}
        />
      )}
      {tab === "settings" && (
        <FormSettingsPanel
          orgId={org.id}
          orgSlug={orgSlug}
          form={{
            id: form.id,
            kind: form.kind,
            title: form.title,
            description: form.description,
            access: form.access,
            onePerPerson: form.onePerPerson,
            anonymous: form.anonymous,
            hideResultsUntilClosed: form.hideResultsUntilClosed,
            responseCap: form.responseCap,
            closesAt: form.closesAt?.toISOString() ?? null,
            notifyOwner: form.notifyOwner,
            review: form.review,
            open,
            closed: Boolean(form.closedAt),
          }}
          databaseHref={`${base}/databases/${form.database.key}`}
        />
      )}
      {tab === "share" && <SharePanel link={link} open={open} title={form.title} />}
      {(tab === "settings" || tab === "share") && (
        <LinkedSection
          orgId={org.id}
          orgSlug={orgSlug}
          at={{ kind: "form", id: form.id }}
          className="max-w-2xl"
        />
      )}
      {tab === "responses" && (
        <FormResponses
          orgId={org.id}
          formId={form.id}
          view={view}
          hrefOf={{
            table: href("responses", "table"),
            review: href("responses", "review"),
            summary: href("responses", "summary"),
            ask: href("responses", "ask"),
          }}
          review={form.review}
          fresh={fresh}
          databaseHref={`${base}/databases/${form.database.key}`}
          questions={questions}
          rows={rows.map((r) => ({
            id: r.id,
            who: r.who,
            email: r.email,
            status: r.status,
            rating: r.rating,
            notes: r.notes,
            createdAt: r.createdAt.toISOString(),
            values: r.values,
          }))}
          choices={Object.fromEntries(choices)}
          members={Object.fromEntries(
            members.map((m) => [m.user.id, m.user.name ?? m.user.email ?? "Member"]),
          )}
          summary={summarize(
            questions,
            rows.map((r) => ({ values: r.values })),
            (id) => choices.get(id) ?? [],
          )}
        />
      )}
    </div>
  );
}
