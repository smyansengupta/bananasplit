import { notFound, redirect } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { FormDesignPanel } from "@/components/forms/form-design";
import { FormBuilder, FormSettingsPanel, SharePanel } from "@/components/forms/form-editor";
import { LinkedSection } from "@/components/links/linked-section";
import { FormPublish } from "@/components/forms/form-publish";
import { FormResponses } from "@/components/forms/form-responses";
import { PageTabs } from "@/components/ui/page-tabs";
import { appUrl } from "@/lib/app-url";
import { familyOf, formatBytes } from "@/lib/files/types";
import { can } from "@/lib/auth/permissions";
import { readDesign } from "@/lib/forms/design";
import { readQuestions } from "@/lib/forms/questions";
import { summarize } from "@/lib/forms/summary";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { isFormOpen, loadForm, loadResponses } from "@/server/forms/forms";
import { planGate } from "@/server/billing/plan-gate";

const TABS = ["build", "design", "settings", "share", "responses"] as const;
type Tab = (typeof TABS)[number];
const VIEWS = ["table", "review", "summary", "ask"] as const;
type View = (typeof VIEWS)[number];

/** The Files id at the end of an upload answer's link, if it is one. */
function fileIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /\/files\/([A-Za-z0-9_-]{1,64})$/.exec(value)?.[1] ?? null;
}

/**
 * One form, for the owners and admins who run it: Build (questions, saved as
 * you go), Design (how the answer page looks), Settings, Share (the link and
 * a QR code) and Responses (the table, one at a time for review, a summary,
 * and asking Claude), with Preview and Publish beside the title. A new form
 * is a draft until it's published. Anyone else who opens this is sent to
 * the form itself.
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
    // The files people sent (resumes, photos, signatures), for the cards in
    // Review: each answer is a link ending in the file's id.
    const uploadFields = readQuestions(form.questions)
      .filter(
        (q) => (q.type === "file" || q.type === "image" || q.type === "signature") && q.fieldId,
      )
      .map((q) => q.fieldId!);
    const fileIds = new Set<string>();
    for (const r of rows)
      for (const f of uploadFields) {
        const id = fileIdOf(r.values[f]);
        if (id) fileIds.add(id);
      }
    const files = fileIds.size
      ? await db.orgFile.findMany({
          where: { organizationId: org.id, id: { in: [...fileIds] }, deletedAt: null },
          select: { id: true, name: true, contentType: true, sizeBytes: true },
        })
      : [];
    return { form, admin: true as const, rows, choices, members, files };
  });
  if (!loaded) notFound();
  if (!loaded.admin) redirect(`/f/${loaded.form.slug}`);

  const { form, rows, choices, members, files } = loaded;
  const base = `/app/${orgSlug}`;
  const tab: Tab = TABS.find((t) => t === sp.tab) ?? (rows.length > 0 ? "responses" : "build");
  const view: View = VIEWS.find((v) => v === sp.view) ?? (form.review ? "review" : "summary");
  const questions = readQuestions(form.questions);
  const open = isFormOpen(form, rows.length);
  const link = appUrl(`/f/${form.slug}`);
  const href = (t: Tab, v?: View) => `${base}/forms/${form.id}?tab=${t}${v ? `&view=${v}` : ""}`;
  const fresh = rows.filter((r) => r.status === "NEW").length;
  const databaseHref = `${base}/databases/${form.database.key}`;

  return (
    <div className="space-y-7">
      {/* One bar, as the plan draws it: the title, the five tabs, then
          Preview and Publish. On a narrow screen the tabs take their own row. */}
      <header className="space-y-3">
        <BackLink href={`${base}/forms`} label="Forms" />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <h1 className="heading min-w-0 text-[26px] leading-tight break-words max-lg:flex-1">
            {form.title}
          </h1>
          <div className="flex min-w-0 flex-1 justify-center max-lg:order-3 max-lg:basis-full max-lg:justify-start">
            <PageTabs
              label="Form"
              tabs={[
                { href: href("build"), label: "Build", active: tab === "build" },
                { href: href("design"), label: "Design", active: tab === "design" },
                { href: href("settings"), label: "Settings", active: tab === "settings" },
                { href: href("share"), label: "Share", active: tab === "share" },
                {
                  href: href("responses"),
                  label: rows.length > 0 ? `Responses ${rows.length}` : "Responses",
                  active: tab === "responses",
                },
              ]}
            />
          </div>
          <FormPublish
            orgId={org.id}
            formId={form.id}
            previewHref={`/f/${form.slug}?preview=1`}
            published={form.publishedAt !== null}
          />
        </div>
      </header>

      {tab === "build" && (
        <FormBuilder
          orgId={org.id}
          formId={form.id}
          initial={questions}
          databaseName={form.database.name}
          databaseHref={databaseHref}
        />
      )}
      {tab === "design" && (
        <FormDesignPanel
          orgId={org.id}
          formId={form.id}
          initial={readDesign(form.design)}
          title={questions[0]?.title ?? form.title}
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
            receipt: form.receipt,
            review: form.review,
            open,
            closed: Boolean(form.closedAt),
          }}
          databaseHref={databaseHref}
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
          title={form.title}
          view={view}
          hrefOf={{
            table: href("responses", "table"),
            review: href("responses", "review"),
            summary: href("responses", "summary"),
            ask: href("responses", "ask"),
          }}
          review={form.review}
          fresh={fresh}
          only={typeof sp.ids === "string" ? sp.ids.split(",").filter(Boolean).slice(0, 50) : null}
          files={Object.fromEntries(
            files.map((f) => [
              f.id,
              {
                name: f.name,
                kind: familyOf(f.contentType),
                size: formatBytes(f.sizeBytes),
                src: `/api/orgs/${encodeURIComponent(org.id)}/files/${encodeURIComponent(f.id)}`,
              },
            ]),
          )}
          databaseHref={databaseHref}
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
