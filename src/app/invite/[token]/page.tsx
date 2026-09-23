import Link from "next/link";

import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { GoogleIcon } from "@/components/google-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signIn } from "@/lib/auth/config";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { sameEmail } from "@/lib/auth/normalize-email";
import { getSession } from "@/lib/auth/session";
import { findInvitationByRawToken } from "@/lib/invitations";

import { JoinButton } from "./join-button";

function InviteCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </div>
  );
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;

  const invitation = await findInvitationByRawToken(token);
  if (!invitation) {
    return <InviteCard title="Invite not found" description="This invite link isn't valid." />;
  }
  if (invitation.acceptedAt) {
    return <InviteCard title="Already used" description="This invite has already been accepted." />;
  }
  if (invitation.expiresAt < new Date()) {
    return <InviteCard title="Invite expired" description="Ask for a new invite to join." />;
  }

  const session = await getSession();

  if (!session) {
    return (
      <InviteCard
        title={`Join ${invitation.organization.name}`}
        description={`Sign in as ${invitation.email} to accept this invite.`}
      >
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: `/invite/${token}` });
          }}
        >
          <Button type="submit" variant="outline" className="w-full">
            <GoogleIcon className="size-4" />
            Continue with Google
          </Button>
        </form>
        <p className="text-muted-foreground mt-3 text-center text-sm">
          Or{" "}
          <Link href="/sign-in" className="underline underline-offset-4">
            sign in
          </Link>{" "}
          or{" "}
          <Link href="/sign-up" className="underline underline-offset-4">
            create an account
          </Link>{" "}
          with your email, verify it, then open this link again.
        </p>
      </InviteCard>
    );
  }

  // Compare against the account's STORED address, and require it verified:
  // an invite can only be taken by whoever controls the invited mailbox
  // (0A Fix 4).
  const identity = await getUserIdentity(session.user.id);
  if (!identity || !sameEmail(identity.email, invitation.email)) {
    return (
      <InviteCard
        title="Wrong account"
        description={`This invite was sent to ${invitation.email}, but you're signed in as ${identity?.email ?? session.user.email}.`}
      />
    );
  }

  if (!identity.emailVerified) {
    return (
      <InviteCard
        title={`Join ${invitation.organization.name}`}
        description="Verify your email address to accept this invite."
      >
        <VerifyEmailNotice email={identity.email} action="accept this invite" />
      </InviteCard>
    );
  }

  return (
    <InviteCard
      title={`Join ${invitation.organization.name}`}
      description={`You're invited as ${invitation.role.toLowerCase()}.`}
    >
      <JoinButton token={token} orgName={invitation.organization.name} />
    </InviteCard>
  );
}
