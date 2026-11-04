import type { BringInCounts } from "@/server/crm/bring-in";

import { crmSettingsHref, bookingLinksHref } from "./settings-sections";

/**
 * "Get your CRM started" (docs/features/crm.md, "Getting started"): the strip
 * across the top of Today that sets the CRM up, one question at a time. Each
 * step is done when the thing exists (worked out from the data, never stored),
 * or when it's checked off as not needed. Once every step is one or the other,
 * the strip leaves by itself.
 *
 * Who sees what: owners and admins get the organization's steps, and their
 * own; everyone else only their own (meeting link and signature), and a
 * Personal space has nobody to share people out to. What's checked off lives
 * in two places, because only owners and admins can write the first: the
 * organization's steps in OrgSettings.startedSkipped as "crm:<step>", beside
 * Home's, and a member's own in their InboxItemState rows as
 * "crm:started-<step>" (that table only takes keys of the form "crm:<id>").
 * Those keys are stored, so a step keeps its key when its wording changes.
 * Pure and client-safe.
 */

/** Every step, in the order they're asked. */
export const CRM_STARTED_KEYS = ["kinds", "people", "owner", "booking", "goal", "mailbox"] as const;

export type CrmStartedKey = (typeof CRM_STARTED_KEYS)[number];

/** What's there already, step by step. */
export type CrmStartedState = Record<CrmStartedKey, boolean>;

export interface CrmStartedViewer {
  /** An owner or admin: sees the organization's steps. */
  admin: boolean;
  personal: boolean;
}

export interface CrmStartedStep {
  key: CrmStartedKey;
  /** The step, asked in plain words. */
  question: string;
  /** One short line under it. */
  hint: string;
}

const STEPS: Record<CrmStartedKey, CrmStartedStep> = {
  kinds: {
    key: "kinds",
    question: "Who do you mostly reach out to?",
    hint: "Pick as many as you like. You can add more later.",
  },
  people: {
    key: "people",
    question: "Who should we bring in?",
    hint: "Everyone Bananasplit already knows, in one go.",
  },
  owner: {
    key: "owner",
    question: "Who looks after new people?",
    hint: "Anyone who comes in later follows the same choice.",
  },
  booking: {
    key: "booking",
    question: "Turn on your meeting link?",
    hint: "People pick a time with you. You set your hours in Meetings.",
  },
  goal: {
    key: "goal",
    question: "What's your goal this quarter?",
    hint: "It shows on Today, with how you're doing.",
  },
  mailbox: {
    key: "mailbox",
    question: "What should your emails end with?",
    hint: "This goes at the bottom of every email you send.",
  },
};

/** A member's own steps: every member has them, and only they can check them off. */
export const OWN_STARTED_KEYS: readonly CrmStartedKey[] = ["booking", "mailbox"];

/** The steps this viewer has, in order. */
export function crmStartedSteps(viewer: CrmStartedViewer): CrmStartedStep[] {
  const keys = !viewer.admin
    ? OWN_STARTED_KEYS
    : viewer.personal
      ? CRM_STARTED_KEYS.filter((key) => key !== "owner")
      : CRM_STARTED_KEYS;
  return keys.map((key) => STEPS[key]);
}

export function isCrmStartedStep(value: unknown): value is CrmStartedKey {
  return (CRM_STARTED_KEYS as readonly string[]).includes(value as string);
}

/** The CRM can't run without its first answer, so that one step is never just checked off. */
export function canSkipCrmStep(key: CrmStartedKey): boolean {
  return key !== "kinds";
}

export function isOwnStartedStep(key: CrmStartedKey): boolean {
  return OWN_STARTED_KEYS.includes(key);
}

const ORG_PREFIX = "crm:";
const OWN_PREFIX = "crm:started-";

/** An organization step's entry in OrgSettings.startedSkipped. */
export function orgSkipEntry(key: CrmStartedKey): string {
  return `${ORG_PREFIX}${key}`;
}

/** A member's own step's InboxItemState key. */
export function ownSkipKey(key: CrmStartedKey): string {
  return `${OWN_PREFIX}${key}`;
}

export const OWN_SKIP_KEYS: readonly string[] = OWN_STARTED_KEYS.map(ownSkipKey);

