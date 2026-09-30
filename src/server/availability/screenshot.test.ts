import { describe, expect, it, vi } from "vitest";

import { addBlocksAsRules } from "@/lib/availability/screenshot";

import {
  readScheduleScreenshot,
  scheduleClientFactory,
  ScheduleImportError,
  toBlocks,
} from "./screenshot";

describe("schedule screenshot import", () => {
  it("turns what Claude read into whole-hour weekly blocks", () => {
    const blocks = toBlocks([
      { label: "CS 3500  Lecture", days: ["Mon", "Wed", "Mon"], start: "09:50", end: "11:30" },
      { label: "Shift", days: ["Sat"], start: "13:00", end: "17:00" },
      { label: "Backwards", days: ["Tue"], start: "15:00", end: "14:00" },
      { label: "No days", days: [], start: "10:00", end: "11:00" },
      { label: "Nonsense", days: ["Fri"], start: "noon", end: "1pm" },
    ]);
    expect(blocks).toEqual([
      { label: "CS 3500 Lecture", days: [0, 2], start: 9, end: 12, startText: "9:50 AM", endText: "11:30 AM" },
      { label: "Shift", days: [5], start: 13, end: 17, startText: "1:00 PM", endText: "5:00 PM" },
    ]);
  });

  it("adds reviewed blocks to the week as weekly rules", () => {
    const next = addBlocksAsRules({ v: 1, blocks: ["0-8"], rules: [] }, [
      { label: "Lab", days: [3, 1], start: 14, end: 16, startText: "", endText: "" },
    ]);
    expect(next.blocks).toEqual(["0-8"]);
    expect(next.rules).toEqual([{ kind: "weekly", label: "Lab", days: [1, 3], start: 14, end: 16 }]);
  });

  it("says so when the server has no key, and never calls Claude", async () => {
    const create = vi.spyOn(scheduleClientFactory, "create");
    await expect(readScheduleScreenshot(Buffer.from("x"), "image/png", {} as NodeJS.ProcessEnv)).rejects.toMatchObject({
      status: 503,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("sends the image with the platform key and reads the structured answer", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: JSON.stringify({ events: [{ label: "Chem", days: ["Thu"], start: "08:00", end: "09:15" }] }),
        },
      ],
    });
    vi.spyOn(scheduleClientFactory, "create").mockReturnValue({
      beta: { messages: { create: createMessage } },
    } as never);
    const blocks = await readScheduleScreenshot(Buffer.from("png"), "image/png", {
      ANTHROPIC_API_KEY: "sk-test",
    } as unknown as NodeJS.ProcessEnv);
    expect(blocks).toEqual([
      { label: "Chem", days: [3], start: 8, end: 10, startText: "8:00 AM", endText: "9:15 AM" },
    ]);
    const body = createMessage.mock.calls[0][0];
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/png" } });
  });

  it("reports a refusal as unreadable", async () => {
    vi.spyOn(scheduleClientFactory, "create").mockReturnValue({
      beta: { messages: { create: vi.fn().mockResolvedValue({ stop_reason: "refusal", content: [] }) } },
    } as never);
    await expect(
      readScheduleScreenshot(Buffer.from("png"), "image/png", { ANTHROPIC_API_KEY: "k" } as unknown as NodeJS.ProcessEnv),
    ).rejects.toBeInstanceOf(ScheduleImportError);
  });
});
