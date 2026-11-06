import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Today's Goals and Done on its own: a score and a week, not rows of text. */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/app/acme/crm",
  useSearchParams: () => new URLSearchParams(),
}));

import type { OnItsOwnWeek } from "@/server/crm/on-its-own";

import { TodayGoals, type TodayGoal } from "./today-goals";
import { TodayLog } from "./today-log";

afterEach(cleanup);

const goal = (over: Partial<TodayGoal> = {}): TodayGoal => ({
  id: "g1",
  name: "Deals won",
  metric: "items_won",
  metricLabel: "Deals won",
  who: null,
  actual: 5,
  target: 10,
  share: 0.5,
  pace: 0.5,
  onTrack: true,
  ...over,
});

describe("TodayGoals", () => {
  it("shows the big number, a ring, and where it stands", () => {
    render(<TodayGoals canEdit={false} goals={[goal()]} />);
    const row = screen.getByRole("link", { name: /Deals won/ });
    expect(within(row).getByText("5")).toBeTruthy();
    expect(within(row).getByText("of 10")).toBeTruthy();
    expect(within(row).getByText("50%")).toBeTruthy();
    expect(within(row).getByText("On pace")).toBeTruthy();
    expect(within(row).getByRole("img", { name: "5 of 10" })).toBeTruthy();
  });

  it("makes a goal hit look like one, and counts it", () => {
    const { container } = render(
      <TodayGoals
        canEdit={false}
        goals={[goal({ id: "a", actual: 12, share: 1.2 }), goal({ id: "b" })]}
      />,
    );
    expect(screen.getByText("Goal hit, 20% over")).toBeTruthy();
    expect(screen.getByText("1 of 2 hit")).toBeTruthy();
    expect(container.querySelector("[data-standing=won]")).toBeTruthy();
    expect(container.querySelectorAll(".goal-spark").length).toBeGreaterThan(0);
    expect(container.querySelector(".bg-tint-success")).toBeTruthy();
  });

  it("says a goal is behind in plain words", () => {
    render(
      <TodayGoals
        canEdit={false}
        goals={[goal({ actual: 2, share: 0.2, onTrack: false })]}
      />,
    );
    expect(screen.getByText("About 3 deals behind pace")).toBeTruthy();
  });

  it("invites a first goal for whoever may set one, and shows nothing to anyone else", () => {
    const { container, rerender } = render(<TodayGoals canEdit goals={[]} />);
    expect(screen.getByRole("link", { name: /Set a goal/ }).getAttribute("href")).toContain(
      "open=goal",
    );
    rerender(<TodayGoals canEdit={false} goals={[]} />);
    expect(container.textContent).toBe("");
  });
});

const week = (done: number, held: number): OnItsOwnWeek => ({
  done,
  held,
  days: Array.from({ length: 7 }, (_, i) => ({
    key: `2026-11-0${i + 1}`,
    label: "SMTWTFS"[i]!,
    title: `Day ${i + 1}`,
    done: i === 6 ? done : 0,
    held: i === 6 ? held : 0,
    today: i === 6,
  })),
});

const hrefs = { seeAllHref: "/log", automationsHref: "/automations" };

describe("TodayLog", () => {
  it("leads with the week's figure, seven bars, then the latest by kind", () => {
    render(
      <TodayLog
        {...hrefs}
        week={week(14, 2)}
        entries={[
          { id: "a", kind: "sent", when: "2:14 PM", text: "Sent the deck to Maya." },
          { id: "b", kind: "held", when: "Yesterday", text: "Held back a note to Sam." },
        ]}
      />,
    );
    expect(screen.getByText("14")).toBeTruthy();
    expect(screen.getByText("things done for you this week")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "14 done and 2 held back over the last seven days" }),
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: "Email" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Held back" })).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See all" }).getAttribute("href")).toBe("/log");
  });

  it("says one thing as one thing", () => {
    render(<TodayLog {...hrefs} week={week(1, 0)} entries={[]} />);
    expect(screen.getByText("thing done for you this week")).toBeTruthy();
  });

  it("leads with what it held back when that's all it did", () => {
    render(<TodayLog {...hrefs} week={week(0, 3)} entries={[]} />);
    expect(screen.getByText("things held back for you this week")).toBeTruthy();
  });

  it("invites an automation when the week is empty, with no chart and no apology", () => {
    render(<TodayLog {...hrefs} week={week(0, 0)} entries={[]} />);
    expect(screen.getByRole("link", { name: "Turn on an automation" }).getAttribute("href")).toBe(
      "/automations",
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("link", { name: "See all" })).toBeNull();
  });
});
