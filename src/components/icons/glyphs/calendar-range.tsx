import { createIcon } from "../create-icon";

export const CalendarRange = /* @__PURE__ */ createIcon(
  "CalendarRange",
  <>
    <rect x="3.5" y="5" width="17" height="16" rx="3" />
    <path d="M8 3v4m8-4v4" />
    <path d="M3.5 10h17" />
    <path d="M10.5 14h6" data-m="grow-x" data-o="l" data-d="1" />
    <path d="M7.5 17.5h5" data-m="grow-x" data-o="l" data-d="2" />
    <circle cx="7.75" cy="14" r="1" fill="currentColor" stroke="none" data-m="pop" />
    <circle cx="16" cy="17.5" r="1" fill="currentColor" stroke="none" data-m="pop" data-d="3" />
  </>,
);
