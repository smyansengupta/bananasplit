import { describe, expect, it } from "vitest";

import type { DirectoryPerson, DirectoryTeam } from "@/server/profiles/directory";
import { isFreeNow, localSlot } from "@/server/profiles/presence";
import { termTrigrams } from "@/server/profiles/trigrams";

import { applyFilters, groupPeople, letterOf, localMatch } from "./directory-model";
import { directorySearch, EMPTY_QUERY, parseDirectoryQuery } from "./directory-query";
import { bandShare } from "./week-strip";

function person(id: string, extra: Partial<DirectoryPerson> = {}): DirectoryPerson {
  return {
    id,
    name: id,
    image: null,
    avatar: null,
    pronouns: null,
    major: null,
    gradYear: null,
    role: "MEMBER",
    title: null,
    joinedAt: "2026-01-01T00:00:00.000Z",
    teamKey: null,
    freeNow: null,
    ...extra,
  };
}

const teams: DirectoryTeam[] = [
  { key: "lead", name: "Leadership", slot: 1 },
  { key: "growth", name: "Growth", slot: 2 },
];
const teamsByKey = new Map(teams.map((t) => [t.key, t]));
const people = [
  person("u1", { name: "Maya Patel", title: "President", teamKey: "lead", role: "OWNER", gradYear: 2027, major: "Computer science", joinedAt: "2024-09-01T00:00:00.000Z", freeNow: true }),
  person("u2", { name: "Lena Okafor", title: "Sponsorship chair", teamKey: "growth", gradYear: 2028, pronouns: "she/her", joinedAt: "2025-09-01T00:00:00.000Z" }),
  person("u3", { name: "ben carter", title: "Member", gradYear: 2029, joinedAt: "2026-09-01T00:00:00.000Z", freeNow: false }),
  person("u4", { name: "Élodie Roux", title: "VP Growth", teamKey: "growth", role: "ADMIN", gradYear: 2028 }),
];

describe("directory query in the URL", () => {
  it("round-trips and drops defaults", () => {
    const state = { ...EMPTY_QUERY, q: "vp", team: "growth", role: "ADMIN" as const, year: 2028, free: true, sort: "name" as const, view: "grid" as const, person: "u4" };
    const qs = directorySearch(state);
    expect(qs).toBe("q=vp&team=growth&role=admin&year=2028&free=1&sort=name&view=grid&person=u4");
    expect(parseDirectoryQuery(new URLSearchParams(qs))).toEqual(state);
    expect(directorySearch(EMPTY_QUERY)).toBe("");
  });

  it("ignores junk", () => {
    expect(parseDirectoryQuery({ team: "../x", role: "god", year: "99999", sort: "x", view: "x", person: "a b", q: ["  hi  ", "x"] })).toEqual({
      ...EMPTY_QUERY,
      q: "hi",
    });
  });
});

