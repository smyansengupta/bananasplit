import { createIcon } from "../create-icon";

export const Cpu = /* @__PURE__ */ createIcon(
  "Cpu",
  <>
    <rect x="5" y="5" width="14" height="14" rx="3" />
    <rect x="9" y="9" width="6" height="6" rx="1" data-m="heartbeat" />
    <path
      d="M9.5 2.5V5m5-2.5V5m-5 14v2.5m5-2.5v2.5M2.5 9.5H5m-2.5 5H5m14-5h2.5m-2.5 5h2.5"
      data-m="flicker"
    />
  </>,
);
