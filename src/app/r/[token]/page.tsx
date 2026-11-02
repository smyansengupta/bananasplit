import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SharedNotice, SharedReportView } from "@/components/reports/shared/shared-report-view";
import { PublicThemeRoot } from "@/components/theme/public-theme-root";
import { hashShareToken } from "@/server/reports/share-token";
import { linkTarget, loadSharedReport, sharedViewLimit } from "@/server/reports/shared-view";

export const metadata: Metadata = { title: "Shared report", robots: { index: false } };

/**
 * A report's view-only link (/r/{token}): anyone with it sees the report as
 * its maker does, read-only, with no sign-in. The token is the credential;
 * turning the link off or making a new one ends it. Rate-limited per
 * visitor and per link, since each open computes the report.
 */
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Keyed on a hash: the limiter never holds the token.
  const wait = await sharedViewLimit(hashShareToken(token));
  if (wait) {
    return (
      <PublicThemeRoot>
        <SharedNotice title="Too many visits" body={`Try again ${wait}.`} />
      </PublicThemeRoot>
    );
  }
  const target = await linkTarget(token);
  const report = target ? await loadSharedReport(target) : null;
  if (!report) notFound();
  return (
    <PublicThemeRoot>
      <SharedReportView report={report} />
    </PublicThemeRoot>
  );
}
