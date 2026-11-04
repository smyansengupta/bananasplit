import type { Metadata } from "next";

import { SharedNotice, SharedReportView } from "@/components/reports/shared/shared-report-view";
import { PublicThemeRoot } from "@/components/theme/public-theme-root";
import { hashShareToken } from "@/server/reports/share-token";
import {
  linkTarget,
  loadSharedReport,
  sharedViewIpLimit,
  sharedViewShareLimit,
} from "@/server/reports/shared-view";

export const metadata: Metadata = { title: "Shared report", robots: { index: false } };

/**
 * A report's view-only link (/r/{token}): anyone with it sees the report as
 * its maker does, read-only, with no sign-in. The token is the credential;
 * turning the link off or making a new one ends it. Rate-limited per
 * visitor and per link, since each open computes the report.
 */
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const busy = (wait: string) => (
    <PublicThemeRoot>
      <SharedNotice title="Too many visits" body={`Try again ${wait}.`} />
    </PublicThemeRoot>
  );
  const ipWait = await sharedViewIpLimit();
  if (ipWait) return busy(ipWait);
  const target = await linkTarget(token);
  // Counted per link once it works; keyed on a hash, so the limiter never holds the token.
  const shareWait = target ? await sharedViewShareLimit(hashShareToken(token)) : null;
  if (shareWait) return busy(shareWait);
  const report = target ? await loadSharedReport(target) : null;
  if (!report) {
    return (
      <PublicThemeRoot>
        <SharedNotice
          title="This link doesn't work anymore"
          body="The report may have been unshared, archived or deleted, or the link was replaced with a new one. Ask whoever sent it for the current link."
        />
      </PublicThemeRoot>
    );
  }
  return (
    <PublicThemeRoot>
      <SharedReportView report={report} />
    </PublicThemeRoot>
  );
}
