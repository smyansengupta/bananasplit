import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin panel › General: fields that save the moment they change, with no
 * Save button. Covered: meeting reminders (a toggle saves), the weekly
 * update day (a weekday button saves) and the name (saves on blur).
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateMeetingReminderDefault: vi.fn(),
  updateWeeklyUpdateDay: vi.fn(),
  updateOrgName: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("./actions", () => ({
  renameOrgSlug: vi.fn(),
  updateMeetingReminderDefault: mocks.updateMeetingReminderDefault,
  updateOrgName: mocks.updateOrgName,
  updateOrgTimezone: vi.fn(),
  updateWeeklyUpdateDay: mocks.updateWeeklyUpdateDay,
}));
vi.mock("../theme/actions", () => ({ updateLogoDisplay: vi.fn() }));
vi.mock("../pulse/actions", () => ({ savePulseSettingsAction: vi.fn() }));

const { MeetingRemindersField, NameField, WeeklyUpdateDayField } = await import("./general-forms");

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});
afterEach(() => cleanup());

describe("MeetingRemindersField", () => {
  const toggle = (name: string) => screen.getByRole("button", { name });

  it("starts from the organization's reminders, with no Save button", () => {
    render(<MeetingRemindersField orgId="org_1" minutes={[1440, 60]} canEdit />);
    expect(toggle("1 day before").getAttribute("aria-pressed")).toBe("true");
    expect(toggle("1 week before").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves each toggle as it happens, then says so", async () => {
    mocks.updateMeetingReminderDefault.mockResolvedValue({});
    render(<MeetingRemindersField orgId="org_1" minutes={[1440, 60]} canEdit />);

    fireEvent.click(toggle("1 week before"));

    await waitFor(() =>
      expect(mocks.updateMeetingReminderDefault).toHaveBeenCalledExactlyOnceWith(
        "org_1",
        [10080, 1440, 60],
      ),
    );
    expect((await screen.findByRole("status")).textContent).toContain("Saved");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows what went wrong", async () => {
    mocks.updateMeetingReminderDefault.mockResolvedValue({ error: "Use at most 8 reminders." });
    render(<MeetingRemindersField orgId="org_1" minutes={[60]} canEdit />);

    fireEvent.click(toggle("1 week before"));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Use at most 8 reminders."),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("is read-only for someone who cannot change settings", () => {
    render(<MeetingRemindersField orgId="org_1" minutes={[60]} canEdit={false} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });
});

describe("WeeklyUpdateDayField", () => {
  it("shows the week as buttons, Monday first, and saves a click", async () => {
    mocks.updateWeeklyUpdateDay.mockResolvedValue({});
    render(<WeeklyUpdateDayField orgId="org_1" day={0} canEdit />);

    const days = screen.getAllByRole("button").map((b) => b.textContent);
    expect(days).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

    fireEvent.click(screen.getByRole("button", { name: "Fri" }));
    await waitFor(() =>
      expect(mocks.updateWeeklyUpdateDay).toHaveBeenCalledExactlyOnceWith("org_1", 5),
    );
  });
});

describe("NameField", () => {
  it("saves when the field loses focus, and not when nothing changed", async () => {
    mocks.updateOrgName.mockResolvedValue({});
    render(<NameField orgId="org_1" name="Riverside Robotics" canEdit />);
    const input = screen.getByLabelText("Name");

    fireEvent.blur(input);
    expect(mocks.updateOrgName).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Riverside Robotics Club" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(mocks.updateOrgName).toHaveBeenCalledExactlyOnceWith(
        "org_1",
        "Riverside Robotics Club",
      ),
    );
  });
});
