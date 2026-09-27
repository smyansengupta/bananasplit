import type { DecorationAttrs } from "@tiptap/pm/view";

import { PRESENCE_SLOTS } from "@/lib/collab/protocol";

/**
 * Other editors' carets and selections in a live note, coloured with the
 * theme's --chart-1..5 tokens (styles in globals.css). CollaborationCaret's
 * own renderers accept only raw hex colours, which the theme rules forbid;
 * `user` is the awareness user the collaboration server stamped from the
 * token ({ id, name, slot }).
 */

function caretColor(user: Record<string, unknown>): string {
  const slot = Number(user.slot);
  return `var(--chart-${Number.isInteger(slot) && slot >= 1 && slot <= PRESENCE_SLOTS ? slot : 1})`;
}

export function renderCaret(user: Record<string, unknown>): HTMLElement {
  const caret = document.createElement("span");
  caret.className = "collaboration-carets__caret";
  caret.style.setProperty("--caret-color", caretColor(user));
  const label = document.createElement("div");
  label.className = "collaboration-carets__label";
  label.textContent = typeof user.name === "string" ? user.name : "";
  caret.append(label);
  return caret;
}

export function renderSelection(user: Record<string, unknown>): DecorationAttrs {
  return {
    nodeName: "span",
    class: "collaboration-carets__selection",
    style: `--caret-color: ${caretColor(user)}`,
  };
}
