import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The create dialogs open from what came with the page: the real dialog on
 * the first render, nothing fetched first, `?with=` filled in afterwards.
 */

const mocks = vi.hoisted(() => ({
  search: "",
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  newCardStart: vi.fn(),
  goalActual: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: mocks.refresh }),
  usePathname: () => "/app/acme/crm",
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/app/app/[orgSlug]/crm/actions", () => ({ searchCrmAction: vi.fn() }));
vi.mock("@/app/app/[orgSlug]/crm/people-actions", () => ({
  likelyExistingAction: vi.fn(async () => ({ ok: true, match: null })),
  newCardStartAction: mocks.newCardStart,
  newCompanyAction: vi.fn(),
  newDealAction: vi.fn(),
  newPersonAction: vi.fn(),
  readSignatureAction: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/crm/goal-actions", () => ({
  deleteGoalAction: vi.fn(),
  goalActualAction: mocks.goalActual,
  saveGoalAction: vi.fn(),
}));
vi.mock("@/components/crm/ai/image", () => ({
  IMAGE_ACCEPT: "image/*",
  sendImage: vi.fn(),
  shrinkImage: vi.fn(),
}));
vi.mock("@/components/crm/crm-picker", () => ({ CrmPicker: () => null }));
vi.mock("@/components/tasks/task-fields", () => ({
  MemberOwnerField: () => <button type="button">Owner</button>,
}));

import { CrmCreateHost, type CrmCreateData } from "./create-host";

const data: CrmCreateData = {
  orgId: "org1",
  viewerId: "u1",
  personal: false,
  canSetGoals: true,
  members: [],
  pipelines: [{ id: "p1", name: "Sales", stages: [{ id: "s1", name: "New" }] }],
  relationships: [],
  goal: { metric: "items_won", periodKey: "2026-Q4", today: "2026-11-04" },
};

beforeEach(() => {
  mocks.search = "";
  mocks.replace.mockClear();
  mocks.newCardStart.mockReset();
  mocks.goalActual.mockReset();
  mocks.goalActual.mockResolvedValue({ ok: true, actual: 0 });
});
afterEach(cleanup);

describe("CrmCreateHost", () => {
  it("draws nothing when no create dialog is asked for", () => {
    mocks.search = "open=person:p1";
    render(<CrmCreateHost data={data} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens New person on the first render, ready to type in, asking the server nothing", () => {
    mocks.search = "open=new:person";
    render(<CrmCreateHost data={data} />);
    expect(screen.getByRole("dialog", { name: "New person" })).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBe(document.activeElement);
    expect(mocks.newCardStart).not.toHaveBeenCalled();
  });

  it("opens New company and New deal the same way", () => {
    mocks.search = "open=new:company";
    const company = render(<CrmCreateHost data={data} />);
    expect(screen.getByRole("dialog", { name: "New company" })).toBeTruthy();
    company.unmount();
    mocks.search = "open=new:deal";
    render(<CrmCreateHost data={data} />);
    expect(screen.getByRole("dialog", { name: "New deal" })).toBeTruthy();
  });

  it("fills ?with= in behind the open dialog", async () => {
    mocks.search = "open=new:person&with=company:c1";
    mocks.newCardStart.mockResolvedValue({
      ok: true,
      company: { id: "c1", label: "Harborlight" },
      people: [],
    });
    render(<CrmCreateHost data={data} />);
    const box = screen.getByLabelText("Company") as HTMLInputElement;
    expect(box.value).toBe("");
    await waitFor(() => expect(box.value).toBe("Harborlight"));
    expect(mocks.newCardStart).toHaveBeenCalledWith("org1", "company:c1");
  });

  it("never overwrites a company typed before ?with= came back", async () => {
    mocks.search = "open=new:person&with=company:c1";
    let answer: (v: unknown) => void = () => {};
    mocks.newCardStart.mockReturnValue(new Promise((r) => (answer = r)));
    render(<CrmCreateHost data={data} />);
    const box = screen.getByLabelText("Company") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "Acme" } });
    answer({ ok: true, company: { id: "c1", label: "Harborlight" }, people: [] });
    await new Promise((r) => setTimeout(r));
    expect(box.value).toBe("Acme");
  });

  it("closes shallowly, taking ?with= off the URL", () => {
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    mocks.search = "who=all&open=new:person&with=company:c1";
    mocks.newCardStart.mockResolvedValue({ ok: true, company: null, people: [] });
    render(<CrmCreateHost data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(replaceState).toHaveBeenCalledWith(null, "", "/app/acme/crm?who=all");
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    replaceState.mockRestore();
  });

  it("opens a new goal at once and reads what it has reached afterwards", async () => {
    mocks.search = "open=goal";
    mocks.goalActual.mockResolvedValue({ ok: true, actual: 3 });
    render(<CrmCreateHost data={data} />);
    expect(screen.getByRole("dialog", { name: "New goal" })).toBeTruthy();
    await screen.findByText("3 deals");
    expect(mocks.goalActual).toHaveBeenCalledTimes(1);
  });

  it("tells a member who can't set goals who does", () => {
    mocks.search = "open=goal";
    render(<CrmCreateHost data={{ ...data, canSetGoals: false }} />);
    expect(screen.getByRole("dialog", { name: "CRM managers set goals" })).toBeTruthy();
    expect(mocks.goalActual).not.toHaveBeenCalled();
  });
});
