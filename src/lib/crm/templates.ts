import type { CrmStageKind } from "@/generated/prisma/enums";

/**
 * The CRM's one-step setup (docs/features/crm.md, "Organization setup in
 * one step"): what an organization says it mostly reaches out to, and what
 * each answer makes. Pure and client-safe: the setup screen shows it, the
 * server builds from it.
 *
 * Every pipeline names what it tracks (an applicant, a donation, a deal)
 * and its closing labels (Joined / Didn't join). Stage keys
 * are stable, so a renamed stage still means the same thing to Finance and
 * to later phases.
 */

export const SETUP_KINDS = [
  "members",
  "donors",
  "sponsors",
  "speakers",
  "alumni",
  "vendors",
  "clients",
  "grants",
] as const;
export type SetupKind = (typeof SETUP_KINDS)[number];

export interface SetupKindInfo {
  id: SetupKind;
  label: string;
  /** One short line under it on the setup screen. */
  hint: string;
  /** Icon name (@/components/icons). */
  icon: string;
}

export const SETUP_KIND_INFO: Record<SetupKind, SetupKindInfo> = {
  members: {
    id: "members",
    label: "Members and volunteers",
    hint: "Interested people, applicants, new joiners",
    icon: "UserPlus",
  },
  donors: { id: "donors", label: "Donors", hint: "Asks, pledges and thank-yous", icon: "HandCoins" },
  sponsors: {
    id: "sponsors",
    label: "Partners and deals",
    hint: "From first ask to money received",
    icon: "Handshake",
  },
  speakers: {
    id: "speakers",
    label: "Speakers and guests",
    hint: "Judges, mentors, panelists",
    icon: "Mic",
  },
  alumni: { id: "alumni", label: "Alumni", hint: "Past members you keep in touch with", icon: "GraduationCap" },
  vendors: {
    id: "vendors",
    label: "Press, venues and vendors",
    hint: "Quotes and bookings",
    icon: "Package",
  },
  clients: { id: "clients", label: "Clients", hint: "Leads, proposals and work won", icon: "Briefcase" },
  grants: { id: "grants", label: "Grants", hint: "Applications and awards", icon: "PiggyBank" },
};

/**
 * A Personal space's answers (one person's CRM): no members or alumni to
 * keep, so those two don't show, and clients come first.
 */
export const PERSONAL_SETUP_KINDS = [
  "clients",
  "sponsors",
  "speakers",
  "vendors",
  "grants",
  "donors",
] as const satisfies readonly SetupKind[];

/** The setup answers a space is offered: a Personal space's few, or all of them. */
export function setupKindsFor(personal: boolean): readonly SetupKind[] {
  return personal ? PERSONAL_SETUP_KINDS : SETUP_KINDS;
}

/** How an answer reads in a Personal space, where it differs. */
const PERSONAL_KIND_INFO: Partial<Record<SetupKind, Partial<SetupKindInfo>>> = {
  speakers: { label: "Mentors and guests", hint: "Mentors, speakers, people you invite" },
  clients: { hint: "Leads, proposals and paid work" },
};

/** An answer's label and hint for this space. */
export function setupKindInfo(kind: SetupKind, personal: boolean): SetupKindInfo {
  return personal ? { ...SETUP_KIND_INFO[kind], ...PERSONAL_KIND_INFO[kind] } : SETUP_KIND_INFO[kind];
}

export interface StageTemplate {
  key: string;
  name: string;
  kind: CrmStageKind;
  probability?: number;
  stuckAfterDays?: number;
  /** Field keys required to move an item in (closeReason on lost stages). */
  requiredFields?: string[];
  color?: string;
}

export interface PipelineTemplate {
  /** The setup kind it comes from (CrmPipeline.template). */
  template: SetupKind;
  name: string;
  itemNoun: string;
  itemNounPlural: string;
  icon: string;
  color: string;
  hasAmount: boolean;
  wonLabel: string;
  lostLabel: string;
  stages: StageTemplate[];
}

const lost = (key: string, name: string): StageTemplate => ({
  key,
  name,
  kind: "LOST",
  probability: 0,
  requiredFields: ["closeReason"],
  color: "red",
});

