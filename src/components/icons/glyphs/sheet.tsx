import { createIcon } from "../create-icon";

export const Sheet = /* @__PURE__ */ createIcon(
  "Sheet",
  <>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M3 9h18" data-m="grow-x" data-o="l" />
    <path d="M3 15h18" data-m="grow-x" data-o="l" data-d="1" />
    <path d="M9 9v12" data-m="grow-y" data-o="t" data-d="2" />
    <path d="M15 9v12" data-m="grow-y" data-o="t" data-d="3" />
  </>,
);
