import { describe, expect, it } from "vitest";

import { CONFERENCE_LABELS, conferenceStatus } from "./conference-status";

/**
 * What the meeting page says about a meeting's video call
 * (docs/features/meetings.md): there is nothing to join, there is a link, the
 * link is on its way, or making it failed.
 */

type Input = Parameters<typeof conferenceStatus>[0];

/** A Zoom meeting Bananasplit made, with its link: the common healthy case. */
function meeting(overrides: Partial<Input> = {}): Input {
  return {
    conferenceProvider: "ZOOM",
    conferenceManaged: true,
    conferenceUrl: "https://us02web.zoom.us/j/98765432100",
    conferenceSyncState: "SYNCED",
    conferenceSyncError: null,
    ...overrides,
  };
}

describe("conferenceStatus", () => {
  it("says there is nothing to join for a meeting with no video call", () => {
    expect(
      conferenceStatus(
        meeting({
          conferenceProvider: "NONE",
          conferenceManaged: false,
          conferenceUrl: null,
          conferenceSyncState: "NOT_APPLICABLE",
        }),
        true,
      ),
    ).toEqual({ kind: "none" });
  });

  it("is ready for a meeting we made, once it has its link", () => {
    expect(conferenceStatus(meeting(), true)).toEqual({ kind: "ready" });
    expect(conferenceStatus(meeting(), false)).toEqual({ kind: "ready" });
  });

  it("is ready for a link someone pasted", () => {
    expect(
      conferenceStatus(
        meeting({
          conferenceProvider: "OTHER",
          conferenceManaged: false,
          conferenceUrl: "https://meet.example.org/board",
          conferenceSyncState: "NOT_APPLICABLE",
        }),
        false,
      ),
    ).toEqual({ kind: "ready" });
  });

  it("has nothing to show for a provider with no link yet and no job running", () => {
    // Saved before the provider was connected: nothing pending, nothing failed.
    expect(
      conferenceStatus(
        meeting({
          conferenceManaged: false,
          conferenceUrl: null,
          conferenceSyncState: "NOT_APPLICABLE",
        }),
        true,
      ),
    ).toEqual({ kind: "none" });
    expect(
      conferenceStatus(
        meeting({
          conferenceProvider: "OTHER",
          conferenceManaged: false,
          conferenceUrl: null,
          conferenceSyncState: "NOT_APPLICABLE",
        }),
        true,
      ),
    ).toEqual({ kind: "none" });
  });

  it("says the link is on its way while the job runs, naming the provider", () => {
    expect(
      conferenceStatus(
        meeting({ conferenceManaged: false, conferenceUrl: null, conferenceSyncState: "PENDING" }),
        true,
      ),
    ).toEqual({ kind: "pending", line: "Getting the Zoom link…" });
    expect(
      conferenceStatus(
        meeting({
          conferenceProvider: "MEET",
          conferenceManaged: false,
          conferenceUrl: null,
          conferenceSyncState: "PENDING",
        }),
        false,
      ),
    ).toEqual({ kind: "pending", line: "Getting the Google Meet link…" });
  });

  it("is pending, not ready, for a meeting being moved at its provider", () => {
    // A managed meeting keeps its old link while the job updates it.
    expect(conferenceStatus(meeting({ conferenceSyncState: "PENDING" }), true).kind).toBe(
      "pending",
    );
  });

  it("says making the meeting failed, and gives the reason only to someone who can edit", () => {
    const failed = meeting({
      conferenceManaged: false,
      conferenceUrl: null,
      conferenceSyncState: "FAILED",
      conferenceSyncError: "Zoom needs to be reconnected from Meetings.",
    });
    expect(conferenceStatus(failed, true)).toEqual({
      kind: "failed",
      line: "Couldn't make the Zoom meeting.",
      reason: "Zoom needs to be reconnected from Meetings.",
    });
    expect(conferenceStatus(failed, false)).toEqual({
      kind: "failed",
      line: "Couldn't make the Zoom meeting.",
      reason: null,
    });
  });

  it("has a null reason when a failure stored none", () => {
    expect(
      conferenceStatus(
        meeting({ conferenceUrl: null, conferenceSyncState: "FAILED", conferenceSyncError: null }),
        true,
      ),
    ).toEqual({ kind: "failed", line: "Couldn't make the Zoom meeting.", reason: null });
  });

  it("stays failed when a managed meeting kept its old link", () => {
    // A move that never reached the provider: the old link still works, and
    // the page still has to say the new time did not make it there.
    expect(conferenceStatus(meeting({ conferenceSyncState: "FAILED" }), true).kind).toBe("failed");
  });

  it("trusts a pasted link over a stale sync state", () => {
    // Someone pasted a link after the job failed. Nothing is left for us to
    // make, so the page must not offer to try again.
    expect(
      conferenceStatus(
        meeting({
          conferenceManaged: false,
          conferenceUrl: "https://us02web.zoom.us/j/manual",
          conferenceSyncState: "FAILED",
          conferenceSyncError: "Zoom is not connected for this organization.",
        }),
        true,
      ),
    ).toEqual({ kind: "ready" });
  });
});

describe("CONFERENCE_LABELS", () => {
  it("names each kind of call, and nothing for none", () => {
    expect(CONFERENCE_LABELS).toEqual({
      NONE: "",
      MEET: "Google Meet",
      ZOOM: "Zoom",
      TEAMS: "Microsoft Teams",
      OTHER: "Online",
    });
  });
});
