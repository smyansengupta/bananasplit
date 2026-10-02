import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { resolveSidebar } from "@/lib/nav/sidebar";
import type { SearchResponse, SearchScope } from "@/lib/search/types";

const { push, openPicker } = vi.hoisted(() => ({ push: vi.fn(), openPicker: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ setTheme: vi.fn(), forcedTheme: undefined }) }));
vi.mock("@/components/pins/pins-context", () => ({ usePins: () => ({ openPicker }) }));
vi.mock("@/app/app/[orgSlug]/notes/actions", () => ({ createNote: vi.fn() }));
vi.mock("@/app/app/[orgSlug]/search/actions", () => ({ searchWorkspaceAction: vi.fn() }));

import { CommandPalette } from "./command-palette";

beforeAll(() => {
  // jsdom lacks what cmdk and Radix use for layout.
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  vi.clearAllMocks();
});

const sections = resolveSidebar(null)
  .flatMap((g) => g.items)
  .map((i) => ({
    id: i.id,
    label: i.label,
    defaultLabel: i.defaultLabel,
    path: i.path,
    hidden: i.hidden,
    icon: i.icon,
    description: i.description,
  }));

function answer(query: string, scope: SearchScope, titles: string[]): SearchResponse {
  return {
    query,
    scope,
    groups: titles.length
      ? [
          {
            id: "notes",
            label: "Notes",
            hits: titles.map((title, i) => ({
              key: `note:${title}`,
              kind: "note" as const,
              title,
              href: `/app/cbc/notes/${i}`,
              score: 100 - i,
            })),
          },
        ]
      : [],
  };
}

/** A search whose answers the test releases, in any order. */
function controlledSearch() {
  const calls: {
    input: { query: string; scope: SearchScope };
    resolve: (r: SearchResponse) => void;
    reject: (e: Error) => void;
  }[] = [];
  const search = vi.fn(
    (_orgId: string, input: { query: string; scope: SearchScope }) =>
      new Promise<SearchResponse>((resolve, reject) => calls.push({ input, resolve, reject })),
  );
  return { search, calls };
}

function renderPalette(search: ReturnType<typeof controlledSearch>["search"]) {
  render(
    <CommandPalette
      orgId="org1"
      orgSlug="cbc"
      role="MEMBER"
      sections={sections}
      orgs={[]}
      open
      onOpenChange={vi.fn()}
      search={search}
    />,
  );
  return screen.getByRole("combobox") as HTMLInputElement;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
}

describe("CommandPalette", () => {
  it("keeps the newest answer when an older request comes back late", async () => {
    const { search, calls } = controlledSearch();
    const input = renderPalette(search);
    await waitFor(() => expect(calls).toHaveLength(1)); // the home view
    await act(async () => calls[0].resolve(answer("", "all", [])));

    await type(input, "gal");
    await waitFor(() => expect(calls).toHaveLength(2));
    await type(input, "gala");
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].input).toEqual({ query: "gala", scope: "all" });

    await act(async () => calls[2].resolve(answer("gala", "all", ["Gala venue"])));
    await act(async () => calls[1].resolve(answer("gal", "all", ["An older answer"])));
    expect(await screen.findByText("venue")).toBeTruthy();
    expect(screen.queryByText("An older answer")).toBeNull();
  });

  it("shows matching pages before the server answers, and opens the top hit on Enter", async () => {
    const { search, calls } = controlledSearch();
    const input = renderPalette(search);
    await type(input, "kanban");
    // The page catalog answers at once; the server hasn't yet.
    expect(screen.getByText("Task board")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(push).toHaveBeenCalledWith("/app/cbc/tasks?view=board");
    expect(calls.some((c) => c.input.query === "kanban")).toBe(false);
  });

  it("opens the selection in a new tab on ⌘↵ or Ctrl+↵", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { search } = controlledSearch();
    const input = renderPalette(search);
    await type(input, "kanban");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    });
    expect(open).toHaveBeenCalledWith("/app/cbc/tasks?view=board", "_blank", "noopener");
    expect(push).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("steps through the filters with Tab, and Backspace in an empty box clears the filter", async () => {
    const { search, calls } = controlledSearch();
    const input = renderPalette(search);
    await act(async () => {
      fireEvent.keyDown(input, { key: "Tab" });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Tab" });
    });
    expect(screen.getByRole("button", { name: "Notes" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(calls.at(-1)?.input).toEqual({ query: "", scope: "notes" }));
    expect(input.placeholder).toBe("Search notes…");

    await act(async () => {
      fireEvent.keyDown(input, { key: "Backspace" });
    });
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says when search failed and retries on request", async () => {
    const { search, calls } = controlledSearch();
    const input = renderPalette(search);
    await type(input, "minutes");
    await waitFor(() => expect(calls.at(-1)?.input.query).toBe("minutes"));
    await act(async () => calls.at(-1)!.reject(new Error("offline")));
    expect(await screen.findByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(calls.filter((c) => c.input.query === "minutes")).toHaveLength(2));
    await act(async () => calls.at(-1)!.resolve(answer("minutes", "all", ["Board minutes"])));
    expect(await screen.findByText("Board")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says nothing matched, and offers to widen a filtered search", async () => {
    const { search, calls } = controlledSearch();
    const input = renderPalette(search);
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    await type(input, "zebra");
    await waitFor(() => expect(calls.at(-1)?.input).toEqual({ query: "zebra", scope: "tasks" }));
    await act(async () => calls.at(-1)!.resolve(answer("zebra", "tasks", [])));
    expect(await screen.findByText(/Nothing in tasks matches/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search everything instead" }));
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  });
});
