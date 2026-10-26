import { createIcon } from "../create-icon";

export const ZoomOut = /* @__PURE__ */ createIcon(
  "ZoomOut",
  <>
    <circle cx="10.5" cy="10.5" r="6.5" data-m="shrink" />
    <path d="m20.5 20.5-5-5" />
    <path d="M8 10.5h5" data-m="stretch" />
  </>,
);
