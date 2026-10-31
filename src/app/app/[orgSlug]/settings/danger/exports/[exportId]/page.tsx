import { Download } from "@/components/icons";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { exportDownloadPath, signExportDownload } from "@/server/export/signing";

import { SettingsCard } from "../../../settings-card";
import { SettingsNoAccess } from "../../../settings-no-access";
import { ExportAgain, RefreshWhilePreparing } from "./export-again";

const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * The export's landing page (the ready notification links here, never to
 * the file). Signed-in OWNERs only: it mints a 24-hour download link bound
 * to this user; the download route re-checks session, OWNER and status.
 */
export default async function ExportLandingPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/danger/exports/[exportId]">) {
  const { orgSlug, exportId } = await params;
  const { organization, role, user } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "org.export.download")) {
    return <SettingsNoAccess title="Data export" who="owners" />;
  }

  const row = await withOrgTx(organization.id, ({ db }) =>
    db.orgExport.findFirst({
      where: { id: exportId, organizationId: organization.id },
      select: { id: true, status: true, createdAt: true, expiresAt: true, downloadCount: true },
    }),
  );
  if (!row) notFound();

  const href =
    row.status === "READY"
      ? exportDownloadPath(organization.id, row.id, signExportDownload(row.id, user.id))
      : null;

  return (
    <div className="max-w-2xl space-y-7.5">
      <div className="space-y-4">
        <BackLink href={`/app/${orgSlug}/settings/danger`} label="Danger zone" />
        <PageHeader title="Data export" />
        <p className="text-muted-foreground -mt-2 text-sm">
          Requested {fmt.format(row.createdAt)}
          {row.expiresAt ? `, available until ${fmt.format(row.expiresAt)}` : ""}
          {row.downloadCount ? `, downloaded ${row.downloadCount}×` : ""}
        </p>
      </div>
      <SettingsCard
        title={
          href
            ? "Your export is ready"
            : row.status === "FAILED"
              ? "This export failed"
              : row.status === "EXPIRED"
                ? "This export has expired"
                : "Still preparing"
        }
        description={href ? "Link works for you only, for 24 hours." : undefined}
        footer={
          href ? (
            <Button asChild>
              <a href={href}>
                <Download data-icon="inline-start" aria-hidden="true" />
                Download zip
              </a>
            </Button>
          ) : row.status === "FAILED" || row.status === "EXPIRED" ? (
            <ExportAgain
              orgId={organization.id}
              orgSlug={orgSlug}
              retryOf={row.status === "FAILED" ? row.id : undefined}
            />
          ) : null
        }
      >
        {!href && (
          <p
            className={
              row.status === "FAILED"
                ? "bg-tint-danger text-tint-danger-foreground rounded-tile p-3 text-sm"
                : "bg-muted/60 rounded-tile p-3 text-sm"
            }
          >
            {row.status === "FAILED" ? (
              "Something went wrong preparing it."
            ) : row.status === "EXPIRED" ? (
              "Its file was deleted."
            ) : (
              <>
                Preparing. This page updates by itself.
                <RefreshWhilePreparing />
              </>
            )}
          </p>
        )}
      </SettingsCard>
    </div>
  );
}
