import { redirect } from "next/navigation";

import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { requireUser } from "@/lib/auth/session";
import { getOnboardingProfile } from "@/server/onboarding/profile";
import { personalHomeHref } from "@/server/personal/space";

import { ReadyAccount } from "./ready-account";

export const metadata = { title: "Welcome · Bananasplit" };

/**
 * /onboarding: where sign-up and sign-in land (docs/features/onboarding-flows.md).
 *
 * A new account is ready the moment it exists: the first visit here posts
 * readyAccountAction (the device's time zone, onboarded, its Personal space
 * with its trial), with nothing to fill in first. Rendering writes nothing,
 * so a prefetch can't do it. Then where sign-up started (?callbackUrl=, when safe:
 * an invite link, "Get started" on the home page), else "What are you here
 * for?" (/onboarding/start). Someone already set up goes to the callback,
 * else their Personal home.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const profile = await getOnboardingProfile(user.id);
  if (!profile) redirect("/auth/session-ended");
  const after = safeCallbackUrl((await searchParams)?.callbackUrl);
  if (!profile.onboardedAt) return <ReadyAccount after={after} />;
  redirect(after ?? (await personalHomeHref(user.id)));
}
