import { createIcon } from "../create-icon";

export const Timer = /* @__PURE__ */ createIcon(
  "Timer",
  <>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M10 2.5h4M12 2.5V6" data-m="press-d" />
    <path d="M12 13.5l3-3" data-m="sweep" data-o="v" style={{ transformOrigin: "12px 13.5px" }} />
  </>,
);
