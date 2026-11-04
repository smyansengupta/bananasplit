import { describe, expect, it } from "vitest";

import { costLine, formatCents, hasPayTo, parseDollars, payLinks, shareCents } from "./pay";
import { parsePayTo, payToSchema } from "./pay-schema";

describe("shareCents", () => {
  it("is nothing for a free event", () => {
    expect(shareCents("NONE", null, 10)).toBeNull();
    expect(shareCents("EACH", null, 10)).toBeNull();
  });

  it("is the price for EACH, however many go", () => {
    expect(shareCents("EACH", 500, 0)).toBe(500);
    expect(shareCents("EACH", 500, 80)).toBe(500);
  });

  it("splits a total among everyone going, rounding up so the host is never short", () => {
    expect(shareCents("SPLIT", 12000, 25)).toBe(480);
    expect(shareCents("SPLIT", 10000, 3)).toBe(3334);
    // Nobody going yet: the first guest's share is the whole total.
    expect(shareCents("SPLIT", 12000, 0)).toBe(12000);
  });

  it("counts a guest about to sign up", () => {
    expect(shareCents("SPLIT", 12000, 24, { includingNew: true })).toBe(480);
    expect(shareCents("SPLIT", 12000, 0, { includingNew: true })).toBe(12000);
  });
});

describe("formatCents and parseDollars", () => {
  it("prints whole dollars without cents", () => {
    expect(formatCents(400)).toBe("$4");
    expect(formatCents(450)).toBe("$4.50");
    expect(formatCents(120000)).toBe("$1,200");
    expect(formatCents(3334)).toBe("$33.34");
  });

  it("reads what a host types", () => {
    expect(parseDollars("12")).toBe(1200);
    expect(parseDollars("$12.5")).toBe(1250);
    expect(parseDollars(" 1,200.00 ")).toBe(120000);
    expect(parseDollars("0.99")).toBe(99);
  });

  it("refuses anything that isn't money", () => {
    for (const bad of ["", "abc", "12.345", "-5", "1e3", "12..5"]) {
      expect(parseDollars(bad), bad).toBeNull();
    }
  });
});

describe("pay handles", () => {
  it("takes handles with or without @ or $", () => {
    const parsed = payToSchema.parse({
      venmo: "@maya-chen",
      cashapp: "$mayac",
      paypal: "mayachen",
      zelle: "maya@example.edu",
    });
    expect(parsed).toEqual({
      venmo: "maya-chen",
      cashapp: "mayac",
      paypal: "mayachen",
      zelle: "maya@example.edu",
    });
  });

  it("drops empty handles", () => {
    expect(payToSchema.parse({ venmo: "", cashapp: "", paypal: "", zelle: "" })).toEqual({
      venmo: undefined,
      cashapp: undefined,
      paypal: undefined,
      zelle: undefined,
    });
  });

  it("refuses handles that would break out of the link", () => {
    expect(payToSchema.safeParse({ venmo: "maya/../../x" }).success).toBe(false);
    expect(payToSchema.safeParse({ cashapp: "$1abc" }).success).toBe(false);
    expect(payToSchema.safeParse({ paypal: "maya chen" }).success).toBe(false);
    expect(payToSchema.safeParse({ zelle: "not a contact" }).success).toBe(false);
  });

  it("reads stored JSON defensively", () => {
    expect(parsePayTo(null)).toEqual({});
    expect(parsePayTo({ venmo: "javascript:alert(1)" })).toEqual({});
    expect(parsePayTo({ venmo: "maya-chen", extra: "x" })).toEqual({ venmo: "maya-chen" });
    expect(hasPayTo({})).toBe(false);
    expect(hasPayTo({ zelle: "5551234567" })).toBe(true);
  });
});

describe("payLinks", () => {
  it("opens each app with the amount and a note filled in", () => {
    const links = payLinks(
      { venmo: "maya-chen", cashapp: "mayac", paypal: "mayachen", zelle: "maya@example.edu" },
      480,
      "Pizza night (Leo Kim)",
    );
    expect(links.map((l) => l.app)).toEqual(["venmo", "cashapp", "paypal", "zelle"]);
    const venmo = new URL(links[0]!.href!);
    expect(venmo.origin + venmo.pathname).toBe("https://venmo.com/maya-chen");
    expect(venmo.searchParams.get("txn")).toBe("pay");
    expect(venmo.searchParams.get("amount")).toBe("4.80");
    expect(venmo.searchParams.get("note")).toBe("Pizza night (Leo Kim)");
    expect(links[1]!.href).toBe("https://cash.app/$mayac/4.80");
    expect(links[2]!.href).toBe("https://www.paypal.com/paypalme/mayachen/4.80USD");
    // Zelle has no link: the guest copies who to send it to.
    expect(links[3]).toMatchObject({ href: null, detail: "maya@example.edu" });
  });

  it("offers only the apps the host filled in", () => {
    expect(payLinks({ cashapp: "mayac" }, 500, "x").map((l) => l.label)).toEqual(["Cash App"]);
    expect(payLinks({}, 500, "x")).toEqual([]);
  });
});

describe("costLine", () => {
  it("says what each guest pays", () => {
    expect(costLine("EACH", 500, 12)).toBe("$5 each");
    expect(costLine("SPLIT", 12000, 25)).toBe("$120 split 25 ways, $4.80 each right now");
    expect(costLine("SPLIT", 12000, 1)).toBe("$120 split between everyone going");
  });
});
