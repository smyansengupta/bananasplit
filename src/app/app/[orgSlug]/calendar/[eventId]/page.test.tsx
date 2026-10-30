import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const { default: EventDetailPage } = await import("./page");

const call = (search: Record<string, string>) =>
  EventDetailPage({
    params: Promise.resolve({ orgSlug: "club", eventId: "evt_1" }),
    searchParams: Promise.resolve(search),
  } as unknown as PageProps<"/app/[orgSlug]/calendar/[eventId]">);

describe("the old event address", () => {
  it("sends you to the meeting page", async () => {
    await expect(call({})).rejects.toThrow("redirect:/app/club/meetings/evt_1");
  });

  it("keeps the form open when it was asked for", async () => {
    await expect(call({ edit: "1" })).rejects.toThrow("redirect:/app/club/meetings/evt_1?edit=1");
  });
});