export const PIPELINE_TEMPLATES: Partial<Record<SetupKind, PipelineTemplate>> = {
  members: {
    template: "members",
    name: "New members",
    itemNoun: "applicant",
    itemNounPlural: "applicants",
    icon: "UserPlus",
    color: "blue",
    hasAmount: false,
    wonLabel: "Joined",
    lostLabel: "Didn't join",
    stages: [
      { key: "INTERESTED", name: "Interested", kind: "OPEN", probability: 10, stuckAfterDays: 14 },
      { key: "REACHED_OUT", name: "Reached out", kind: "OPEN", probability: 25, stuckAfterDays: 7 },
      { key: "TALKED", name: "Talked", kind: "OPEN", probability: 50, stuckAfterDays: 14 },
      { key: "APPLIED", name: "Applied", kind: "OPEN", probability: 75, stuckAfterDays: 14 },
      { key: "JOINED", name: "Joined", kind: "WON", probability: 100, color: "green" },
      lost("DIDNT_JOIN", "Didn't join"),
    ],
  },
  donors: {
    template: "donors",
    name: "Donations",
    itemNoun: "donation",
    itemNounPlural: "donations",
    icon: "HandCoins",
    color: "pink",
    hasAmount: true,
    wonLabel: "Received",
    lostLabel: "Declined",
    stages: [
      { key: "IDENTIFIED", name: "Identified", kind: "OPEN", probability: 10, stuckAfterDays: 30 },
      { key: "ASKED", name: "Asked", kind: "OPEN", probability: 30, stuckAfterDays: 14 },
      { key: "PLEDGED", name: "Pledged", kind: "OPEN", probability: 80, stuckAfterDays: 30 },
      { key: "RECEIVED", name: "Received", kind: "WON", probability: 100, color: "green" },
      { key: "THANKED", name: "Thanked", kind: "WON", probability: 100, color: "teal" },
      lost("DECLINED", "Declined"),
    ],
  },
  sponsors: {
    template: "sponsors",
    name: "Deals",
    itemNoun: "deal",
    itemNounPlural: "deals",
    icon: "Handshake",
    color: "yellow",
    hasAmount: true,
    wonLabel: "Received",
    lostLabel: "Declined",
    // The keys are SponsorshipStatus values: Finance's own stages (Finance › Deals).
    // The template id "sponsors" is stored (CrmPipeline.template), so it keeps its name.
    stages: [
      { key: "PROSPECT", name: "Prospect", kind: "OPEN", probability: 10, stuckAfterDays: 21 },
      { key: "COMMITTED", name: "Committed", kind: "OPEN", probability: 70, stuckAfterDays: 30 },
      { key: "INVOICED", name: "Invoiced", kind: "OPEN", probability: 90, stuckAfterDays: 30 },
      { key: "RECEIVED", name: "Received", kind: "WON", probability: 100, color: "green" },
      lost("DECLINED", "Declined"),
      lost("WRITTEN_OFF", "Written off"),
    ],
  },
  speakers: {
    template: "speakers",
    name: "Speakers and guests",
    itemNoun: "invitation",
    itemNounPlural: "invitations",
    icon: "Mic",
    color: "purple",
    hasAmount: false,
    wonLabel: "Done",
    lostLabel: "Declined",
    stages: [
      { key: "INVITED", name: "Invited", kind: "OPEN", probability: 30, stuckAfterDays: 7 },
      { key: "CONFIRMED", name: "Confirmed", kind: "OPEN", probability: 80, stuckAfterDays: 21 },
      { key: "BRIEFED", name: "Briefed", kind: "OPEN", probability: 90, stuckAfterDays: 21 },
      { key: "DONE", name: "Done", kind: "WON", probability: 100, color: "green" },
      { key: "THANKED", name: "Thanked", kind: "WON", probability: 100, color: "teal" },
      lost("DECLINED", "Declined"),
    ],
  },
  vendors: {
    template: "vendors",
    name: "Venues and vendors",
    itemNoun: "booking",
    itemNounPlural: "bookings",
    icon: "Package",
    color: "orange",
    hasAmount: true,
    wonLabel: "Booked",
    lostLabel: "Passed",
    stages: [
      { key: "CONTACTED", name: "Contacted", kind: "OPEN", probability: 20, stuckAfterDays: 7 },
      { key: "QUOTED", name: "Quoted", kind: "OPEN", probability: 60, stuckAfterDays: 14 },
      { key: "BOOKED", name: "Booked", kind: "WON", probability: 100, color: "green" },
      lost("PASSED", "Passed"),
    ],
  },
  clients: {
    template: "clients",
    name: "Clients",
    itemNoun: "deal",
    itemNounPlural: "deals",
    icon: "Briefcase",
    color: "teal",
    hasAmount: true,
    wonLabel: "Won",
    lostLabel: "Lost",
    stages: [
      { key: "LEAD", name: "Lead", kind: "OPEN", probability: 10, stuckAfterDays: 14 },
      { key: "QUALIFIED", name: "Qualified", kind: "OPEN", probability: 30, stuckAfterDays: 14 },
      { key: "PROPOSAL", name: "Proposal", kind: "OPEN", probability: 60, stuckAfterDays: 21 },
      { key: "WON", name: "Won", kind: "WON", probability: 100, color: "green" },
      lost("LOST", "Lost"),
    ],
  },
  grants: {
    template: "grants",
    name: "Grants",
    itemNoun: "grant",
    itemNounPlural: "grants",
    icon: "PiggyBank",
    color: "brown",
    hasAmount: true,
    wonLabel: "Awarded",
    lostLabel: "Declined",
    stages: [
      { key: "RESEARCHING", name: "Researching", kind: "OPEN", probability: 10, stuckAfterDays: 30 },
      { key: "DRAFTING", name: "Drafting", kind: "OPEN", probability: 30, stuckAfterDays: 21 },
      { key: "SUBMITTED", name: "Submitted", kind: "OPEN", probability: 50, stuckAfterDays: 60 },
      { key: "AWARDED", name: "Awarded", kind: "WON", probability: 100, color: "green" },
      lost("DECLINED", "Declined"),
    ],
  },
};

