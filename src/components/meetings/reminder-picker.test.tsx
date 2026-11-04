import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_REMINDERS, REMINDER_CHOICES, reminderLabel } from "@/lib/meetings/reminders";

import { ReminderPicker } from "./reminder-picker";

/**
 * The reminder times of a meeting, as toggles (docs/features/meetings.md): the
 * times worth a button, any other time a meeting already has, and a stop at
 * the most the database accepts.
 */

afterEach(() => cleanup());

function picker(value: number[], extra: Partial<Parameters<typeof ReminderPicker>[0]> = {}) {
  const onChange = vi.fn();
  render(<ReminderPicker value={value} onChange={onChange} {...extra} />);
  return onChange;
}

function toggle(minutes: number) {
  return screen.getByRole("button", { name: reminderLabel(minutes) });
}

describe("ReminderPicker", () => {
  it("offers one toggle for each choice, named for its time, pressed when it is chosen", () => {
    picker([1440, 60]);

    for (const minutes of REMINDER_CHOICES) {
      const pressed = minutes === 1440 || minutes === 60;
      expect(toggle(minutes).getAttribute("aria-pressed")).toBe(String(pressed));
    }
    expect(screen.getAllByRole("button")).toHaveLength(REMINDER_CHOICES.length);
  });

  it("adds a time when an unpressed toggle is pressed, latest first", () => {
    const onChange = picker([60, 10]);

    fireEvent.click(toggle(1440));

    expect(onChange).toHaveBeenCalledExactlyOnceWith([1440, 60, 10]);
  });

  it("sorts what it adds in among what is there, whatever order the value came in", () => {
    const onChange = picker([10, 1440]);

    fireEvent.click(toggle(60));

    expect(onChange).toHaveBeenCalledExactlyOnceWith([1440, 60, 10]);
  });

  it("removes a time when a pressed toggle is pressed", () => {
    const onChange = picker([1440, 60]);

    fireEvent.click(toggle(1440));

    expect(onChange).toHaveBeenCalledExactlyOnceWith([60]);
  });

  it("shows a time that is not a choice as a pressed toggle, and lets it be removed", () => {
    const onChange = picker([1440, 45]);

    expect(toggle(45).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button")).toHaveLength(REMINDER_CHOICES.length + 1);

    fireEvent.click(toggle(45));

    expect(onChange).toHaveBeenCalledExactlyOnceWith([1440]);
  });

  it("places a time that is not a choice among the others by how far ahead it is", () => {
    picker([1440, 45]);

    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual([...REMINDER_CHOICES, 45].sort((a, b) => b - a).map(reminderLabel));
  });

  it("keeps a time that is not a choice when another is pressed", () => {
    const onChange = picker([45]);

    fireEvent.click(toggle(60));

    expect(onChange).toHaveBeenCalledExactlyOnceWith([60, 45]);
  });

  it("leaves every toggle free while there is room for one more", () => {
    // Seven reminders, one short of the most.
    const chosen = [2880, 1440, 120, 60, 45, 30, 10];
    expect(chosen).toHaveLength(MAX_REMINDERS - 1);
    picker(chosen);

    for (const button of screen.getAllByRole("button")) {
      expect(button.hasAttribute("disabled")).toBe(false);
    }
  });

  it("disables the toggles that are off once eight are chosen", () => {
    // Eight reminders, none of them the 10080 choice.
    const chosen = [2880, 1440, 120, 60, 45, 30, 10, 5];
    expect(chosen).toHaveLength(MAX_REMINDERS);
    const onChange = picker(chosen);

    const off = toggle(10080);
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(off.hasAttribute("disabled")).toBe(true);
    fireEvent.click(off);
    expect(onChange).not.toHaveBeenCalled();

    // A pressed one can still be turned off.
    const on = toggle(60);
    expect(on.hasAttribute("disabled")).toBe(false);
    fireEvent.click(on);
    expect(onChange).toHaveBeenCalledExactlyOnceWith([2880, 1440, 120, 45, 30, 10, 5]);
  });

  it("says so when there are no reminders", () => {
    picker([]);

    expect(screen.getByText("No reminders")).toBeTruthy();
    for (const minutes of REMINDER_CHOICES) {
      expect(toggle(minutes).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("does not say so when there are some", () => {
    picker([60]);

    expect(screen.queryByText("No reminders")).toBeNull();
  });

  it("disables every toggle when it is disabled", () => {
    const onChange = picker([60], { disabled: true });

    for (const button of screen.getAllByRole("button")) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
    fireEvent.click(toggle(60));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("puts the id on the group, so a label can point at it", () => {
    picker([], { id: "event-reminders" });

    expect(screen.getByRole("group", { name: "Reminders" }).id).toBe("event-reminders");
  });
});
