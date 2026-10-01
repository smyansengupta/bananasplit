import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finance › Import in the browser: a CSV is read here (never uploaded),
 * its columns guessed, every row reviewed, rows already in the books
 * unticked, and the import sent and undoable. Files it can't open, and
 * PDFs without an AI model, explain what to do.
 */

const m = vi.hoisted(() => ({
  importRecords: vi.fn(),
  undo: vi.fn(),
  budget: vi.fn(),
  duplicates: vi.fn(),
  connections: vi.fn(),
}));

vi.mock("@/app/app/[orgSlug]/finance/import-actions", () => ({
  importFinanceRecords: m.importRecords,
  undoFinanceImport: m.undo,
  importFinanceBudget: m.budget,
  checkImportDuplicates: m.duplicates,
}));
vi.mock("@/app/app/[orgSlug]/_shell/ai-actions", () => ({ listAiConnectionsAction: m.connections }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { FinanceImport } = await import("./finance-import");

const csv = [
  "Date,Item,Category,Cost",
  "9/5/2026,Pizza,Food,84.50",
  "9/12/2026,Posters,Marketing,35.20",
  ",TOTAL,,119.70",
].join("\n");

function pick(name: string, contents: string | Uint8Array) {
  const file = new File([contents as BlobPart], name);
  fireEvent.change(screen.getByLabelText("Choose a file to import"), { target: { files: [file] } });
}

beforeEach(() => {
  m.connections.mockResolvedValue([]);
  m.duplicates.mockResolvedValue({ duplicates: [] });
  m.importRecords.mockResolvedValue({
    outcome: {
      created: 2,
      skipped: [],
      periods: [{ label: "2026–27", created: false, count: 2 }],
      categoriesCreated: ["Marketing"],
    },
  });
  m.undo.mockResolvedValue({ removed: 2 });
  render(
    <FinanceImport
      orgId="org_1"
      orgSlug="cbc"
      today="2026-10-01"
      periods={[{ id: "p1", label: "2026–27", startsOn: "2026-08-01", endsOn: "2027-07-31", isActive: true }]}
      categories={[{ name: "Food", budgetPeriodId: "p1" }]}
    />,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FinanceImport", () => {
  it("reads a CSV here, guesses the columns, reviews the rows and imports what's ticked", async () => {
    pick("ledger.csv", csv);
    await screen.findByText("Which column is which?");
    expect((screen.getByRole("combobox", { name: "Column 1 (Date)" }) as HTMLSelectElement).value).toBe("date");
    expect((screen.getByRole("combobox", { name: "Column 4 (Cost)" }) as HTMLSelectElement).value).toBe("amount");

    fireEvent.click(screen.getByRole("button", { name: /Review 3 rows/ }));
    await screen.findByText("Check the rows");
    expect(screen.getByText("Looks like a total or balance line")).toBeTruthy();
    expect(screen.getByText("New category")).toBeTruthy();
    await waitFor(() => expect(m.duplicates).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Import 2 transactions" }));
    await screen.findByText(/Imported: 2 transactions/);
    const [orgId, input] = m.importRecords.mock.calls[0];
    expect(orgId).toBe("org_1");
    expect(input).toMatchObject({ source: "ledger.csv", createPeriods: true, createCategories: true, reconciled: false });
    expect(input.batch).toMatch(/^[a-z0-9]{24}$/);
    expect(input.records).toEqual([
      expect.objectContaining({ date: "2026-09-05", description: "Pizza", amountCents: 8450, direction: "OUT", kind: "EXPENSE", category: "Food" }),
      expect.objectContaining({ date: "2026-09-12", description: "Posters", amountCents: 3520, category: "Marketing" }),
    ]);
    expect(screen.getByText("New categories: Marketing")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo import" }));
    await screen.findByText("Import undone");
    expect(m.undo).toHaveBeenCalledWith("org_1", input.batch);
  });

  it("unticks rows that are already in the books", async () => {
    m.duplicates.mockResolvedValue({ duplicates: ["2026-09-05|8450|OUT"] });
    pick("ledger.csv", csv);
    fireEvent.click(await screen.findByRole("button", { name: /Review 3 rows/ }));
    await screen.findByText("Already recorded?");
    expect(screen.getByRole("button", { name: "Import 1 transaction" })).toBeTruthy();
  });

  it("lets a column be changed by hand", async () => {
    pick("ledger.csv", csv);
    const category = await screen.findByRole("combobox", { name: "Column 3 (Category)" });
    fireEvent.change(category, { target: { value: "ignore" } });
    fireEvent.click(screen.getByRole("button", { name: /Review 3 rows/ }));
    await screen.findByText("Check the rows");
    expect(screen.queryByText("New category")).toBeNull();
  });

  it("explains files it can't open, and PDFs when no AI model is connected", async () => {
    pick("old.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]));
    expect(await screen.findByText(/old Excel format/)).toBeTruthy();
    await waitFor(() => expect(m.connections).toHaveBeenCalled());
    pick("statement.pdf", "%PDF-1.7");
    expect(await screen.findByText(/needs an AI model/)).toBeTruthy();
  });
});
