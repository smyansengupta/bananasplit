import { createIcon } from "../create-icon";

export const Gauge = /* @__PURE__ */ createIcon(
  "Gauge",
  <>
    <path d="M4.2 18.5a9 9 0 1 1 15.6 0" />
    <path
      d="m13.1 12.9 3.4-3.4"
      data-m="needle"
      data-o="v"
      style={{ transformOrigin: "12px 14px" }}
    />
    <circle cx="12" cy="14" r="1.75" fill="currentColor" stroke="none" />
  </>,
);
