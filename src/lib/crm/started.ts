import type { BringInCounts } from "@/server/crm/bring-in";

import { crmSettingsHref, bookingLinksHref } from "./settings-sections";

/**
 * "Get your CRM started" (docs/features/crm.md, "Getting started"): the
 * panel across the top of Today that sets the CRM up. Each step is done when
 * the thing exists (worked out from the data, never stored), or when it's
 * checked off as not needed. Once every step is one or the other, the panel
 * leaves by itself.
 *
 * Who sees what: owners and admins get the organization's steps, and their
 * own; everyone else only their own (mail and booking link), and a Personal
 * space its own short list. What's checked off lives in two places, because
 * only owners and admins can write the first: the organization's steps in
 * OrgSettings.startedSkipped as "crm:<step>", beside Home's, and a member's
 * own in their InboxItemState rows as "crm:started-<step>" (that table only
 * takes keys of the form "crm:<id>"). Pure and client-safe.
 */

export const CRM_STARTED_KEYS = [
  "kinds",
  "people",
  "owner",
  "mailbox",
  "booking",
  "goal",
  "ai",
  "phone",
] as const;

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
  label: string;
  /** One line on why, under the label. */
  hint: string;
}

const STEPS: Record<CrmStartedKey, CrmStartedStep> = {
  kinds: {
    key: "kinds",
    label: "Pick what you mostly reach out to",
    hint: "It makes your pipelines and lists.",
  },
  people: {
    key: "people",
    label: "Bring people in",
    hint: "Pick who's already here, or drop a spreadsheet.",
  },
  owner: {
    key: "owner",
    label: "Pick who looks after them",
    hint: "New people follow the same choice.",
  },
  mailbox: {
    key: "mailbox",
    label: "Set up your mail",
    hint: "Add your signature. Gmail and Outlook connect here once they arrive.",
  },
  booking: {
    key: "booking",
    label: "Turn on your booking link",
    hint: "People pick a time with you. You set your hours in Meetings.",
  },
  goal: { key: "goal", label: "Set your first goal", hint: "It shows on Today with your pace." },
  ai: {
    key: "ai",
    label: "Add your AI key",
    hint: "Writes drafts and summaries. Nothing sends by itself.",
  },
  phone: {
    key: "phone",
    label: "Calls and texts",
    hint: "Optional. Your own Telnyx or Twilio account.",
  },
};

/** A member's own steps: every member has them, and only they can check them off. */
export const OWN_STARTED_KEYS: readonly CrmStartedKey[] = ["mailbox", "booking"];

const ORG_ORDER: readonly CrmStartedKey[] = CRM_STARTED_KEYS;
const PERSONAL_ORDER: readonly CrmStartedKey[] = [
  "kinds",
  "people",
  "mailbox",
  "booking",
  "goal",
  "ai",
];

/** The steps this viewer has, in order. `without`: what this space can't do (AI off its plan). */
export function crmStartedSteps(
  viewer: CrmStartedViewer,
  without: readonly CrmStartedKey[] = [],
): CrmStartedStep[] {
  const order = !viewer.admin ? OWN_STARTED_KEYS : viewer.personal ? PERSONAL_ORDER : ORG_ORDER;
  return order.filter((key) => !without.includes(key)).map((key) => STEPS[key]);
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

/** What's checked off, out of OrgSettings.startedSkipped and the member's own rows. */
export function readCrmSkipped(
  orgEntries: readonly string[],
  ownKeys: readonly string[],
): CrmStartedKey[] {
  const org = orgEntries.flatMap((e) => (e.startsWith(ORG_PREFIX) ? [e.slice(ORG_PREFIX.length)] : []));
  const own = ownKeys.flatMap((k) => (k.startsWith(OWN_PREFIX) ? [k.slice(OWN_PREFIX.length)] : []));
  return [...new Set([...org, ...own])].filter(isCrmStartedStep);
}

export type CrmStepStatus = "done" | "skipped" | "todo";

export interface CrmStartedProgress {
  steps: (CrmStartedStep & { status: CrmStepStatus })[];
  /** Done or checked off. */
  finished: number;
  total: number;
  /** Every step is done or checked off: the panel leaves. */
  complete: boolean;
}

/** Each step's status, and whether the panel still shows. */
export function crmStartedProgress(
  viewer: CrmStartedViewer,
  state: CrmStartedState,
  skipped: readonly string[],
  without: readonly CrmStartedKey[] = [],
): CrmStartedProgress {
  const steps = crmStartedSteps(viewer, without).map((step) => ({
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

/** Where a finished step's chip goes: the place to change it later. */
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
    case "ai":
      return crmSettingsHref(orgSlug, "connections", "#ai");
    case "phone":
      return crmSettingsHref(orgSlug, "connections", "#phone");
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
