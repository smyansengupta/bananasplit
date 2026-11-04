import { act, cleanup, render, screen } from "@testing-library/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The moment a card is asked for (docs/features/crm.md, "Cards"): a create
 * dialog's link is taken before it can navigate and never draws a frame,
 * every other card gets the frame of its own shape, and a card landing on
 * its frame doesn't fade in. What the card leans on is stubbed.
 */

const nav = vi.hoisted(() => ({
  search: "",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  usePathname: () => "/app/acme/crm",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { CrmCard } from "./crm-card";
import { CrmPendingCard } from "./crm-pending-card";
import { setPendingOpen, useCrmOpen } from "./use-crm-open";

function Links({ children }: { children?: ReactNode }) {
  return (
    <>
      <Link href="/app/acme/crm?open=new:person">New person</Link>
      <Link href="/app/acme/crm?open=goal">New goal</Link>
      <Link href="/app/acme/crm?open=person:p1">Maya</Link>
      <Link href="/app/acme/crm?open=log">See all</Link>
      <CrmPendingCard />
      {children}
    </>
  );
}

/** Clicks and says whether a link's own handler, running after, would stand down. */
function click(name: string): boolean {
  let taken = false;
  const after = (e: Event) => {
    taken = e.defaultPrevented;
    e.preventDefault(); // jsdom can't navigate
  };
  document.addEventListener("click", after);
  act(() => {
    screen.getByRole("link", { name }).click();
  });
  document.removeEventListener("click", after);
  return taken;
}

let pushState: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  nav.search = "";
  nav.push.mockClear();
  nav.replace.mockClear();
  pushState = vi.spyOn(window.history, "pushState");
  window.history.replaceState(null, "", "/app/acme/crm");
});
afterEach(() => {
  act(() => setPendingOpen(null));
  pushState.mockRestore();
  cleanup();
});

describe("asking for a create dialog", () => {
  it("takes the link's click and moves the URL shallowly, with no frame", () => {
    render(<Links />);
    expect(click("New person")).toBe(true);
    expect(pushState).toHaveBeenCalledWith(null, "", expect.stringContaining("open=new:person"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("does the same for a new goal", () => {
    render(<Links />);
    expect(click("New goal")).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never draws a frame even if one is asked for", () => {
    render(<Links />);
    act(() => setPendingOpen("new:company"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("asking for a card that loads", () => {
  it("leaves the link alone and draws the 680px frame", () => {
    render(<Links />);
    expect(click("Maya")).toBe(false);
    expect(pushState).not.toHaveBeenCalled();
    const frame = screen.getByRole("dialog");
    expect(frame.className).toContain("sm:max-w-[680px]");
    expect(frame.className).toContain("data-open:animate-in");
    expect(frame.className).not.toContain("data-closed:animate-out");
  });

  it("draws New person's window for a card that is one", () => {
    render(<Links />);
    click("See all");
    const frame = screen.getByRole("dialog");
    expect(frame.className).toContain("sm:max-w-2xl");
    expect(frame.className).not.toContain("sm:max-w-[680px]");
  });

  it("takes another card's place without a fade", () => {
    nav.search = "open=person:p2";
    render(<Links />);
    act(() => setPendingOpen("person:p1"));
    expect(screen.getByRole("dialog").className).not.toContain("animate-in");
  });

  it("gives way to the card, which lands without fading in", () => {
    const { rerender } = render(<Links />);
    act(() => setPendingOpen("person:p1"));
    nav.search = "open=person:p1";
    rerender(
      <Links>
        <CrmCard title="Maya">Her card</CrmCard>
      </Links>,
    );
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]!.textContent).toContain("Her card");
    expect(dialogs[0]!.className).not.toContain("animate-in");
  });
});

describe("a card with a create dialog opened over it", () => {
  function Moved() {
    const { raw } = useCrmOpen();
    return <span>{raw}</span>;
  }

  it("hides, because the page under it isn't replaced", () => {
    nav.search = "open=company:c1";
    const { rerender } = render(<CrmCard title="Harborlight">Its card</CrmCard>);
    expect(screen.getByRole("dialog")).toBeTruthy();
    nav.search = "open=new:person&with=company:c1";
    rerender(
      <>
        <CrmCard title="Harborlight">Its card</CrmCard>
        <Moved />
      </>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
