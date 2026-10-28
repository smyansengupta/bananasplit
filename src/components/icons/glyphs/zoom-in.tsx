import { createIcon } from "../create-icon";

export const ZoomIn = /* @__PURE__ */ createIcon(
  "ZoomIn",
  <>
    <circle cx="10.5" cy="10.5" r="6.5" data-m="zoom" />
    <path d="m20.5 20.5-5-5" />
    <path d="M10.5 8v5M8 10.5h5" data-m="grow" />
  </>,
);
