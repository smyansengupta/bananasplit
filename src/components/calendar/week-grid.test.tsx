import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CalendarItem } from "./item";
import { WeekGrid } from "./week-grid";

/**
 * Drag to move, drag the bottom edge to resize, and click or drag an empty
 * hour to create, on the week grid. jsdom has no layout, so the column the
 * pointer is over and its top are stubbed: one hour is 52px.
 */

vi.mock("./hooks", () => ({
  useMediaQuery: () => false,
  useNowMinutes: () => null,
}));

const DAY = "2026-11-03";
const item: CalendarItem = {
  id: "evt_1",
  title: "Build night",
  start: new Date(`${DAY}T18:00:00`).toISOString(),
  end: new Date(`${DAY}T19:00:00`).toISOString(),
  allDay: false,
  kind: "WORKSHOP",
  visibility: "INTERNAL",
  location: null,
  syncState: "NOT_APPLICABLE",
  needsReview: false,
  rsvp: null,
};

function grid(extra: Partial<Parameters<typeof WeekGrid>[0]> = {}) {
  const onOpen = vi.fn();
  render(
    <WeekGrid
      items={[item]}
      fromKey={DAY}
      dayCount={1}
      todayKey={DAY}
      openId={null}
      onOpen={onOpen}
      showSync={false}
      {...extra}
    />,
  );
  const column = document.querySelector<HTMLElement>(`[data-day="${DAY}"]`)!;
  column.getBoundingClientRect = () => ({ top: 0, left: 0 }) as DOMRect;
  document.elementFromPoint = () => column;
  return { column, onOpen };
}

afterEach(cleanup);

describe("WeekGrid: making and moving events", () => {
  it("makes an hour-long event from a click on an empty hour", () => {
    const onCreate = vi.fn();
    const { column } = grid({ onCreate });

    fireEvent.pointerDown(column, { button: 0, clientX: 10, clientY: 104 });
    fireEvent.pointerUp(column, { clientX: 10, clientY: 104 });

    expect(onCreate).toHaveBeenCalledOnce();
    const [start, end] = onCreate.mock.calls[0] as [Date, Date];
    expect(end.getTime() - start.getTime()).toBe(60 * 60_000);
    expect(start.getMinutes() % 30).toBe(0);
  });

  it("moves an event by dragging it, an hour per 52px, and doesn't open it", () => {
    const onMove = vi.fn();
    const { column, onOpen } = grid({ onMove });
    const slot = screen.getByRole("button", { name: /Build night/ });

    fireEvent.pointerDown(slot, { button: 0, clientX: 10, clientY: 500 });
    fireEvent.pointerMove(column, { clientX: 10, clientY: 552 });
    fireEvent.pointerUp(column, { clientX: 10, clientY: 552 });
    fireEvent.click(slot);

    expect(onMove).toHaveBeenCalledOnce();
    const [, start, end] = onMove.mock.calls[0] as [CalendarItem, Date, Date];
    expect(end.getTime() - start.getTime()).toBe(60 * 60_000);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does nothing on a press for someone who can't edit", () => {
    const { column } = grid();
    fireEvent.pointerDown(column, { button: 0, clientX: 10, clientY: 104 });
    fireEvent.pointerUp(column, { clientX: 10, clientY: 104 });
    expect(document.querySelectorAll(".cal-slot")).toHaveLength(1);
  });
});
