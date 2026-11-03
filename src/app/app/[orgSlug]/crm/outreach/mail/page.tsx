import { MailSettings, Suggestions } from "@/components/crm/outreach/mail-settings";
import { OutreachHeader } from "@/components/crm/outreach/outreach-header";
import { inboundDomain } from "@/server/crm/outreach/mailbox";
import { ensureMemberSettings } from "@/server/crm/outreach/member";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Your mail" };

/**
 * A member's own CRM settings (docs/features/crm.md, "Email connections"):
 * their BCC address, share mode, never-log list and signature, and the
 * people the CRM noticed in their mail, waiting for a yes.
 */
export default async function MailPage({ params }: PageProps<"/app/[orgSlug]/crm/outreach/mail">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db, userId }) => ({
    settings: await ensureMemberSettings(db, orgId, userId),
    suggestions: await db.crmSuggestion.findMany({
      where: { organizationId: orgId, source: "EMAIL", kind: "CREATE_PERSON", status: "PENDING", OR: [{ assigneeId: userId }, { assigneeId: null }] },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, summary: true, targetId: true },
    }),
  }));
  return (
    <div className="space-y-6">
      <OutreachHeader
        orgSlug={orgSlug}
        tabs={shell.tabs}
        view="mail"
        title="Your mail"
        description="What reaches the CRM from your mail is your choice. Gmail and Outlook connect here once email connections arrive."
      />
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
      <Suggestions orgId={orgId} rows={data.suggestions.map((s) => ({ id: s.id, title: s.title, summary: s.summary, from: s.targetId }))} />
    </div>
  );
}
