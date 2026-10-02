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
      "Runs the weekly board meeting",
      "Represents the club to the school and to partners",
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
    responsibilities: [
      "Advises the President",
      "Provides continuity between boards",
    ],
    decides_alone: [],
    is_open: false,
    is_advisor: true,
    source_quote: [],
  },
  {
    id: "vice-president",
    title: "Vice President",
    person_name: null,
    reports_to: "president",
    manages: [],
    responsibilities: [
      "Owns the semester calendar and the task board",
      "Collects updates from the leads and flags blockers",
      "Steps in for the President",
    ],
    decides_alone: ["Deadlines", "Task assignments"],
    is_open: false,
    is_advisor: false,
    source_quote: [],
  },
  {
    id: "treasurer",
    title: "Treasurer",
    person_name: null,
    reports_to: "president",
    manages: [],
    responsibilities: [
      "Keeps the budget and the spending records",
      "Processes reimbursements and purchase requests",
      "Applies for funding",
    ],
    decides_alone: ["Approving spend under the set limit"],
    is_open: false,
    is_advisor: false,
    source_quote: [],
  },
  {
    id: "secretary",
    title: "Secretary",
    person_name: null,
    reports_to: "president",
    manages: [],
    responsibilities: [
      "Takes notes at meetings and shares them",
      "Keeps the member list and attendance up to date",
    ],
    decides_alone: [],
    is_open: false,
    is_advisor: false,
    source_quote: [],
  },
  {
    id: "events-lead",
    title: "Events Lead",
    person_name: null,
    reports_to: "vice-president",
    manages: [],
    responsibilities: [
      "Plans events: topics, dates and rooms",
      "Runs day-of logistics: food, setup and check-in",
    ],
    decides_alone: [],
    is_open: false,
    is_advisor: false,
    source_quote: [],
  },
  {
    id: "marketing-lead",
    title: "Marketing Lead",
    person_name: null,
    reports_to: "vice-president",
    manages: [],
    responsibilities: [
      "Promotes every event",
      "Runs the club's social media and brand",
      "Welcomes new members",
    ],
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
