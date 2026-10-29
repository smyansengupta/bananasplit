import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SpaceInfo } from "@/lib/billing/space";

import { SpaceBanner } from "./space-banner";

const NOW = new Date("2026-10-13T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const trial = (days: number): SpaceInfo => ({
  kind: "CLUB",
  plan: "TRIAL",
  trialEndsAt: new Date(NOW.getTime() + days * DAY),
  planAfterTrial: null,
});

function render(space: SpaceInfo, canChoosePlan: boolean) {
  return renderToStaticMarkup(
    <SpaceBanner space={space} orgSlug="cbc" canChoosePlan={canChoosePlan} now={NOW} />,
  ).replace(/&#x27;/g, "'");
}

describe("SpaceBanner", () => {
  it("tells owners and admins an ended trial is on Free, and that nothing was deleted", () => {
    const html = render(trial(-1), true);
    expect(html).toContain("free trial of Team Advanced has ended");
    expect(html).toContain("on Free. Nothing was deleted");
    expect(html).toContain('href="/app/cbc/settings/plan"');
    expect(html).not.toMatch(/paused/i);
  });

  it("tells members nothing about the trial or its end", () => {
    expect(render(trial(-1), false)).toBe("");
  });

  it("stops once the owner picks Free", () => {
    expect(
      render({ kind: "CLUB", plan: "TEAM_FREE", trialEndsAt: null, planAfterTrial: null }, true),
    ).toBe("");
  });

  it("warns owners and admins in a trial's last three days, and nobody else", () => {
    expect(render(trial(3), true)).toContain("Your free trial is almost up");
    expect(render(trial(3), true)).toContain("Team Advanced trial ends in 3 days");
    expect(render(trial(1), true)).toContain("ends in 1 day.");
    expect(render(trial(3), false)).toBe("");
    expect(render(trial(5), true)).toBe("");
  });

  it("warns a Personal space at the end of its Personal Plus trial", () => {
    const space: SpaceInfo = {
      kind: "PERSONAL",
      plan: "FREE",
      trialEndsAt: new Date(NOW.getTime() + 2 * DAY),
      planAfterTrial: null,
    };
    const html = render(space, true);
    expect(html).toContain("your Personal Plus trial ends in 2 days");
    expect(html).toContain("you move to Personal Free");
    expect(render({ ...space, trialEndsAt: new Date(NOW.getTime() - DAY) }, true)).toBe("");
  });

  it("says nothing in Personal or a paid club", () => {
    expect(
      render({ kind: "PERSONAL", plan: "FREE", trialEndsAt: null, planAfterTrial: null }, true),
    ).toBe("");
    expect(
      render({ kind: "CLUB", plan: "SOCIETY", trialEndsAt: null, planAfterTrial: null }, true),
    ).toBe("");
  });
});
