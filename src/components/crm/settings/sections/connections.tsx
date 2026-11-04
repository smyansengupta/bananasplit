import { AiSettingsSection } from "@/components/crm/ai/ai-settings-section";
import { OrgKeys } from "@/components/crm/settings/org-keys";
import { can } from "@/lib/auth/permissions";
import { crmPeopleHref } from "@/lib/crm/href";
import { bringInChoices } from "@/lib/crm/started";
import { bringInCounts } from "@/server/crm/bring-in";
import { importsToFix, recentImports } from "@/server/crm/import";
import { loadOrgKeys } from "@/server/crm/org-keys";
import { readPhoneStatus } from "@/server/crm/phone/connection";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";

import { ExportCard, ImportCard, RowsToFix } from "../import-settings";
import { PhoneDetails, PhoneProviderCard } from "../phone-settings";
import { SettingsMore } from "../settings-more";
import { ApiCards } from "./api";
import type { SectionProps } from "./types";

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Connections: what comes in and what it's plugged into. On top, bringing
 * people in (who Bananasplit already knows, or a spreadsheet, with the rows
 * it couldn't bring in), the organization's AI key, calls and texts, and
 * bulk email with the monthly cap (docs/features/crm.md, "Whose keys pay
 * for what"). Under More: export, research keys, AI use, enrichment, agents,
 * AI fields, the phone's recording, hours and voicemail, and the API with
 * its webhooks. Keys, phone and the API are owners' and admins' only.
 */
export async function ConnectionsSection({ shell, orgSlug }: SectionProps) {
  const orgId = shell.org.id;
  const { admin, personal } = shell.access;
  const actor = { userId: shell.user.id, role: shell.role };
  const [keys, data, phone] = await Promise.all([
    can(actor, "integrations.view") ? loadOrgKeys(orgId, actor) : null,
    withOrgTx(orgId, async ({ db, userId }) => ({
      recent: await recentImports(db, orgId, userId),
      fix: await importsToFix(db, orgId, userId),
      counts: admin ? await bringInCounts(db, orgId) : null,
      duplicates: await db.crmSuggestion.count({
        where: { organizationId: orgId, kind: "MERGE", status: "PENDING" },
      }),
    })),
    admin ? withSystemOrgTx(orgId, ({ db }) => readPhoneStatus(db, orgId)) : null,
  ]);
  const recent = data.recent
    .filter((r) => r.status !== "mapping")
    .slice(0, 3)
    .map((r) => ({
      id: r.id,
      fileName: r.fileName,
      line:
        r.status === "done"
          ? `${day(r.createdAt)}. ${r.created} added, ${r.updated} were already here${r.skipped ? `, ${r.skipped} left out` : ""}.`
          : r.status === "failed"
            ? `${day(r.createdAt)}. It stopped. Try the file again.`
            : `${day(r.createdAt)}. ${r.done} of ${r.total} so far.`,
    }));
  const providers = phone
    ? ([
        {
          id: "telnyx",
          label: "Telnyx",
          connected: phone.telnyx.connected,
          number: phone.telnyx.number,
        },
        {
          id: "twilio",
          label: "Twilio",
          connected: phone.twilio.connected,
          number: phone.twilio.number,
        },
      ] as const)
    : [];
  return (
    <>
      {data.fix.map((f) => (
        <RowsToFix
          key={f.id}
          orgId={orgId}
          item={{ id: f.id, fileName: f.fileName, done: f.created + f.updated, rows: f.rows }}
        />
      ))}
      <div id="import" className="scroll-mt-24">
        <ImportCard
          orgId={orgId}
          orgSlug={orgSlug}
          recent={recent}
          choices={data.counts ? bringInChoices(data.counts, personal) : []}
          duplicates={data.duplicates}
          duplicatesHref={crmPeopleHref(orgSlug, { list: "dupes" })}
        />
      </div>
      {keys && (
        <div id="ai" className="scroll-mt-24">
          <OrgKeys orgId={orgId} view={keys} groups={["ai"]} showCap={false} />
        </div>
      )}
      {keys && phone && (
        <div id="phone" className="scroll-mt-24 space-y-4.5">
          <OrgKeys orgId={orgId} view={keys} groups={["phone"]} showCap={false} />
          <PhoneProviderCard
            orgId={orgId}
            orgSlug={orgSlug}
            settings={phone.settings}
            providers={[...providers]}
          />
        </div>
      )}
      {keys && (
        <div id="email" className="scroll-mt-24">
          <OrgKeys orgId={orgId} view={keys} groups={["email"]} />
        </div>
      )}
      <SettingsMore>
        <ExportCard orgSlug={orgSlug} />
        {keys && <OrgKeys orgId={orgId} view={keys} groups={["research"]} showCap={false} />}
        <AiSettingsSection orgId={orgId} orgSlug={orgSlug} admin={admin} showCap={!keys} />
        {phone && (
          <PhoneDetails
            orgId={orgId}
            settings={phone.settings}
            timezone={shell.org.timezone ?? "UTC"}
          />
        )}
        {admin && <ApiCards orgId={orgId} />}
      </SettingsMore>
    </>
  );
}
