import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./button";
import { CreateSplitButton } from "./create-split-button";
import { DropdownMenuItem } from "./dropdown-menu";

/** The create button is plain: a solid fill and a hairline, no glow, no shadow, in any state. */

afterEach(cleanup);

function expectPlain(el: HTMLElement) {
  expect(el.className).toContain("bg-create");
  expect(el.className).toContain("border-input");
  expect(el.className).not.toContain("glow-halo");
  // The focus outline stays; the base button's glow on focus doesn't.
  expect(el.className).toContain("focus-visible:outline-2");
  expect(el.className).toContain("focus-visible:shadow-none");
  expect(el.className).not.toContain("focus-visible:shadow-[");
  expect(el.getAttribute("style")).toBeNull();
}

describe("the create button", () => {
  it("is plain", () => {
    render(<Button variant="create">Invite</Button>);
    expectPlain(screen.getByRole("button", { name: "Invite" }));
  });

  it("keeps the base button's focus glow on the other variants", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).className).toContain(
      "focus-visible:shadow-[",
    );
  });

  it("is plain in both halves of the split, with one hairline between them", () => {
    const { container } = render(
      <CreateSplitButton label="New task" menuLabel="More ways to add tasks">
        <DropdownMenuItem>New epic</DropdownMenuItem>
      </CreateSplitButton>,
    );
    const main = screen.getByRole("button", { name: "New task" });
    const chevron = screen.getByRole("button", { name: "More ways to add tasks" });
    expectPlain(main);
    expectPlain(chevron);
    expect(main.className).toContain("border-r-0");
    expect(chevron.className).not.toContain("border-r-0");
    expect((container.firstChild as HTMLElement).className).not.toContain("glow-halo");
  });
});
