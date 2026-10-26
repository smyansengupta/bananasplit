import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign-ups are run from the meeting now (docs/features/meetings.md), so the
 * old Calendar paths only forward. Clubs have pasted them into notes and
 * messages, and the sign-up page's own "new" banner link used to be one.
 *
 * `redirect` throws in Next.js to end the render; the mock does the same and
 * keeps what it was asked for.
 */

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirect(url);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

const { default: RsvpMoved } = await import("./page");
const { default: DoorMoved } = await import("./door/page");

type Search = Record<string, string | string[] | undefined>;

/** Where the old RSVP page sent a visitor. */
async function rsvpGoesTo(search: Search = {}) {
  await expect(
    RsvpMoved({
      params: Promise.resolve({ orgSlug: "acme", eventId: "e1" }),
      searchParams: Promise.resolve(search),
    } as unknown as PageProps<"/app/[orgSlug]/calendar/[eventId]/rsvp">),
  ).rejects.toThrow("NEXT_REDIRECT");
  expect(redirect).toHaveBeenCalledTimes(1);
  return redirect.mock.calls[0][0] as string;
}

beforeEach(() => redirect.mockClear());

describe("the old RSVP page", () => {
  it("sends the event's sign-up screen to the meeting's", async () => {
    expect(await rsvpGoesTo()).toBe("/app/acme/meetings/e1/rsvp");
  });

  it("keeps the new-page banner (?new=1)", async () => {
    expect(await rsvpGoesTo({ new: "1" })).toBe("/app/acme/meetings/e1/rsvp?new=1");
    // Next hands a repeated parameter over as a list.
    redirect.mockClear();
    expect(await rsvpGoesTo({ new: ["1", "1"] })).toBe("/app/acme/meetings/e1/rsvp?new=1");
  });

  it("carries nothing else across", async () => {
    expect(await rsvpGoesTo({ new: "1", edit: "1", utm_source: "x" })).toBe(
      "/app/acme/meetings/e1/rsvp?new=1",
    );
    redirect.mockClear();
    expect(await rsvpGoesTo({ edit: "1", ref: "mail" })).toBe("/app/acme/meetings/e1/rsvp");
    // Only "1" turns the banner on.
    redirect.mockClear();
    expect(await rsvpGoesTo({ new: "0" })).toBe("/app/acme/meetings/e1/rsvp");
    redirect.mockClear();
    expect(await rsvpGoesTo({ new: "" })).toBe("/app/acme/meetings/e1/rsvp");
  });
});

describe("the old door page", () => {
  it("sends door mode to the meeting's", async () => {
    await expect(
      DoorMoved({
        params: Promise.resolve({ orgSlug: "acme", eventId: "e1" }),
      } as unknown as PageProps<"/app/[orgSlug]/calendar/[eventId]/rsvp/door">),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/app/acme/meetings/e1/rsvp/door");
  });
});
