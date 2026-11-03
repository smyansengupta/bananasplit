import { describe, expect, it } from "vitest";

import {
  canText,
  formatDuration,
  inWindow,
  maskNumber,
  parseDuration,
  phoneKey,
  readConsent,
  readPhoneSettings,
  textKeyword,
  toE164,
  withConsent,
} from "./phone";
import {
  canRespond,
  cleanLines,
  cleanSignature,
  effectiveStatus,
  formatQuoteNumber,
  nextQuoteNumber,
  parseCents,
  parsePublicToken,
  parseTaxBps,
  QuoteInputError,
  quoteSequence,
  quoteTotals,
} from "./quotes";

describe("STOP, START and HELP", () => {
  it("reads the carrier words only as the whole message", () => {
    expect(textKeyword("STOP")).toBe("stop");
    expect(textKeyword(" stop. ")).toBe("stop");
    expect(textKeyword("Unsubscribe")).toBe("stop");
    expect(textKeyword("cancel")).toBe("stop");
    expect(textKeyword("START")).toBe("start");
    expect(textKeyword("unstop")).toBe("start");
    expect(textKeyword("help")).toBe("help");
    expect(textKeyword("stop by at 5")).toBeNull();
    expect(textKeyword("Please don't stop")).toBeNull();
    expect(textKeyword("")).toBeNull();
  });

  it("allows a text only with consent and never to do-not-contact", () => {
    const granted = withConsent({}, "text", { granted: true, how: "verbal", at: "2026-11-01T00:00:00.000Z" });
    expect(canText({ phone: "+15551234567", doNotContact: false, consent: granted })).toEqual({ ok: true });
    expect(canText({ phone: "+15551234567", doNotContact: true, consent: granted }).reason).toBe("do-not-contact");
    expect(canText({ phone: "+15551234567", doNotContact: false, consent: {} }).reason).toBe("no-consent");
    expect(canText({ phone: null, doNotContact: false, consent: granted }).reason).toBe("no-phone");
    const stopped = withConsent(granted, "text", { granted: false, how: "texted STOP", at: "2026-11-02T00:00:00.000Z" });
    expect(canText({ phone: "+15551234567", doNotContact: false, consent: stopped }).reason).toBe("opted-out");
    // Other channels are kept as they were.
    const both = withConsent(stopped, "email", { granted: true, how: "form", at: "2026-11-02T00:00:00.000Z" });
    expect(readConsent(both).text?.granted).toBe(false);
    expect(readConsent(both).email?.granted).toBe(true);
    expect(readConsent("nonsense")).toEqual({});
  });
});

describe("phone numbers, hours and settings", () => {
  it("normalizes, keys and masks numbers", () => {
    expect(toE164("(617) 555-0101")).toBe("+16175550101");
    expect(toE164("1 617 555 0101")).toBe("+16175550101");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("555-01")).toBeNull();
    expect(toE164("call me")).toBeNull();
    expect(phoneKey("+1 (617) 555-0101")).toBe("6175550101");
    expect(maskNumber("+16175550101")).toBe("•••0101");
  });

  it("knows quiet hours that wrap past midnight", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 3, h, 30));
    expect(inWindow(at(22), "UTC", "21:00", "08:00")).toBe(true);
    expect(inWindow(at(3), "UTC", "21:00", "08:00")).toBe(true);
    expect(inWindow(at(12), "UTC", "21:00", "08:00")).toBe(false);
    expect(inWindow(at(12), "UTC", "09:00", "18:00")).toBe(true);
    // 22:30 UTC is 17:30 in New York (EST in November).
    expect(inWindow(at(22), "America/New_York", "21:00", "08:00")).toBe(false);
  });

  it("reads settings with safe defaults", () => {
    const s = readPhoneSettings({ recording: "never", quietStart: "25:00", provider: "nope", notice: "short" });
    expect(s.recording).toBe("never");
    expect(s.quietStart).toBe("21:00");
    expect(s.provider).toBeNull();
    expect(s.notice).toMatch(/recorded/);
    expect(readPhoneSettings(null).recording).toBe("ask");
  });

  it("reads and writes call lengths", () => {
    expect(parseDuration("5:30")).toBe(330);
    expect(parseDuration("330")).toBe(330);
    expect(parseDuration("5m")).toBe(300);
    expect(parseDuration("five")).toBeNull();
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3723)).toBe("1:02:03");
  });
});

