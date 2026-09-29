import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResendState } from "@/app/verify-email/actions";

/**
 * The "check your email" notice an unverified account lands on after
 * sign-in: it says the address isn't verified, names it, and the resend
 * button reports each outcome of the action.
 */

const { resendMock } = vi.hoisted(() => ({ resendMock: vi.fn() }));
vi.mock("@/app/verify-email/actions", () => ({ resendVerificationEmailAction: resendMock }));

const { VerifyEmailNotice } = await import("./verify-email-notice");

function show() {
  render(
    <VerifyEmailNotice
      email="verify-test@example.edu"
      action="create an organization or accept an invite"
    />,
  );
}

async function resend(result: ResendState) {
  resendMock.mockResolvedValueOnce(result);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
  });
}

beforeEach(() => {
  resendMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("VerifyEmailNotice", () => {
  it("says the address isn't verified and names it", () => {
    show();
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Check your email");
    expect(notice.textContent).toContain("Your email address isn't verified yet.");
    expect(notice.textContent).toContain("verify-test@example.edu");
    expect(notice.textContent).toContain(
      "Verify your address to create an organization or accept an invite.",
    );
  });

  it("confirms a resend", async () => {
    show();
    await resend({ sent: true });
    expect(resendMock).toHaveBeenCalledOnce();
    expect(screen.getByText(/A new link is on its way/)).toBeTruthy();
  });

  it("shows the rate-limit message", async () => {
    show();
    await resend({ error: "Too many verification emails requested. Try again in 12 minutes." });
    expect(
      screen.getByText("Too many verification emails requested. Try again in 12 minutes."),
    ).toBeTruthy();
    expect(screen.queryByText(/A new link is on its way/)).toBeNull();
  });

  it("says when the address was verified in the meantime", async () => {
    show();
    await resend({ verified: true });
    expect(screen.getByText(/already verified/)).toBeTruthy();
  });
});
