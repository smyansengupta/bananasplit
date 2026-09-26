import { normalizeOrgChart, type NormalizedChart } from "./normalize";
import type { OrgChartParse } from "./schema";

/**
 * The starter structure: the roles a student club almost always has, laid
 * out and written up, with nobody in them. An org that has no document to
 * upload picks this instead of an empty page and fills in the names.
 *
 * Every title, responsibility and decision here is a suggestion the admin
 * edits or deletes in the draft editor. It goes through the same
 * normalizeOrgChart() as a parsed document, so the keys, the recomputed
 * manages and the advisor rules are identical.
 */

const positions: OrgChartParse["positions"] = [
  {
    id: "president",
    title: "President",
    person_name: null,
    reports_to: null,
    manages: [],
    responsibilities: [
      "Sets the semester's goals and priorities",
      "Owns partnerships and relationships outside the club",
      "Runs the weekly exec meeting",
      "Represents the club to the university",
    ],
    decides_alone: ["Budget (final say)", "New partnerships", "Board changes"],
    is_open: false,
    is_advisor: false,
    source_quote: [],
  },
  {
    id: "advisor",
    title: "Faculty Advisor",
    person_name: null,
    reports_to: "president",
    manages: [],
    responsibilities: ["Advises the President", "Provides continuity between boards"],
    decides_alone: [],
    is_open: false,
    is_advisor: true,
  source_quote: [],
  },
  {
    id: "vp-operations",
    title: "VP Operations",
    person_name: null,
    reports_to: "president",
    manages: [],
    responsibilities: [
      "Owns the semester calendar and the task board",
      "Collects updates from the leads and flags blockers",
      "Makes sure events and projects land on time",
    ],
    decides_alone: ["Deadlines", "Task assignments", "Internal process"],
    is_open: false,
    is_advisor: false,
    source_quote: [],
  },
  {
    id: "vp-growth",
    title: "VP Growth",
    person_name: null,
    reports_to: "president",
    manages: [],
    responsibilities: [
      "Owns membership growth and event turnout",
      "Owns the club's brand on campus",
      "Leads recruitment for the next board",
    ],
    decides_alone: ["Campus outreach", "Brand decisions"],
    is_open: false,
    is_advisor: false,
    source_quote: [],
  },
  {
    id: "head-of-finance",
    title: "Head of Finance",
    person_name: null,
    reports_to: "president",
    manages: [],
    responsibilities: [
      "Keeps the budget and the spending records",
      "Processes reimbursements and purchase requests",
      "Supports funding applications",
    ],
    decides_alone: ["Approving spend under the set limit"],
    is_open: false,
    is_advisor: false,
    source_quote: [],
  },
  {
    id: "head-of-programs",
    title: "Head of Programs",
    person_name: null,
    reports_to: "vp-operations",
    manages: [],
    responsibilities: [
      "Owns the workshop plan: topics, order and dates",
      "Recruits and preps presenters",
      "Runs logistics: rooms, food and day-of setup",
    ],
    decides_alone: [],
    is_open: false,
    is_advisor: false,
    source_quote: [],
  },
  {
    id: "head-of-tech",
    title: "Head of Tech",
    person_name: null,
    reports_to: "vp-operations",
    manages: [],
    responsibilities: ["Owns the website and the club's internal tools", "Owns check-in and attendance data"],
    decides_alone: [],
    is_open: false,
    is_advisor: false,
    source_quote: [],
  },
  {
    id: "head-of-social",
    title: "Head of Social & Membership",
    person_name: null,
    reports_to: "vp-growth",
    manages: [],
    responsibilities: [
      "Owns the content calendar and promotes every event",
      "Welcomes new members and keeps the community active",
    ],
    decides_alone: [],
    is_open: false,
    is_advisor: false,
    source_quote: [],
  },
  {
    id: "designer",
    title: "Graphic Designer",
    person_name: null,
    reports_to: "vp-growth",
    manages: [],
    responsibilities: ["Owns the brand kit: colours, fonts and templates", "Designs event and social graphics"],
    decides_alone: [],
    is_open: true,
    is_advisor: false,
    source_quote: [],
  },
];

export const STARTER_PARSE: OrgChartParse = {
  positions,
  open_items: [
    { who: "President", question: "Who holds each role this semester?" },
    { who: "President", question: "Which roles are still open, and when do they get filled?" },
  ],
};

/** The starter structure, normalized exactly like a parsed document. */
export function starterChart(): NormalizedChart {
  return normalizeOrgChart(STARTER_PARSE);
}

export const STARTER_ROLE_COUNT = positions.length;
