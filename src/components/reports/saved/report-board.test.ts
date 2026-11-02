import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportWidget } from "@/lib/reports/catalog";

const { save, restore } = vi.hoisted(() => ({ save: vi.fn(), restore: vi.fn() }));
vi.mock("@/app/app/[orgSlug]/databases/reports/report-actions", () => ({
  saveReportLayoutAction: save,
  restoreReportWidgetsAction: restore,
}));

import { reportBoardSave } from "./report-board";

const was: ReportWidget[] = [
  { id: "number", type: "number", w: 4, h: 1, config: { field: "amount", title: "Raised" } },
  { id: "table", type: "table", w: 4, h: 3, config: { columns: ["name"] } },
];
const suggested: ReportWidget[] = [
  { id: "insights", type: "insights", w: 4, h: 2, config: {} },
  { id: "number", type: "number", w: 2, h: 1, config: { field: "amount", agg: "sum" } },
  { id: "pipeline", type: "pipeline", w: 2, h: 1, config: { group: "stage" } },
];
const layoutOf = (ws: ReportWidget[]) => ws.map(({ id, type, w, h }) => ({ id, type, w, h }));

describe("the saved report board's Reset", () => {
  beforeEach(() => {
    save.mockReset();
    restore.mockReset();
  });

  it("answers with the suggested widgets the server put back, for the board to show at once", async () => {
    save.mockResolvedValue({ ok: true, widgets: suggested, before: was });
    const result = await reportBoardSave("org", "rep")(null);
    expect(save).toHaveBeenCalledWith("org", "rep", null);
    expect(result.ok).toBe(true);
    expect(result.layout).toEqual(layoutOf(suggested));
  });

  it("Undo puts the old widgets back exactly, settings included", async () => {
    save.mockResolvedValue({ ok: true, widgets: suggested, before: was });
    restore.mockResolvedValue({ ok: true, widgets: was });
    const result = await reportBoardSave("org", "rep")(null);
    const back = await result.undo!();
    expect(restore).toHaveBeenCalledWith("org", "rep", was);
    expect(back).toEqual({ ok: true, layout: layoutOf(was) });
  });

  it("an Undo that fails says why", async () => {
    save.mockResolvedValue({ ok: true, widgets: suggested, before: was });
    restore.mockResolvedValue({ ok: false, error: "That report isn't there any more." });
    const result = await reportBoardSave("org", "rep")(null);
    expect(await result.undo!()).toEqual({ ok: false, error: "That report isn't there any more." });
  });

  it("a refused Reset keeps the board and says why", async () => {
    save.mockResolvedValue({ ok: false, error: "Only whoever made this report can change it." });
    const result = await reportBoardSave("org", "rep")(null);
    expect(result).toEqual({ ok: false, error: "Only whoever made this report can change it." });
  });

  it("an ordinary save is just saved (the board already shows it)", async () => {
    save.mockResolvedValue({ ok: true });
    const result = await reportBoardSave("org", "rep")(layoutOf(was));
    expect(save).toHaveBeenCalledWith("org", "rep", layoutOf(was));
    expect(result).toEqual({ ok: true });
  });
});