/** One of this list's entries in OrgSettings.startedSkipped: not Home's, nor a retired step's. */
export function isCrmSkipEntry(entry: string): boolean {
  return entry.startsWith(ORG_PREFIX) && isCrmStartedStep(entry.slice(ORG_PREFIX.length));
}

/** What's checked off, out of OrgSettings.startedSkipped and the member's own rows. */
export function readCrmSkipped(
  orgEntries: readonly string[],
  ownKeys: readonly string[],
): CrmStartedKey[] {
  const org = orgEntries.flatMap((e) =>
    e.startsWith(ORG_PREFIX) ? [e.slice(ORG_PREFIX.length)] : [],
  );
  const own = ownKeys.flatMap((k) =>
    k.startsWith(OWN_PREFIX) ? [k.slice(OWN_PREFIX.length)] : [],
  );
  return [...new Set([...org, ...own])].filter(isCrmStartedStep);
}

export type CrmStepStatus = "done" | "skipped" | "todo";

export interface CrmStartedProgress {
  steps: (CrmStartedStep & { status: CrmStepStatus })[];
  /** Done or checked off. */
  finished: number;
  total: number;
  /** Every step is done or checked off: the strip leaves. */
  complete: boolean;
}

/** Each step's status, and whether the strip still shows. */
export function crmStartedProgress(
  viewer: CrmStartedViewer,
  state: CrmStartedState,
  skipped: readonly string[],
): CrmStartedProgress {
  const steps = crmStartedSteps(viewer).map((step) => ({
    ...step,
    status: (state[step.key]
      ? "done"
      : canSkipCrmStep(step.key) && skipped.includes(step.key)
        ? "skipped"
        : "todo") as CrmStepStatus,
  }));
  const finished = steps.filter((s) => s.status !== "todo").length;
  return { steps, finished, total: steps.length, complete: finished === steps.length };
}

/**
 * The next step left to do: the first one, or with `after` the one following
 * it, going round to any left behind by jumping ahead. Null: nothing's left.
 */
export function nextCrmStep(
  steps: readonly { key: CrmStartedKey; status: CrmStepStatus }[],
  after: CrmStartedKey | null = null,
): CrmStartedKey | null {
  const from = after ? steps.findIndex((step) => step.key === after) + 1 : 0;
  const order = [...steps.slice(from), ...steps.slice(0, from)];
  return order.find((step) => step.status === "todo")?.key ?? null;
}

/** Nothing else works until the first answer has made the CRM, so nothing else opens. */
export function canOpenCrmStep(
  steps: readonly { key: CrmStartedKey; status: CrmStepStatus }[],
  key: CrmStartedKey,
): boolean {
  return key === "kinds" || !steps.some((step) => step.key === "kinds" && step.status === "todo");
}

/** Where a finished step goes: the place to change it later. */
export function crmStartedHref(orgSlug: string, key: CrmStartedKey): string {
  switch (key) {
    case "kinds":
      return crmSettingsHref(orgSlug, "deals");
    case "people":
      return crmSettingsHref(orgSlug, "connections", "#import");
    case "owner":
      return crmSettingsHref(orgSlug, "team");
    case "mailbox":
      return crmSettingsHref(orgSlug, "you");
    case "booking":
      return bookingLinksHref(orgSlug);
    case "goal":
      return `/app/${orgSlug}/crm?open=goal`;
  }
}

export type BringInSourceId = "members" | "contacts" | "forms";

export interface BringInChoice {
  id: BringInSourceId;
  label: string;
  /** How many aren't in the CRM yet. */
  n: number;
}

/** Who Bananasplit knows and the CRM doesn't yet, one click each. Nobody waiting: left out. */
export function bringInChoices(counts: BringInCounts, personal: boolean): BringInChoice[] {
  const all: BringInChoice[] = personal
    ? [{ id: "contacts", label: "People who RSVP'd", n: counts.contacts }]
    : [
        { id: "members", label: "Members", n: counts.members },
        { id: "contacts", label: "Event guests", n: counts.contacts },
        { id: "forms", label: "Form answers", n: counts.forms },
      ];
  return all.filter((c) => c.n > 0);
}
