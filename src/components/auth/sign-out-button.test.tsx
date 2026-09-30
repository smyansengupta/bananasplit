import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sign-out button on pages with no user menu (onboarding): it signs
 * out to the landing page, holds while that runs, and can be pressed again
 * if it fails.
 */

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));
vi.mock("next-auth/react", () => ({ signOut: signOutMock }));

const { SignOutButton } = await import("./sign-out-button");

function button() {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Sign out" });
}

beforeEach(() => {
  signOutMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SignOutButton", () => {
  it("signs out to the landing page and holds while it runs", async () => {
    signOutMock.mockReturnValue(new Promise(() => {}));
    render(<SignOutButton />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/" });
    expect(button().disabled).toBe(true);
  });

  it("can be pressed again when signing out fails", async () => {
    signOutMock.mockRejectedValueOnce(new Error("offline"));
    render(<SignOutButton />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().disabled).toBe(false);
  });
});
