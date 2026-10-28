import { describe, expect, it } from "vitest";

import { CONFERENCE_PROVIDER_OF, firstConnectedProvider } from "./connected-provider";

/**
 * Which video call a new online meeting starts on (docs/features/meetings.md):
 * the first provider the organization has connected, in the order the
 * Meetings page lists them.
 */

const row = (provider: string, connected: boolean) => ({ provider, connected });

describe("CONFERENCE_PROVIDER_OF", () => {
  it("names the provider an event stores for each one that can be connected", () => {
    expect(CONFERENCE_PROVIDER_OF).toEqual({
      GOOGLE_MEET: "MEET",
      ZOOM: "ZOOM",
      MICROSOFT_TEAMS: "TEAMS",
    });
  });
});

describe("firstConnectedProvider", () => {
  it("is the first provider that is connected", () => {
    expect(
      firstConnectedProvider([
        row("GOOGLE_MEET", false),
        row("ZOOM", true),
        row("MICROSOFT_TEAMS", true),
      ]),
    ).toBe("ZOOM");
  });

  it("is none when nothing is connected", () => {
    expect(firstConnectedProvider([row("GOOGLE_MEET", false), row("ZOOM", false)])).toBeNull();
    expect(firstConnectedProvider([])).toBeNull();
  });

  it("is none while the connections are still loading", () => {
    expect(firstConnectedProvider(null)).toBeNull();
  });

  it("skips a provider an event cannot be made with", () => {
    expect(firstConnectedProvider([row("SLACK", true), row("MICROSOFT_TEAMS", true)])).toBe(
      "TEAMS",
    );
  });
});
