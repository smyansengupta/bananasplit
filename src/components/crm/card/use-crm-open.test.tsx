import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Opening and closing: a create dialog is shallow, anything else goes to the server. */

const nav = vi.hoisted(() => ({
  search: "",
  pathname: "/app/acme/crm",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { setPendingOpen, useCrmOpen, usePendingOpen } from "./use-crm-open";

let pushState: ReturnType<typeof vi.spyOn>;
let replaceState: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  nav.search = "who=all";
  nav.pathname = "/app/acme/crm";
  nav.push.mockClear();
  nav.replace.mockClear();
  pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
});
afterEach(() => {
  act(() => setPendingOpen(null));
  pushState.mockRestore();
  replaceState.mockRestore();
  cleanup();
});

describe("useCrmOpen", () => {
  it("opens a create dialog shallowly, keeping the page's params, with nothing pending", () => {
    const { result } = renderHook(() => ({ crm: useCrmOpen(), pending: usePendingOpen() }));
    act(() => result.current.crm.setOpen({ kind: "new", what: "person" }));
    expect(pushState).toHaveBeenCalledWith(null, "", "/app/acme/crm?who=all&open=new%3Aperson");
    expect(nav.push).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });

  it("opens a new goal shallowly too", () => {
    const { result } = renderHook(() => useCrmOpen());
    act(() => result.current.setOpen("goal"));
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("goes to the server for a card that needs its data, and marks it pending", () => {
    const { result } = renderHook(() => ({ crm: useCrmOpen(), pending: usePendingOpen() }));
    act(() => result.current.crm.setOpen({ kind: "goal", id: "g1" }));
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(pushState).not.toHaveBeenCalled();
    expect(result.current.pending).toBe("goal:g1");
  });

  it("goes to the server on a page with no overlays", () => {
    nav.pathname = "/app/acme/crm/import";
    const { result } = renderHook(() => useCrmOpen());
    act(() => result.current.setOpen({ kind: "new", what: "deal" }));
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(pushState).not.toHaveBeenCalled();
  });

  it("closes a create dialog shallowly and a card through the server", () => {
    nav.search = "who=all&open=new:company";
    const created = renderHook(() => useCrmOpen());
    act(() => created.result.current.close());
    expect(replaceState).toHaveBeenCalledWith(null, "", "/app/acme/crm?who=all");
    expect(nav.replace).not.toHaveBeenCalled();

    nav.search = "open=person:p1";
    const card = renderHook(() => useCrmOpen());
    act(() => card.result.current.close());
    expect(nav.replace).toHaveBeenCalledWith("/app/acme/crm", { scroll: false });
  });
});
