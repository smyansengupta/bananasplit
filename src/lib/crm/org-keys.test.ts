import { describe, expect, it } from "vitest";

import {
  capReachedMessage,
  keyOfMeterProvider,
  maskKey,
  missingKeyMessage,
  NO_AI_KEY_MESSAGE,
  ORG_KEYS,
  ORG_KEY_GROUPS,
} from "./org-keys";

import { billedMinutes, costOf, textSegments } from "./per-use";

describe("per-use prices", () => {
  it("prices searches, texts, minutes and email", () => {
    expect(costOf("tavily.search")).toBe(8_000);
    expect(costOf("tavily.search", 2)).toBe(16_000);
    expect(costOf("call.minute", 0)).toBe(0);
    expect(costOf("email.sent", 1000)).toBe(900_000);
  });

  it("counts SMS segments and billed minutes like the providers", () => {
    expect(textSegments("hi")).toBe(1);
    expect(textSegments("x".repeat(160))).toBe(1);
    expect(textSegments("x".repeat(161))).toBe(2);
    expect(textSegments("x".repeat(307))).toBe(3);
    expect(billedMinutes(null)).toBe(0);
    expect(billedMinutes(1)).toBe(1);
    expect(billedMinutes(60)).toBe(1);
    expect(billedMinutes(61)).toBe(2);
  });
});

describe("the org keys catalog", () => {
  it("masks a saved key by its prefix and last four", () => {
    expect(maskKey("sk-ant-", "4f2a")).toBe("sk-ant-…4f2a");
    expect(maskKey(null, "9z9z")).toBe("…9z9z");
    expect(maskKey("tvly-", null)).toBeNull();
  });

  it("maps every meter provider to its key", () => {
    expect(keyOfMeterProvider("claude")).toBe("anthropic");
    expect(keyOfMeterProvider("openai_compatible")).toBe("openai");
    expect(keyOfMeterProvider("twilio")).toBe("twilio");
    expect(keyOfMeterProvider("bananasplit")).toBeNull();
    expect(keyOfMeterProvider("standin")).toBeNull();
  });

  it("says what to do in plain words", () => {
    expect(NO_AI_KEY_MESSAGE).toContain("CRM settings > AI");
    expect(missingKeyMessage("Telnyx or Twilio")).toBe("Add your Telnyx or Twilio key in CRM settings > AI first.");
    expect(capReachedMessage(2500)).toBe(
      "Your organization has reached this month's spending cap of $25. An owner or admin can raise it in CRM settings > AI.",
    );
    expect(capReachedMessage(1999)).toContain("$19.99");
    const copy = JSON.stringify([ORG_KEYS, ORG_KEY_GROUPS, NO_AI_KEY_MESSAGE]);
    expect(copy).not.toMatch(/·|\bclub\b|semester|this term/i);
  });

  it("every group has keys and every key a field to paste it in", () => {
    for (const g of ORG_KEY_GROUPS) expect(ORG_KEYS.some((k) => k.group === g.id)).toBe(true);
    for (const k of ORG_KEYS) expect(k.fields.some((f) => f.type === "secret")).toBe(true);
  });
});
