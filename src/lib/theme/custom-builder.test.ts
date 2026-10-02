import { describe, expect, it } from "vitest";

import { contrastWarnings } from "./contrast";
import { buildCustomRoles, COLOUR_SWATCHES, matchCustomRoles, PAGE_STYLES } from "./custom-builder";
import { deriveDarkRoles } from "./derive";

describe("guided custom theme", () => {
  const combos = COLOUR_SWATCHES.flatMap((c) => PAGE_STYLES.map((p) => [c.id, p.id] as const));

  it.each(combos)("%s on %s passes WCAG AA in light and derived dark", (colour, page) => {
    const light = buildCustomRoles(colour, page);
    expect(contrastWarnings(light, deriveDarkRoles(light))).toEqual([]);
  });

  it("recognises the swatch and page style it built", () => {
    expect(matchCustomRoles(buildCustomRoles("teal", "warm"))).toEqual({ colour: "teal", page: "warm" });
    expect(matchCustomRoles({ ...buildCustomRoles("teal", "warm"), primary: "#123456" })).toEqual({
      colour: null,
      page: "warm",
    });
  });
});
