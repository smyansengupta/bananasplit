import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Ask a question": what the form asks for before it sends, how it fills
 * option rows (Enter adds one, a pasted list fills several), and what it
 * sends.
 */

const { createMock, pushMock } = vi.hoisted(() => ({ createMock: vi.fn(), pushMock: vi.fn() }));

vi.mock("@/app/app/[orgSlug]/calendar/polls/question-actions", () => ({
  createQuestionPoll: createMock,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The settings' switches measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { QuestionPollForm } = await import("./question-poll-form");

const option = (n: number) => screen.getByRole("textbox", { name: `Option ${n}` });
const submit = () => screen.getByRole("button", { name: "Create poll" }) as HTMLButtonElement;

beforeEach(() => {
  createMock.mockResolvedValue({ pollId: "qp_new" });
  render(<QuestionPollForm orgId="org_1" orgSlug="cbc" />);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QuestionPollForm", () => {
  it("asks for a question and two different options before it sends", () => {
    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Write your question to continue.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Pizza or tacos?" } });
    fireEvent.change(option(1), { target: { value: "Pizza" } });
    expect(screen.getByText("Add at least two options.")).toBeTruthy();
    fireEvent.change(option(2), { target: { value: " PIZZA " } });
    expect(screen.getByText("Already an option.")).toBeTruthy();
    expect(option(2).getAttribute("aria-invalid")).toBe("true");
    expect(submit().disabled).toBe(true);
    fireEvent.change(option(2), { target: { value: "Tacos" } });
    expect(submit().disabled).toBe(false);
  });

  it("adds a row on Enter in the last option, and fills rows from a pasted list", () => {
    fireEvent.change(option(1), { target: { value: "Pizza" } });
    fireEvent.change(option(2), { target: { value: "Tacos" } });
    fireEvent.keyDown(option(2), { key: "Enter" });
    expect(option(3)).toBeTruthy();

    fireEvent.paste(option(3), {
      clipboardData: { getData: () => "- Sushi\n2. Burgers\n\n  Dumplings  " },
    });
    expect((option(3) as HTMLInputElement).value).toBe("Sushi");
    expect((option(4) as HTMLInputElement).value).toBe("Burgers");
    expect((option(5) as HTMLInputElement).value).toBe("Dumplings");
  });

  it("sends the poll with its settings and opens it", async () => {
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Where to?" } });
    fireEvent.change(option(1), { target: { value: "Park" } });
    fireEvent.change(option(2), { target: { value: "Bowling" } });
    fireEvent.click(screen.getByRole("switch", { name: "Anonymous voting" }));
    fireEvent.click(screen.getByRole("switch", { name: "Allow more than one choice" }));
    fireEvent.click(screen.getByRole("radio", { name: "1 day" }));
    expect(screen.getByText(/^Closes .+, your time\./)).toBeTruthy();

    await act(async () => {
      fireEvent.click(submit());
    });
    expect(createMock).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({
        question: "Where to?",
        description: null,
        options: ["Park", "Bowling"],
        multiple: true,
        anonymous: true,
        allowMemberOptions: false,
        hideResultsUntilClosed: false,
        closesAt: expect.any(String),
      }),
    );
    const closesAt = new Date(createMock.mock.calls[0][1].closesAt).getTime();
    expect(closesAt - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(pushMock).toHaveBeenCalledWith("/app/cbc/calendar/polls/qp_new");
  });

  it("shows the server's refusal", async () => {
    createMock.mockResolvedValue({ error: "Each option must be different." });
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Q" } });
    fireEvent.change(option(1), { target: { value: "A" } });
    fireEvent.change(option(2), { target: { value: "B" } });
    await act(async () => {
      fireEvent.click(submit());
    });
    expect(screen.getByRole("alert").textContent).toBe("Each option must be different.");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
