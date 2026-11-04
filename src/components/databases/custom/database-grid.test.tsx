import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FieldDef } from "@/lib/databases/fields";
import type { CustomDatabase, CustomRecord } from "@/server/databases/custom";

/**
 * The grid against mocked actions: a failed save puts back only its own
 * cell, rows load a page at a time and search runs on the server, and the
 * trash's dates read the same wherever the page renders.
 */

const a = vi.hoisted(() => ({
  updateCell: vi.fn(),
  loadRecords: vi.fn(),
  deleteDatabase: vi.fn(),
}));

vi.mock("@/components/links/linked-loader", () => ({ LinkedLoader: () => null }));
vi.mock("@/app/app/[orgSlug]/databases/custom-actions", () => ({
  addChoiceAction: vi.fn(),
  addFieldAction: vi.fn(),
  archiveDatabaseAction: vi.fn(),
  createRecordAction: vi.fn(),
  deleteDatabaseAction: a.deleteDatabase,
  deleteFieldAction: vi.fn(),
  loadRecordsAction: a.loadRecords,
  moveFieldAction: vi.fn(),
  purgeRecordsAction: vi.fn(),
  restoreRecordsAction: vi.fn(),
  trashRecordsAction: vi.fn(),
  updateCellAction: a.updateCell,
  updateDatabaseSettingsAction: vi.fn(),
  updateFieldAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { DatabaseGrid } = await import("./database-grid");

const name: FieldDef = { id: "f_name", name: "Name", type: "TEXT", options: {}, isPrimary: true };
const major: FieldDef = {
  id: "f_major",
  name: "Major",
  type: "TEXT",
  options: {},
  isPrimary: false,
};

function row(id: string, values: Record<string, unknown>, extra: Partial<CustomRecord> = {}) {
  return {
    id,
    values,
    createdAt: `2026-01-01T12:00:0${id.slice(-1)}.000Z`,
    updatedAt: "2026-01-01T12:00:00.000Z",
    createdByName: null,
    updatedByName: null,
    deletedAt: null,
    ...extra,
  };
}

function db(overrides: Partial<CustomDatabase> = {}): CustomDatabase {
  return {
    id: "db_1",
    key: "roster",
    name: "Roster",
    description: null,
    icon: null,
    memberVisibility: "MEMBERS",
    memberCanEdit: false,
    fields: [name, major],
    records: [row("r1", { f_name: "Maya", f_major: "Physics" })],
    next: null,
    total: 1,
    trashCount: 0,
    canEdit: true,
    canManage: true,
    canDelete: true,
    deleteBlocked: null,
    reportCount: 0,
    labels: {},
    ...overrides,
  };
}

const grid = (database: CustomDatabase, trash = false, timezone = "America/New_York") => (
  <DatabaseGrid
    orgId="org_1"
    orgSlug="chess"
    database={database}
    members={[]}
    trash={trash}
    timezone={timezone}
  />
);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

/** A promise the test settles when it wants to. */
function later<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function edit(label: RegExp, text: string) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

describe("saving cells", () => {
  it("puts back only the cell whose save failed, not the row's other edits", async () => {
    const majorSave = later<{ error: string }>();
    const nameSave = later<{ data: string }>();
    a.updateCell.mockImplementation((_org: string, _row: string, fieldId: string) =>
      fieldId === "f_name" ? nameSave.promise : majorSave.promise,
    );
    render(grid(db()));
    // Major first, then Name while Major is still saving; then Major fails.
    edit(/^Major for Maya$/, "Maths");
    edit(/^Name for Maya$/, "Maya Patel");
    await act(async () => majorSave.resolve({ error: "Something broke." }));

    expect((screen.getByLabelText(/^Major for/) as HTMLInputElement).value).toBe("Physics");
    expect((screen.getByLabelText(/^Name for/) as HTMLInputElement).value).toBe("Maya Patel");
    await act(async () => nameSave.resolve({ data: "Maya Patel" }));
    expect((screen.getByLabelText(/^Name for/) as HTMLInputElement).value).toBe("Maya Patel");
  });
});

describe("paging and search", () => {
  it("says how many rows are loaded and loads the next page", async () => {
    a.loadRecords.mockResolvedValue({
      data: { records: [row("r3", { f_name: "Sam" })], next: null, total: 3 },
    });
    render(
      grid(
        db({
          records: [row("r1", { f_name: "Maya" }), row("r2", { f_name: "Jay" })],
          next: "2026-01-01T12:00:02.000Z~r2",
          total: 3,
        }),
      ),
    );
    expect(screen.getByText("2 of 3 rows loaded")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load more" })));
    expect(a.loadRecords).toHaveBeenCalledWith("org_1", "db_1", {
      trash: false,
      q: "",
      after: "2026-01-01T12:00:02.000Z~r2",
    });
    expect(screen.getByText("3 rows")).toBeTruthy();
    expect(screen.getByLabelText(/^Name for Sam$/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("searches on the server once typing pauses", async () => {
    a.loadRecords.mockResolvedValue({
      data: { records: [row("r9", { f_name: "Priya" })], next: null, total: 1 },
    });
    render(grid(db({ next: "2026-01-01T12:00:01.000Z~r1", total: 800 })));
    fireEvent.change(screen.getByLabelText("Search Roster"), { target: { value: "pri" } });
    fireEvent.change(screen.getByLabelText("Search Roster"), { target: { value: "priya" } });
    await waitFor(() => expect(a.loadRecords).toHaveBeenCalledTimes(1));
    expect(a.loadRecords).toHaveBeenCalledWith("org_1", "db_1", {
      trash: false,
      q: "priya",
      limit: undefined,
    });
    await waitFor(() => expect(screen.getByText("1 match")).toBeTruthy());
    expect(screen.getByLabelText(/^Name for Priya$/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Name for Maya$/)).toBeNull();
  });
});

describe("the trash", () => {
  it("shows when rows were deleted in the organization's time zone, the same on the server", () => {
    const trash = db({
      records: [row("r1", { f_name: "Maya" }, { deletedAt: "2026-01-01T12:00:00.000Z" })],
      trashCount: 1,
    });
    const html = renderToString(grid(trash, true));
    expect(html).toContain("Jan 1, 2026, 7:00 AM");
    render(grid(trash, true));
    expect(screen.getByText("Jan 1, 2026, 7:00 AM")).toBeTruthy();
    expect(screen.getByText("1 row")).toBeTruthy();
  });
});

describe("deleting the database", () => {
  it("gives a member who may delete it a Delete button and a clear confirm", async () => {
    a.deleteDatabase.mockResolvedValue({});
    render(grid(db({ canManage: false, canDelete: true, reportCount: 2 })));
    fireEvent.click(screen.getByRole("button", { name: "Delete database" }));
    expect(await screen.findByText("Delete Roster?")).toBeTruthy();
    expect(
      screen.getByText(
        "Its rows and fields are deleted for good. This can't be undone. 2 reports read it and will show it's gone.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete database" }),
    );
    await waitFor(() => expect(a.deleteDatabase).toHaveBeenCalledWith("org_1", "db_1"));
  });

  it("shows no Delete to a member who may not delete it", () => {
    render(grid(db({ canManage: false, canDelete: false })));
    expect(screen.queryByRole("button", { name: "Delete database" })).toBeNull();
  });

  it("keeps an owner's or admin's Delete in Settings, not the header", () => {
    render(grid(db()));
    expect(screen.queryByRole("button", { name: "Delete database" })).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });
});
