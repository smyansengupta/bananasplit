import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SignOutLink } from "@/components/auth/sign-out-link";
import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { SharedNotice, SharedReportView } from "@/components/reports/shared/shared-report-view";
import { PublicThemeRoot } from "@/components/theme/public-theme-root";
import { Button } from "@/components/ui/button";
import { signInPath } from "@/lib/auth/callback-url";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { getSession } from "@/lib/auth/session";
import { inviteTarget, loadSharedReport, sharedViewLimit } from "@/server/reports/shared-view";

export const metadata: Metadata = { title: "Shared report", robots: { index: false } };

/**
 * A report shared with people by email (/r/invite/{reportId}): whoever
 * signs in with an invited, verified address sees it as its maker does,
 * read-only. Anyone else is told it isn't shared with them, whether or not
 * the report exists.
 */
export default async function InvitedReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const here = `/r/invite/${encodeURIComponent(reportId)}`;
  const session = await getSession();
  if (!session) {
    return (
      <PublicThemeRoot>
        <SharedNotice
          title="Sign in to open this report"
          body="It was shared with you by email. Sign in with that email to see it."
        >
          <Button asChild className="w-fit">
            <Link href={signInPath(here)}>Sign in</Link>
          </Button>
        </SharedNotice>
      </PublicThemeRoot>
    );
  }

  const wait = await sharedViewLimit(`invite:${reportId}`);
  if (wait) {
    return (
      <PublicThemeRoot>
        <SharedNotice title="Too many visits" body={`Try again ${wait}.`} />
      </PublicThemeRoot>
    );
  }

  // The account's stored address, verified: an invite is for whoever
  // controls that mailbox.
  const identity = await getUserIdentity(session.user.id);
  if (!identity) notFound();
  if (!identity.emailVerified) {
    return (
      <PublicThemeRoot>
        <SharedNotice title="Confirm your email first">
          <VerifyEmailNotice email={identity.email} action="open this report" />
        </SharedNotice>
      </PublicThemeRoot>
    );
  }

  const target = await inviteTarget(reportId, identity.email);
  const report = target ? await loadSharedReport(target) : null;
  if (!report) {
    return (
      <PublicThemeRoot>
        <SharedNotice
          title="This report isn't shared with you"
          body={`You're signed in as ${identity.email}. Ask whoever sent it to share it with this email, or sign in with the one they used.`}
        >
          <SignOutLink
            redirectTo={signInPath(here)}
            className="bg-primary text-primary-foreground inline-flex h-10 w-fit cursor-pointer items-center justify-center rounded-full px-4 text-sm font-semibold"
          >
            Switch account
          </SignOutLink>
        </SharedNotice>
      </PublicThemeRoot>
    );
  }
  return (
    <PublicThemeRoot>
      <SharedReportView report={report} />
    </PublicThemeRoot>
  );
}
