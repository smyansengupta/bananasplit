"use server";

import { redirect } from "next/navigation";

import { signInPath } from "@/lib/auth/callback-url";
import { getSession } from "@/lib/auth/session";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { connectorsConfig } from "@/server/connectors/config";
import { ACCESS_CLAIM, ALL_SPACES, SPACE_CLAIM } from "@/server/connectors/token";
import { completeExternalAuth, type ConsentOption } from "@/server/connectors/workos";
import { withUserTx } from "@/server/db/context";

import { connectPath } from "./paths";

/** At most 20 connections an hour per account. */
const CONNECT_LIMIT = { limit: 20, windowSec: 60 * 60 } as const;

function splitName(name: string | null): { firstName?: string; lastName?: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || undefined };
}

/**
 * Continue on /connect: hands the signed-in member to AuthKit (Standalone
 * Connect's complete call, outside any transaction), with the two consent
 * questions AuthKit asks next: which spaces, and read or change. Every
 * refusal comes back to /connect with a result the page explains.
 */
export async function continueConnectAction(externalAuthId: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect(signInPath(connectPath(externalAuthId)));
  const back = (result: string) => redirect(connectPath(externalAuthId, result));

  const config = connectorsConfig();
  if (!config) return back("off");

  const limited = await checkRateLimit(
    rateLimitKey("connector.connect", session.user.id),
    CONNECT_LIMIT.limit,
    CONNECT_LIMIT.windowSec,
  );
  if (!limited.allowed) return back("limited");

  const account = await withUserTx(session.user.id, async ({ db }) => {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, name: true, emailVerified: true },
    });
    const memberships = await db.membership.findMany({
      where: { userId: session.user.id },
      select: { organization: { select: { id: true, name: true, kind: true } } },
      orderBy: { organization: { name: "asc" } },
    });
    return { user, spaces: memberships.map((m) => m.organization) };
  });
  if (!account.user) return back("failed");
  if (!account.user.emailVerified) return back("unverified");

  const personal = account.spaces.filter((s) => s.kind === "PERSONAL");
  const clubs = account.spaces.filter((s) => s.kind !== "PERSONAL");
  const consentOptions: ConsentOption[] = [
    {
      claim: SPACE_CLAIM,
      type: "enum",
      label: "Which spaces it can use",
      choices: [
        { value: ALL_SPACES, label: "Personal and all my clubs" },
        ...personal.map((s) => ({ value: s.id, label: "Personal only" })),
        ...clubs.map((s) => ({ value: s.id, label: `${s.name} only` })),
      ],
    },
    {
      claim: ACCESS_CLAIM,
      type: "enum",
      label: "What it can do",
      choices: [
        { value: "read", label: "Read only" },
        { value: "write", label: "Read and make changes" },
      ],
    },
  ];

  const result = await completeExternalAuth(config, {
    externalAuthId,
    user: { id: session.user.id, email: account.user.email, ...splitName(account.user.name) },
    consentOptions,
  });
  if (!result.ok) {
    console.warn("[connectors] complete refused", {
      status: result.status,
      code: result.code,
      message: result.message,
    });
    return back(result.status === 400 || result.status === 404 ? "expired" : "failed");
  }

  // Only ever back to AuthKit: never an address from anywhere else.
  let target: URL;
  try {
    target = new URL(result.data.redirect_uri);
  } catch {
    return back("failed");
  }
  if (target.origin !== config.authkitOrigin) {
    console.warn("[connectors] complete returned another origin", { origin: target.origin });
    return back("failed");
  }
  redirect(target.toString());
}
