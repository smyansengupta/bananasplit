import { createIcon } from "../create-icon";

export const Keyboard = /* @__PURE__ */ createIcon(
  "Keyboard",
  <>
    <rect x="2.5" y="5.5" width="19" height="13" rx="3" />
    <circle cx="7" cy="10" r="1" fill="currentColor" stroke="none" data-m="keypress" />
    <circle
      cx="10.33"
      cy="10"
      r="1"
      fill="currentColor"
      stroke="none"
      data-m="keypress"
      data-d="1"
    />
    <circle
      cx="13.67"
      cy="10"
      r="1"
      fill="currentColor"
      stroke="none"
      data-m="keypress"
      data-d="2"
    />
    <circle cx="17" cy="10" r="1" fill="currentColor" stroke="none" data-m="keypress" data-d="3" />
    <path d="M8 14.5h8" data-m="keypress" data-d="4" />
  </>,
);