describe("quote totals and numbering", () => {
  it("adds lines in cents and rounds tax once on the subtotal", () => {
    const lines = [
      { quantity: 3, unitCents: 3333 },
      { quantity: 1, unitCents: 1 },
    ];
    expect(quoteTotals(lines)).toEqual({ subtotalCents: 10000, taxCents: 0, totalCents: 10000 });
    expect(quoteTotals(lines, 825)).toEqual({ subtotalCents: 10000, taxCents: 825, totalCents: 10825 });
    // 0.5 cents rounds away from zero.
    expect(quoteTotals([{ quantity: 1, unitCents: 50 }], 100).taxCents).toBe(1);
    expect(quoteTotals([], 825).totalCents).toBe(0);
  });

  it("parses money and tax the way people type them", () => {
    expect(parseCents("1,250.50")).toBe(125050);
    expect(parseCents("$12")).toBe(1200);
    expect(parseCents("12.5")).toBe(1250);
    expect(parseCents("-3")).toBe(-300);
    expect(parseCents("12.345")).toBeNull();
    expect(parseCents("abc")).toBeNull();
    expect(parseTaxBps("8.25")).toBe(825);
    expect(parseTaxBps("")).toBe(0);
    expect(parseTaxBps("101")).toBeNull();
  });

  it("cleans lines and says what's wrong", () => {
    expect(cleanLines([{ description: " Booth ", quantity: 2, unitCents: 5000 }, { description: "", unitCents: 0 }])).toEqual([
      { description: "Booth", quantity: 2, unitCents: 5000 },
    ]);
    expect(() => cleanLines([{ description: "", quantity: 1, unitCents: 100 }])).toThrow(QuoteInputError);
    expect(() => cleanLines([{ description: "x", quantity: 0, unitCents: 100 }])).toThrow(/quantity/);
    expect(() => cleanLines([{ description: "x", quantity: 1.5, unitCents: 100 }])).toThrow(/quantity/);
  });

  it("numbers per kind, after the highest so far", () => {
    expect(formatQuoteNumber("quote", 7)).toBe("Q-0007");
    expect(formatQuoteNumber("invoice", 12)).toBe("INV-0012");
    expect(quoteSequence("quote", "Q-0042")).toBe(42);
    expect(quoteSequence("quote", "INV-0042")).toBeNull();
    expect(nextQuoteNumber("quote", [])).toBe("Q-0001");
    expect(nextQuoteNumber("quote", ["Q-0001", "Q-0009", "INV-0050", "Q-0003"])).toBe("Q-0010");
    expect(nextQuoteNumber("invoice", ["Q-0001", "INV-0050"])).toBe("INV-0051");
    expect(nextQuoteNumber("quote", ["Q-9999"])).toBe("Q-10000");
  });
});

describe("the public link and acceptance", () => {
  it("parses only well-formed tokens", () => {
    const secret = "a".repeat(43);
    expect(parsePublicToken(`org_123.${secret}`)).toEqual({ orgId: "org_123", secret });
    expect(parsePublicToken(`org_123.short`)).toBeNull();
    expect(parsePublicToken(`org/123.${secret}`)).toBeNull();
    expect(parsePublicToken("")).toBeNull();
  });

  it("expires after the valid-until day and only sent quotes can be answered", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const until = new Date("2026-11-10T00:00:00Z");
    expect(canRespond({ status: "SENT", validUntil: until, kind: "quote" }, now)).toBe(true);
    expect(canRespond({ status: "SENT", validUntil: until, kind: "quote" }, new Date("2026-11-11T00:00:01Z"))).toBe(false);
    expect(effectiveStatus({ status: "SENT", validUntil: until }, new Date("2026-11-12T00:00:00Z"))).toBe("EXPIRED");
    expect(canRespond({ status: "DRAFT", validUntil: null, kind: "quote" }, now)).toBe(false);
    expect(canRespond({ status: "ACCEPTED", validUntil: null, kind: "quote" }, now)).toBe(false);
  });

  it("takes a typed name as a signature, not a link or a single letter", () => {
    expect(cleanSignature("  Maya   Chen ")).toBe("Maya Chen");
    expect(cleanSignature("Zoë Ångström")).toBe("Zoë Ångström");
    expect(cleanSignature("M")).toBeNull();
    expect(cleanSignature("https://evil.example")).toBeNull();
    expect(cleanSignature("<b>x</b>")).toBeNull();
    expect(cleanSignature("12345")).toBeNull();
  });
});
