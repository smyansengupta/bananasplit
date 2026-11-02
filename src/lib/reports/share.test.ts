import { describe, expect, it } from "vitest";

import { BOARD_COLUMNS } from "@/lib/boards";

import { suggestedLayout, suggestedWidgets, type SourceSummary } from "./catalog";
import type { WidgetPayload } from "./compute";
import { isInvited, normalizeInviteEmail, readInviteEmails, sharePayload } from "./share";

describe("readInviteEmails", () => {
  it("reads addresses split by commas, semicolons, spaces and lines, normalized, once each", () => {
    expect(readInviteEmails(" Sam@Example.org, jo@x.io;\nsam@example.org  pat@y.co ")).toEqual({
      emails: ["sam@example.org", "jo@x.io", "pat@y.co"],
      bad: [],
    });
  });

  it("takes the address out of a pasted name and skips the name", () => {
    expect(readInviteEmails("Sam Lee <sam@example.org>")).toEqual({
      emails: ["sam@example.org"],
      bad: [],
    });
  });

  it("names what isn't an address", () => {
    expect(readInviteEmails("sam@example, @x.org, jo@x.io").bad).toEqual(["sam@example", "@x.org"]);
    expect(readInviteEmails("   ").emails).toEqual([]);
  });
});

describe("isInvited", () => {
  const invites = ["sam@example.org", "jo@x.io"];

  it("matches the signed-in address whatever its case or spaces", () => {
    expect(isInvited("Sam@Example.org ", invites)).toBe(true);
    expect(isInvited("JO@X.IO", invites)).toBe(true);
  });

  it("matches nothing else: another address, a lookalike, or no address", () => {
    expect(isInvited("sam@example.org.evil.com", invites)).toBe(false);
    expect(isInvited("am@example.org", invites)).toBe(false);
    expect(isInvited("", invites)).toBe(false);
    expect(isInvited(null, invites)).toBe(false);
    expect(isInvited("sam@example.org", [])).toBe(false);
  });

  it("normalizes like the database stores (lower(btrim))", () => {
    expect(normalizeInviteEmail("  A@B.Co ")).toBe("a@b.co");
  });
});

describe("sharePayload", () => {
  it("keeps the numbers and drops links into the organization, addresses and member ids", () => {
    const payload = {
      type: "overdue",
      data: {
        total: 2,
        rows: [{ id: "r1", title: "Call", href: "/app/x/databases/a?row=r1", ownerId: "u1" }],
        emails: ["a@b.co"],
      },
    } as unknown as WidgetPayload;
    expect(sharePayload(payload)).toEqual({
      type: "overdue",
      data: {
        total: 2,
        rows: [{ id: "r1", title: "Call", href: null, ownerId: null }],
        emails: [],
      },
    });
  });
});

describe("suggestedLayout (what Reset puts back)", () => {
  const source: SourceSummary = {
    key: "custom:sponsors",
    kind: "custom",
    name: "Sponsors",
    icon: "Handshake",
    description: "",
    href: "/app/x/databases/sponsors",
    fields: [
      {
        id: "stage",
        name: "Stage",
        type: "SELECT",
        choices: [
          { id: "c", label: "Contacted", color: "gray" },
          { id: "p", label: "Paid", color: "green" },
        ],
        done: ["p"],
      },
      { id: "amount", name: "Amount", type: "CURRENCY" },
      { id: "follow", name: "Follow-up date", type: "DATE" },
    ],
    rows: 3,
    form: null,
  };

  it("is the suggested widgets, set up for the source, in full rows", () => {
    const layout = suggestedLayout(source, false);
    expect(layout.map((w) => w.type)).toEqual(suggestedWidgets(source, false));
    expect(new Set(layout.map((w) => w.id)).size).toBe(layout.length);
    // Rows are full: the widths add up to whole rows.
    expect(layout.reduce((n, w) => n + w.w, 0) % BOARD_COLUMNS).toBe(0);
    expect(layout.find((w) => w.type === "number")?.config).toMatchObject({ field: "amount" });
  });

  it("is the same every time, so Reset twice is Reset once", () => {
    expect(suggestedLayout(source, false)).toEqual(suggestedLayout(source, false));
  });
});
