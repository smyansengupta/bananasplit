import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { BookingEditor } from "@/components/crm/outreach/booking";
import { PageHeader } from "@/components/page-header";
import { appUrl } from "@/lib/app-url";
import { readQuestions } from "@/lib/crm/outreach/booking";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../../shell";

export const metadata = { title: "Booking page" };

export default async function BookingPageEditor({ params }: PageProps<"/app/[orgSlug]/crm/outreach/booking/[pageId]">) {
  const { orgSlug, pageId } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const page = await withOrgTx(orgId, ({ db }) => db.crmBookingPage.findFirst({ where: { id: pageId, organizationId: orgId } }));
  if (!page) notFound();
  return (
    <div className="space-y-6">
      <PageHeader title={page.title} description="Anyone with the link can book; it lands in Meetings and on their timeline." tabs={<CrmTabs tabs={shell.tabs} />} />
      <BackLink href={`/app/${orgSlug}/crm/outreach/booking`} label="Booking pages" />
      <BookingEditor
        orgId={orgId}
        members={shell.members}
        pipelines={shell.pipelines.map((p) => ({ id: p.id, name: p.name }))}
        page={{
          id: page.id,
          title: page.title,
          description: page.description ?? "",
          slug: page.slug,
          url: appUrl(`/book/${page.slug}`),
          durationMin: page.durationMin,
          bufferMin: page.bufferMin,
          minNoticeHours: page.minNoticeHours,
          maxDaysAhead: page.maxDaysAhead,
          hostIds: page.hostIds,
          questions: readQuestions(page.questions),
          pipelineId: page.pipelineId,
          active: page.active,
        }}
      />
    </div>
  );
}
