import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { WidgetBoard, type SaveBoard } from "@/components/boards/widget-board";
import type { BoardWidget, WidgetMeta } from "@/lib/boards";

const { refresh, toastMock } = vi.hoisted(() => ({ refresh: vi.fn(), toastMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/components/ui/toaster", () => ({ toast: toastMock }));

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.getAnimations ??= () => [];
});

const types: WidgetMeta[] = ["number", "table", "pipeline"].map((t) => ({
  type: t,
  title: t,
  description: t,
  group: "Widgets",
  icon: "Hash",
  w: 2,
  h: 1,
}));
const mine: BoardWidget[] = [
  { id: "table", type: "table", w: 4, h: 2 },
  { id: "number", type: "number", w: 4, h: 1 },
];
const suggested: BoardWidget[] = [
  { id: "number", type: "number", w: 2, h: 1 },
  { id: "pipeline", type: "pipeline", w: 2, h: 1 },
];
const titles = { table: "Every sponsor", number: "Total raised", pipeline: "Sponsors by stage" };

function order() {
  return [...document.querySelectorAll("[data-widget-id]")].map((n) =>
    n.getAttribute("data-widget-id"),
  );
}

describe("a report board's Reset", () => {
  it("shows the suggested widgets as soon as the save answers, and Undo brings the old ones back", async () => {
    const undo = vi.fn(async () => ({ ok: true, layout: mine }));
    const onSave = vi.fn<SaveBoard>(async (layout) =>
      layout === null ? { ok: true, layout: suggested, undo } : { ok: true },
    );
    render(
      <WidgetBoard
        types={types}
        initialLayout={mine}
        customized
        titles={titles}
        bodies={{}}
        onSave={onSave}
        startEditing
        resetLabel="Back to the suggested widgets"
        noun="this report"
        fillGaps
      />,
    );
    expect(order()).toEqual(["table", "number"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back to the suggested widgets" }));
    });
    expect(onSave).toHaveBeenCalledWith(null);
    // No refresh round trip needed: the board takes what the save said.
    await waitFor(() => expect(order()).toEqual(["number", "pipeline"]));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Back to the suggested widgets" }),
    );

    const run = toastMock.mock.calls.at(-1)![0].action.run as () => Promise<unknown>;
    await act(async () => {
      await run();
    });
    expect(undo).toHaveBeenCalled();
    await waitFor(() => expect(order()).toEqual(["table", "number"]));
    // What Reset and Undo put back is already saved: nothing is sent again.
    await new Promise((r) => setTimeout(r, 700));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
