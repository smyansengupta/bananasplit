import { normalizeOrgChart, type NormalizedChart } from "./normalize";
import type { OrgChartParse } from "./schema";
import { STARTER_PARSE } from "./starter";

/**
 * The shapes an org chart can start from ("Start from a shape"): seats
 * with titles and reporting lines, nobody in them. Each goes through
 * normalizeOrgChart() like a parsed document. "starter" is the written-up
 * starter structure (src/lib/org-chart/starter.ts); the other two are bare
 * seats, filled in on the seat screen.
 */

export const SHAPE_IDS = ["starter", "committees", "team"] as const;
export type ShapeId = (typeof SHAPE_IDS)[number];

type Seat = OrgChartParse["positions"][number];

function seat(id: string, title: string, reportsTo: string | null, isAdvisor = false): Seat {
  return {
    id,
    title,
    person_name: null,
    reports_to: reportsTo,
    manages: [],
    responsibilities: [],
    decides_alone: [],
    is_open: false,
    is_advisor: isAdvisor,
    source_quote: [],
  };
}

const COMMITTEES: OrgChartParse = {
  positions: [
    seat("chair", "Chair", null),
    seat("vice-chair", "Vice Chair", "chair"),
    seat("events-chair", "Events Committee Chair", "chair"),
    seat("outreach-chair", "Outreach Committee Chair", "chair"),
    seat("finance-chair", "Finance Committee Chair", "chair"),
  ],
  open_items: [],
};

const TEAM: OrgChartParse = {
  positions: [
    seat("lead", "Lead", null),
    seat("team-1", "Team Member", "lead"),
    seat("team-2", "Team Member", "lead"),
    seat("team-3", "Team Member", "lead"),
  ],
  open_items: [],
};

export const SHAPES: readonly { id: ShapeId; label: string }[] = [
  { id: "starter", label: "A president and VPs" },
  { id: "committees", label: "Committees with chairs" },
  { id: "team", label: "One lead and a team" },
];

export function isShape(value: string): value is ShapeId {
  return (SHAPE_IDS as readonly string[]).includes(value);
}

/** A shape's seats, normalized exactly like a parsed document. */
export function shapeChart(id: ShapeId): NormalizedChart {
  return normalizeOrgChart(
    id === "starter" ? STARTER_PARSE : id === "committees" ? COMMITTEES : TEAM,
  );
}
