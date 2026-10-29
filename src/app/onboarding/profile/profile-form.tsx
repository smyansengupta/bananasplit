"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { usePreviewNext } from "@/components/onboarding/preview-flow";
import {
  ContinuePill,
  SetupCard,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import type { UserAvatarUser } from "@/components/user-avatar";
import type { ProfileLink } from "@/lib/profile/links";

import { saveBasicsStep, saveBioStep } from "./actions";
import { BasicsFields, type BasicsValue } from "./basics-step";
import { BioFields, type BioValue } from "./bio-step";

/**
 * Your profile, on one screen, at the end of every onboarding flow: picture
 * and name, time zone, pronouns (in an organization; `pronouns`), bio and
 * links. Your title in an organization is its admins' to set. One Continue
 * saves it all, then `next`.
 */
export function ProfileForm({
  title,
  intro,
  user,
  initial,
  pronouns = true,
  next,
  back,
  continueLabel = "Done",
}: {
  title: string;
  intro?: string;
  user: UserAvatarUser;
  initial: BasicsValue & { bio: string | null; links: ProfileLink[] };
  /** Ask for pronouns (organizations); a personal workspace doesn't. */
  pronouns?: boolean;
  next: string;
  back?: string;
  continueLabel?: string;
}) {
  const router = useRouter();
  const preview = usePreviewNext();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [basics, setBasics] = useState<BasicsValue>({
    name: initial.name,
    pronouns: initial.pronouns,
    timezone: initial.timezone,
  });
  const [bio, setBio] = useState<BioValue>({ bio: initial.bio ?? "", links: initial.links });

  function submit() {
    setErrors({});
    if (preview) return router.push(preview);
    start(async () => {
      const about = await saveBasicsStep({
        name: basics.name,
        pronouns: basics.pronouns || null,
        timezone: basics.timezone,
      });
      if (!about.ok) return setErrors(about.fieldErrors);
      const more = await saveBioStep({ bio: bio.bio || null, links: bio.links });
      if (!more.ok) return setErrors(more.fieldErrors);
      router.push(next);
    });
  }

  return (
    <SetupCard>
      <StepIntro title={title}>{intro}</StepIntro>
      <div className="mt-[22px] flex flex-1 flex-col gap-4">
        <BasicsFields
          user={user}
          value={basics}
          onChange={setBasics}
          errors={errors}
          pronouns={pronouns}
        />
        <BioFields value={bio} onChange={setBio} errors={errors} />
        <StepError message={errors.form} />
        <StepFooter back={back ? { href: back } : undefined}>
          <ContinuePill pending={pending} onClick={submit} disabled={!basics.name.trim()}>
            {continueLabel}
          </ContinuePill>
        </StepFooter>
      </div>
    </SetupCard>
  );
}
