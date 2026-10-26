import { createIcon } from "../create-icon";

/**
 * The loading mark: the logo's three seeds, fading round. Spin it with
 * animate-spin.
 */
export const Loader = /* @__PURE__ */ createIcon(
  "Loader",
  <>
    <g fill="currentColor" stroke="none">
      <ellipse cx="12" cy="6" rx="2.25" ry="3.75" />
      <ellipse cx="12" cy="6" rx="2.25" ry="3.75" opacity=".6" transform="rotate(120 12 12)" />
      <ellipse cx="12" cy="6" rx="2.25" ry="3.75" opacity=".3" transform="rotate(240 12 12)" />
    </g>
  </>,
  "spin",
);
