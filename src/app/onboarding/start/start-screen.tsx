import { Check, Plus, UserRound, Users, type IconComponent } from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { SetupShell } from "@/components/onboarding/setup-shell";
import { TRIAL_DAYS } from "@/lib/billing/space";
import { PERSONAL_STEPS, setupStepHref } from "@/lib/onboarding/steps";

import { PendingInviteCard, type PendingInviteView } from "../pending-invite-card";

/** Where the three choices go (the dev preview points them at its own screens). */
export interface StartHrefs {
  join: string;
  create: string;
  personal: string;
}

const HREFS: StartHrefs = {
  join: "/onboarding/join",
  create: "/onboarding/organization",
  personal: setupStepHref("personal", "", PERSONAL_STEPS[0]),
};

/**
 * "What brings you here?": email invites waiting for this address, then
 * three choices in one card style (a small icon, a title, one line).
 */
export function StartScreen({
  first,
  invites,
  exit,
  hrefs = HREFS,
}: {
  first: string | undefined;
  invites: readonly PendingInviteView[];
  exit: ReactNode;
  hrefs?: StartHrefs;
}) {
  return (
    <SetupShell exit={exit}>
      <div className="flex w-full max-w-[880px] flex-col items-center gap-10 pt-[clamp(16px,4vw,48px)] pb-10">
        <h1 className="display-title m-0 text-center text-[clamp(36px,5vw,56px)] leading-[1] tracking-[-0.04em] text-balance">
          {first ? `Welcome, ${first}.` : "Welcome."} What brings you here?
        </h1>

        {invites.length > 0 && (
          <section className="flex w-full flex-col gap-2">
            <h2 className="text-muted-foreground m-0 text-[13px] font-semibold">
              You&apos;re invited
            </h2>
            {invites.map((invitation) => (
              <PendingInviteCard key={invitation.id} invitation={invitation} />
            ))}
          </section>
        )}

        <ul className="m-0 grid w-full list-none gap-3 p-0 md:grid-cols-3">
          <Choice
            href={hrefs.join}
            icon={Users}
            title="Join an organization"
            body="Enter its invite code. You'll see who's in first."
          >
            <JoinPicture />
          </Choice>
          <Choice
            href={hrefs.create}
            icon={Plus}
            title="Create an organization"
            body={`Every feature, free for ${TRIAL_DAYS} days.`}
          >
            <CreatePicture />
          </Choice>
          <Choice
            href={hrefs.personal}
            icon={UserRound}
            title="Just me"
            body="Your own tasks, calendar and notes."
          >
            <PersonalPicture />
          </Choice>
        </ul>
      </div>
    </SetupShell>
  );
}

/** The home page's picture panel (features.tsx): real content, small. */
const PICTURE = "bg-muted/70 rounded-[14px] p-3.5";

const PEOPLE = [
  { initials: "MC", tone: "bg-(--tag-ochre)/12 text-(--tag-ochre)" },
  { initials: "JP", tone: "bg-(--tag-teal)/12 text-(--tag-teal)" },
  { initials: "SO", tone: "bg-(--tag-rust)/12 text-(--tag-rust)" },
  { initials: "AK", tone: "bg-(--tag-plum)/12 text-(--tag-plum)" },
] as const;

/** What a code shows before you join: the organization and who's in it. */
function JoinPicture() {
  return (
    <span className={`${PICTURE} flex items-center justify-between gap-2`}>
      <span className="flex">
        {PEOPLE.map(({ initials, tone }) => (
          <span
            key={initials}
            className={`ring-muted -ml-2 grid size-8 place-items-center rounded-full text-[11px] font-bold ring-2 first:ml-0 ${tone}`}
          >
            {initials}
          </span>
        ))}
      </span>
      <span className="flex flex-col items-end text-[11px] leading-tight">
        <span className="font-semibold">Acme Labs</span>
        <span className="text-muted-foreground">34 members</span>
      </span>
    </span>
  );
}

/** What you get: the workspace's sections, on the trial. */
function CreatePicture() {
  return (
    <span className={`${PICTURE} flex flex-col gap-1.5 text-[12px]`}>
      {["Tasks", "Calendar", "Finance"].map((name, i) => (
        <span
          key={name}
          className={`flex items-center gap-2 rounded-[8px] px-2 py-1 font-semibold ${i === 0 ? "bg-card" : "text-muted-foreground"}`}
        >
          <span
            className={`size-1.5 rounded-full ${i === 0 ? "bg-foreground" : "bg-foreground/20"}`}
          />
          {name}
        </span>
      ))}
    </span>
  );
}

/** Your own to-dos, with their dates. */
function PersonalPicture() {
  return (
    <span className={`${PICTURE} flex flex-col gap-1.5 text-[12px]`}>
      {[
        { task: "Renew passport", due: "Fri", done: true },
        { task: "Book dentist", due: "Mon", done: false },
        { task: "Plan the trip", due: "Jun 2", done: false },
      ].map(({ task, due, done }) => (
        <span key={task} className="flex items-center gap-2">
          <span
            className={`grid size-3.5 flex-none place-items-center rounded-[4px] border ${done ? "bg-foreground border-foreground text-background" : "border-foreground/25"}`}
          >
            {done && <Check className="size-2.5" strokeWidth={4} />}
          </span>
          <span
            className={`flex-1 font-semibold ${done ? "text-muted-foreground line-through" : ""}`}
          >
            {task}
          </span>
          <span className="text-muted-foreground">{due}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * A choice, the home page's feature card (features.tsx): a symbol, a claim,
 * a line, and a small picture of what it gets you. The whole card is the
 * link; every card hovers the same way.
 */
function Choice({
  href,
  icon: Icon,
  title,
  body,
  children,
}: {
  href: string;
  icon: IconComponent;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        data-plain
        className="border-border bg-card hover:border-foreground/25 flex h-full flex-col gap-4 rounded-[20px] border p-5 transition-[border-color,box-shadow] hover:shadow-[var(--elevation-2)]"
      >
        <span className="flex items-start gap-3">
          <span className="bg-muted grid size-9 flex-none place-items-center rounded-full">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-[15px] font-semibold">{title}</span>
            <span className="text-foreground/75 text-[14px] leading-[1.5]">{body}</span>
          </span>
        </span>
        <span aria-hidden="true" className="mt-auto">
          {children}
        </span>
      </Link>
    </li>
  );
}
