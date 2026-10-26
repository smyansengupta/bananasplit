import { fireEvent, screen, within } from "@testing-library/react";

/**
 * Driving a themed drop-down (FieldSelect, and the Select it is built on) in
 * jsdom.
 *
 * jsdom has no pointer capture and no scrollIntoView, both of which Radix's
 * Select reaches for as it opens. So: stub them once per file, then open and
 * pick.
 *
 *   stubPointerEvents();
 *   openSelect(screen.getByRole("combobox", { name: "Their access" }));
 *   fireEvent.click(screen.getByRole("option", { name: "Viewer" }));
 *
 * or, in one step, pickOption(trigger, "Viewer").
 *
 * The trigger shows the picked option's text, so `chosen(trigger)` reads
 * what a native select's `.value` used to say — by label, not by value.
 */

export function stubPointerEvents() {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
}

export function openSelect(trigger: HTMLElement) {
  // Radix opens on pointerdown for a mouse and on click for anything else.
  // jsdom has no PointerEvent, so click is the one that lands.
  fireEvent.click(trigger);
}

/** Opens the drop-down and picks the option with this name. */
export function pickOption(trigger: HTMLElement, name: string | RegExp) {
  openSelect(trigger);
  const listbox = screen.getByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name }));
}

/** What the trigger is showing: the picked option's own text. */
export function chosen(trigger: HTMLElement): string {
  return (trigger.textContent ?? "").trim();
}

/** Every option the drop-down offers, in order, by the text each one reads. */
export function optionLabels(trigger: HTMLElement): string[] {
  openSelect(trigger);
  const listbox = screen.getByRole("listbox");
  return within(listbox)
    .getAllByRole("option")
    .map((o) => (o.textContent ?? "").trim());
}