describe("directory list", () => {
  it("matches every word locally across name, title, team, year and role", () => {
    expect(localMatch(people, "growth", teamsByKey).map((p) => p.id)).toEqual(["u2", "u4"]);
    expect(localMatch(people, "2028 vp", teamsByKey).map((p) => p.id)).toEqual(["u4"]);
    expect(localMatch(people, "owner", teamsByKey).map((p) => p.id)).toEqual(["u1"]);
    expect(localMatch(people, "she/her", teamsByKey).map((p) => p.id)).toEqual(["u2"]);
    expect(localMatch(people, "class of 2029", teamsByKey).map((p) => p.id)).toEqual(["u3"]);
    expect(localMatch(people, "", teamsByKey)).toHaveLength(4);
  });

  it("filters by team (or no team), role, year and free now", () => {
    const f = (patch: Partial<typeof EMPTY_QUERY>) => applyFilters(people, { ...EMPTY_QUERY, ...patch }).map((p) => p.id);
    expect(f({ team: "growth" })).toEqual(["u2", "u4"]);
    expect(f({ team: "none" })).toEqual(["u3"]);
    expect(f({ role: "ADMIN" })).toEqual(["u4"]);
    expect(f({ year: 2028 })).toEqual(["u2", "u4"]);
    expect(f({ free: true })).toEqual(["u1"]);
    expect(f({ team: "growth", year: 2029 })).toEqual([]);
  });

  it("groups by team in chart order, with the rest not on the chart", () => {
    const groups = groupPeople(people, "team", teams);
    expect(groups.map((g) => [g.label, g.people.map((p) => p.id)])).toEqual([
      ["Leadership", ["u1"]],
      ["Growth", ["u4", "u2"]],
      ["Not on the chart", ["u3"]],
    ]);
    expect(groups[1].color).toBe("var(--chart-2)");
    // Search results keep their ranking inside a group.
    expect(groupPeople([people[1], people[3]], "team", teams, { ranked: true })[0].people.map((p) => p.id)).toEqual(["u2", "u4"]);
  });

  it("sorts by name into letters (accents folded) and by newest", () => {
    expect(groupPeople(people, "name", teams).map((g) => g.label)).toEqual(["B", "E", "L", "M"]);
    expect(letterOf({ name: "Élodie" })).toBe("E");
    expect(letterOf({ name: "42 Club" })).toBe("#");
    expect(letterOf({ name: null })).toBe("#");
    expect(groupPeople(people, "new", teams)[0].people.map((p) => p.id)).toEqual(["u3", "u4", "u2", "u1"]);
    expect(groupPeople([], "team", teams)).toEqual([]);
  });
});

describe("free now", () => {
  // Monday 2026-10-19, 14:30 in New York (18:30 UTC).
  const monday = new Date("2026-10-19T18:30:00Z");

  it("reads the weekday and hour in the member's own zone", () => {
    expect(localSlot(monday, "America/New_York")).toEqual({ day: 0, hour: 14 });
    expect(localSlot(monday, "Asia/Tokyo")).toEqual({ day: 1, hour: 3 });
    expect(localSlot(monday, "Not/AZone")).toEqual({ day: 0, hour: 18 });
  });

  it("is free unless that hour is busy, never at night, unknown when hidden or never shared", () => {
    const shared = (busy: string[] | null) => ({ busy, shared: busy === null ? null : true });
    expect(isFreeNow(shared([]), "America/New_York", monday)).toBe(true);
    expect(isFreeNow(shared(["0-14"]), "America/New_York", monday)).toBe(false);
    expect(isFreeNow(shared(["0-13", "0-15"]), "America/New_York", monday)).toBe(true);
    expect(isFreeNow(shared([]), "Asia/Tokyo", monday)).toBe(false);
    expect(isFreeNow(shared(null), "America/New_York", monday)).toBeNull();
    // Never filled in: no busy hours, but not free either.
    expect(isFreeNow({ busy: [], shared: false }, "America/New_York", monday)).toBeNull();
  });

  it("folds busy hours into bands for the week strip", () => {
    const busy = new Set(["0-8", "0-9", "0-10", "0-11", "2-12"]);
    expect(bandShare(busy, 0, 8, 12)).toBe(1);
    expect(bandShare(busy, 2, 12, 17)).toBeCloseTo(0.2);
    expect(bandShare(busy, 1, 8, 12)).toBe(0);
  });
});

describe("search trigrams (the fallback score)", () => {
  it("pads each word as pg_trgm does", () => {
    const { grams, gramTerms } = termTrigrams(["mya"]);
    expect(grams).toEqual(["  m", " my", "mya", "ya "]);
    expect(gramTerms).toEqual([0, 0, 0, 0]);
    const two = termTrigrams(["ab", "she/her"]);
    expect(two.grams.filter((_, i) => two.gramTerms[i] === 1)).toEqual(
      expect.arrayContaining(["  s", " sh", "she", "he ", "  h", " he", "her", "er "]),
    );
  });
});
