import { Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { exportDownloadPath, signExportDownload } from "@/server/export/signing";

import { SettingsNoAccess } from "../../../settings-no-access";

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
    <div className="max-w-xl space-y-4">
      <h1 className="page-title">Data export</h1>
      <p className="text-muted-foreground text-sm">
        Requested {fmt.format(row.createdAt)}
        {row.expiresAt ? ` · available until ${fmt.format(row.expiresAt)}` : ""}
        {row.downloadCount ? ` · downloaded ${row.downloadCount}×` : ""}
      </p>
      {href ? (
        <a
          href={href}
          className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
        >
          <Download className="size-4" aria-hidden="true" />
          Download zip
        </a>
      ) : row.status === "FAILED" ? (
        <p className="text-destructive text-sm">
          This export failed. Request a new one from the Danger zone.
        </p>
      ) : row.status === "EXPIRED" ? (
        <p className="text-sm">This export has expired and its file was deleted.</p>
      ) : (
        <p className="text-sm">
          This export is still being prepared. Refresh this page in a minute.
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        Each download is recorded in the audit log. The link works only for you, while you are
        signed in as an owner, for 24 hours.
      </p>
      <Link
        href={`/app/${orgSlug}/settings/danger`}
        className="text-sm underline underline-offset-4"
      >
        Back to Danger zone
      </Link>
    </div>
  );
}
