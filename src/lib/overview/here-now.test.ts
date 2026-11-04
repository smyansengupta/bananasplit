import { describe, expect, it } from "vitest";

import { hereFinding, type HerePerson } from "./here-now";

const NOW = new Date("2026-11-01T15:00:00.000Z");
const HOME = "/app/cbc";
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const runOfShow = { href: "/app/cbc/notes/n1", label: "Run of show" };
const workshop = { href: "/app/cbc/meetings/w8", label: "Workshop 8" };

const oliver: HerePerson = { id: "u1", name: "Oliver Ward", where: runOfShow };
const lucas: HerePerson = { id: "u2", name: "Lucas Salzgeber", where: workshop };

describe("hereFinding", () => {
  it("finds someone on a page you had open lately", () => {
    const finding = hereFinding([lucas, oliver], [{ ...runOfShow, visitedAt: hoursAgo(20) }], {
      now: NOW,
      homeHref: HOME,
    });
    expect(finding).toMatchObject({ kind: "visited", person: { id: "u1" }, page: runOfShow });
  });

  it("ignores visits older than three days", () => {
    expect(
      hereFinding([oliver], [{ ...runOfShow, visitedAt: hoursAgo(80) }], {
        now: NOW,
        homeHref: HOME,
      }),
    ).toBeNull();
  });

  it("ignores Home, where everyone lands", () => {
    const home = { href: "/app/cbc", label: "Home" };
    expect(
      hereFinding(
        [
          { ...oliver, where: home },
          { ...lucas, where: home },
        ],
        [{ ...home, visitedAt: hoursAgo(1) }],
        { now: NOW, homeHref: HOME },
      ),
    ).toBeNull();
  });

  it("finds two people on the same page", () => {
    const finding = hereFinding(
      [oliver, { ...lucas, where: { ...runOfShow, href: "/app/cbc/notes/n1?x=1" } }],
      [],
      {
        now: NOW,
        homeHref: HOME,
      },
    );
    expect(finding).toMatchObject({ kind: "together", page: runOfShow });
    expect(finding && finding.kind === "together" && finding.people.map((p) => p.id)).toEqual([
      "u1",
      "u2",
    ]);
  });

  it("has nothing to say when nobody overlaps", () => {
    expect(hereFinding([oliver, lucas], [], { now: NOW, homeHref: HOME })).toBeNull();
    expect(hereFinding([{ ...oliver, where: null }], [], { now: NOW, homeHref: HOME })).toBeNull();
  });
});
