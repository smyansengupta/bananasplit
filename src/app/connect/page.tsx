import Link from "next/link";

import { SignedInAs } from "@/components/auth/signed-in-as";
import { AuthCard, AuthTitle } from "@/components/brand/auth-card";
import { pill } from "@/components/brand/pill";
import { signInPath } from "@/lib/auth/callback-url";
import { getSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { connectorsConfig } from "@/server/connectors/config";

import { continueConnectAction } from "./actions";
import { connectPath } from "./paths";

/**
 * AuthKit's External Sign-in URI (docs/features/ai-connectors.md): an AI
 * app asked to connect, AuthKit sent the member here with an
 * external_auth_id, and Continue hands them back (a POST, never on load).
 * AuthKit's own consent screen comes next. With AI connectors off
 * (src/server/connectors/config.ts) it only says so.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Connect an AI app · Bananasplit",
  referrer: "no-referrer" as const,
};

const RESULTS = {
  expired: {
    title: "This sign-in expired.",
    description:
      "Go back to the app you were connecting (Claude, ChatGPT or another) and connect again.",
  },
  failed: {
    title: "That didn't work.",
    description: "Go back to the app you were connecting and try again in a minute.",
  },
  limited: {
    title: "Too many connections.",
    description: "You've connected several apps recently. Try again in an hour.",
  },
  unverified: {
    title: "Confirm your email first.",
    description:
      "Open the confirmation link we emailed you, then go back to the app you were connecting and try again.",
  },
  off: {
    title: "AI connectors aren't on here.",
    description: "This Bananasplit doesn't accept AI apps yet.",
  },
} as const;

type Result = keyof typeof RESULTS;

function isResult(value: unknown): value is Result {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RESULTS, value);
}

function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <AuthCard footer={<SignedInAs />}>
      <AuthTitle title={title} description={description} />
      {children}
    </AuthCard>
  );
}

export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const { external_auth_id: rawId, result } = await searchParams;
  const externalAuthId =
    typeof rawId === "string" && rawId.length > 0 && rawId.length <= 512 ? rawId : null;

  if (!connectorsConfig()) {
    return <Shell title={RESULTS.off.title} description={RESULTS.off.description} />;
  }

  if (!externalAuthId) {
    return (
      <Shell
        title="Nothing to connect."
        description="This page opens when an AI app such as Claude or ChatGPT asks to connect to your Bananasplit account."
      >
        <Link href="/app" className={cn(pill(), "w-full")}>
          Go to Bananasplit
        </Link>
      </Shell>
    );
  }

  if (isResult(result)) {
    const copy = RESULTS[result];
    return <Shell title={copy.title} description={copy.description} />;
  }

  const session = await getSession();
  if (!session) {
    return (
      <Shell
        title="Log in to connect."
        description="An AI app wants to connect to your Bananasplit account. Log in, and you'll come straight back here."
      >
        <Link href={signInPath(connectPath(externalAuthId))} className={cn(pill(), "w-full")}>
          Log in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell
      title="Connect an AI app."
      description="An AI app wants to use your Bananasplit account. Next, you'll choose which spaces it can use and whether it can make changes. It only ever sees what you can see here."
    >
      <form action={continueConnectAction.bind(null, externalAuthId)}>
        <button type="submit" className={cn(pill(), "w-full")}>
          Continue as {session.user.email}
        </button>
      </form>
    </Shell>
  );
}