/** A blank pipeline someone makes by hand. */
export function blankPipeline(name: string, noun: string): PipelineTemplate {
  const n = noun.trim() || "item";
  return {
    template: "clients",
    name,
    itemNoun: n,
    itemNounPlural: n.endsWith("s") ? n : `${n}s`,
    icon: "Columns3",
    color: "gray",
    hasAmount: false,
    wonLabel: "Won",
    lostLabel: "Lost",
    stages: [
      { key: "NEW", name: "New", kind: "OPEN", probability: 10, stuckAfterDays: 14 },
      { key: "IN_PROGRESS", name: "In progress", kind: "OPEN", probability: 50, stuckAfterDays: 14 },
      { key: "WON", name: "Won", kind: "WON", probability: 100, color: "green" },
      lost("LOST", "Lost"),
    ],
  };
}

export interface RelationshipType {
  id: string;
  label: string;
  color: string;
}

/** The relationship types each setup answer adds (CrmSettings.relationshipTypes). */
export const RELATIONSHIP_TYPES: Record<SetupKind, RelationshipType[]> = {
  members: [
    { id: "prospect", label: "Prospective member", color: "blue" },
    { id: "volunteer", label: "Volunteer", color: "teal" },
  ],
  donors: [{ id: "donor", label: "Donor", color: "pink" }],
  sponsors: [{ id: "partner", label: "Partner", color: "orange" }],
  speakers: [
    { id: "speaker", label: "Speaker", color: "purple" },
    { id: "mentor", label: "Mentor", color: "purple" },
  ],
  alumni: [{ id: "alumni", label: "Alumni", color: "brown" }],
  vendors: [
    { id: "press", label: "Press", color: "gray" },
    { id: "vendor", label: "Vendor", color: "gray" },
  ],
  clients: [{ id: "client", label: "Client", color: "green" }],
  grants: [{ id: "funder", label: "Funder", color: "green" }],
};

/** Members of the organization, when brought in from Bananasplit. */
export const MEMBER_RELATIONSHIP: RelationshipType = { id: "member", label: "Member", color: "blue" };

/**
 * The relationship types for a set of answers, each once, in setup order.
 * An organization's start with Member; a Personal space has no members.
 */
export function relationshipTypesFor(
  kinds: readonly SetupKind[],
  options: { personal?: boolean } = {},
): RelationshipType[] {
  const out: RelationshipType[] = options.personal ? [] : [MEMBER_RELATIONSHIP];
  const seen = new Set(out.map((t) => t.id));
  for (const k of SETUP_KINDS) {
    if (!kinds.includes(k)) continue;
    for (const t of RELATIONSHIP_TYPES[k]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

/** The pipelines a set of answers makes, in setup order (alumni have a cadence, not a pipeline). */
export function pipelinesFor(kinds: readonly SetupKind[]): PipelineTemplate[] {
  return SETUP_KINDS.filter((k) => kinds.includes(k))
    .map((k) => PIPELINE_TEMPLATES[k])
    .filter((t): t is PipelineTemplate => Boolean(t));
}

/** Alumni are kept in touch with on a cadence, in days. */
export const ALUMNI_KEEP_IN_TOUCH_DAYS = 90;

/** A saved view setup makes (CrmView): filters in the database view grammar. */
export interface ViewTemplate {
  objectKind: "people" | "companies" | "deals";
  name: string;
  filters: { col: string; op: string; value: string }[];
  /** Only made when this answer was picked. */
  when?: SetupKind;
}

/** "me" in a filter value is the viewer. */
export const ME = "me";

export const DEFAULT_VIEWS: ViewTemplate[] = [
  { objectKind: "people", name: "Mine", filters: [{ col: "owner", op: "eq", value: ME }] },
  { objectKind: "people", name: "Follow-ups due", filters: [{ col: "followUp", op: "lte", value: "today" }] },
  { objectKind: "people", name: "Alumni", filters: [{ col: "relationship", op: "eq", value: "alumni" }], when: "alumni" },
  { objectKind: "people", name: "Donors", filters: [{ col: "relationship", op: "eq", value: "donor" }], when: "donors" },
  { objectKind: "companies", name: "Mine", filters: [{ col: "owner", op: "eq", value: ME }] },
  { objectKind: "deals", name: "Mine", filters: [{ col: "owner", op: "eq", value: ME }] },
];

export function viewsFor(kinds: readonly SetupKind[]): ViewTemplate[] {
  return DEFAULT_VIEWS.filter((v) => !v.when || kinds.includes(v.when));
}

/** Database keys (DatabaseDefinition.key) of the CRM's databases. */
export const CRM_DB_KEYS = { people: "crm-people", companies: "crm-companies" } as const;

export function pipelineDbKey(pipelineId: string): string {
  return `crm-pipeline-${pipelineId.slice(-10).toLowerCase()}`;
}
