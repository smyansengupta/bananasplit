import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PricingPlans } from "./pricing-plans";

/** The comparison lists AI connectors (every plan) only while they are on, as Settings › Plan does. */
describe("PricingPlans' comparison", () => {
  const ROW = "AI connectors: Claude, ChatGPT and other AI apps";

  it("lists AI connectors on every team plan while they are on", () => {
    render(<PricingPlans connectors />);
    const row = screen.getByRole("rowheader", { name: ROW }).closest("tr")!;
    expect(row.querySelectorAll('[aria-label="Included"]')).toHaveLength(4);
  });

  it("leaves them out while they are off", () => {
    render(<PricingPlans />);
    expect(screen.queryByRole("rowheader", { name: ROW })).toBeNull();
    expect(screen.getByRole("rowheader", { name: "Member directory and roles" })).toBeTruthy();
  });
});
