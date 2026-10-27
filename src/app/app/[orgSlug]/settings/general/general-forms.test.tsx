import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settings > General: the reminders a new meeting starts with
 * (OrgSettings.meetingReminderMinutes). Only this form is covered here; the
 * others are plain one-field saves.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateMeetingReminderDefault: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("./actions", () => ({
  renameOrgSlug: vi.fn(),
  updateMeetingReminderDefault: mocks.updateMeetingReminderDefault,
  updateOrgName: vi.fn(),
  updateOrgTimezone: vi.fn(),
  updateWeeklyUpdateDay: vi.fn(),
}));

const { MeetingRemindersForm } = await import("./general-forms");

function form(overrides: Partial<Parameters<typeof MeetingRemindersForm>[0]> = {}) {
  return render(<MeetingRemindersForm orgId="org_1" minutes={[1440, 60]} canEdit {...overrides} />);
}

const save = () => screen.getByRole("button", { name: "Save" });
const toggle = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.updateMeetingReminderDefault.mockReset();
});
afterEach(() => cleanup());

describe("MeetingRemindersForm", () => {
  it("says what it is for", () => {
    form();

    expect(screen.getByText("Meeting reminders")).toBeTruthy();
    expect(
      screen.getByText(
        "New meetings remind everyone going at these times. Each meeting can change its own.",
      ),
    ).toBeTruthy();
  });

  it("starts from the organization's reminders", () => {
    form();

    expect(toggle("1 day before").getAttribute("aria-pressed")).toBe("true");
    expect(toggle("1 hour before").getAttribute("aria-pressed")).toBe("true");
    expect(toggle("1 week before").getAttribute("aria-pressed")).toBe("false");
  });

  it("has nothing to save until something changes", () => {
    form();
    expect(save().hasAttribute("disabled")).toBe(true);

    fireEvent.click(toggle("1 week before"));
    expect(save().hasAttribute("disabled")).toBe(false);

    // Back to what it was.
    fireEvent.click(toggle("1 week before"));
    expect(save().hasAttribute("disabled")).toBe(true);
  });

  it("saves the chosen times, says so, and refreshes", async () => {
    mocks.updateMeetingReminderDefault.mockResolvedValue({});
    form();

    fireEvent.click(toggle("1 week before"));
    fireEvent.click(toggle("1 hour before"));
    fireEvent.click(save());

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.updateMeetingReminderDefault).toHaveBeenCalledExactlyOnceWith(
      "org_1",
      [10080, 1440],
    );
    expect((await screen.findByRole("status")).textContent).toBe("Meeting reminders saved.");
  });

  it("can save no reminders at all", async () => {
    mocks.updateMeetingReminderDefault.mockResolvedValue({});
    form({ minutes: [60] });

    fireEvent.click(toggle("1 hour before"));
    expect(screen.getByText("No reminders")).toBeTruthy();
    fireEvent.click(save());

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.updateMeetingReminderDefault).toHaveBeenCalledExactlyOnceWith("org_1", []);
  });

  it("shows what went wrong and does not refresh", async () => {
    mocks.updateMeetingReminderDefault.mockResolvedValue({ error: "Use at most 8 reminders." });
    form();

    fireEvent.click(toggle("1 week before"));
    fireEvent.click(save());

    expect((await screen.findByRole("status")).textContent).toBe("Use at most 8 reminders.");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("is read-only for someone who cannot change settings", () => {
    form({ canEdit: false });

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    for (const button of screen.getAllByRole("button")) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });
});
