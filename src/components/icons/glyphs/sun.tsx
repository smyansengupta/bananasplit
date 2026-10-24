import { createIcon } from "../create-icon";

/** The sun's rays are eight seeds. */
export const Sun = /* @__PURE__ */ createIcon(
  "Sun",
  <>
    <circle cx="12" cy="12" r="4.25" data-m="glow-core" />
    <circle cx="12" cy="3.75" r="1.25" fill="currentColor" stroke="none" data-m="ray" />
    <circle
      cx="17.83"
      cy="6.17"
      r="1.25"
      fill="currentColor"
      stroke="none"
      data-m="ray"
      data-d="1"
    />
    <circle cx="20.25" cy="12" r="1.25" fill="currentColor" stroke="none" data-m="ray" data-d="2" />
    <circle
      cx="17.83"
      cy="17.83"
      r="1.25"
      fill="currentColor"
      stroke="none"
      data-m="ray"
      data-d="3"
    />
    <circle cx="12" cy="20.25" r="1.25" fill="currentColor" stroke="none" data-m="ray" data-d="4" />
    <circle
      cx="6.17"
      cy="17.83"
      r="1.25"
      fill="currentColor"
      stroke="none"
      data-m="ray"
      data-d="5"
    />
    <circle cx="3.75" cy="12" r="1.25" fill="currentColor" stroke="none" data-m="ray" data-d="6" />
    <circle
      cx="6.17"
      cy="6.17"
      r="1.25"
      fill="currentColor"
      stroke="none"
      data-m="ray"
      data-d="7"
    />
  </>,
);
