import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CheckoutForm, type CheckoutFormProps } from "./checkout-form";

/**
 * Checkout before billing exists: the seat stepper prices a standard order
 * (per member a month, billed yearly), a school address gets the flat
 * student price, and Subscribe only says payments aren't connected. The card fields stand in
 * for Stripe's Payment Element, so none of them may ever be submitted.
 */

const props: CheckoutFormProps = {
  plan: "society",
  clubName: "Robotics Club",
  initialMembers: 2,
  email: "maya@westfield.com",
  schoolEmail: false,
  backHref: "/app/robotics/settings/plan",
  backLabel: "Bananasplit, back to your plan",
  renews: { standard: "Oct 27, 2027", year: "Aug 25, 2027", semester: "Jan 12, 2027" },
};

afterEach(() => {
  cleanup();
});

describe("CheckoutForm", () => {
  it("prices the seats at the standard price, yearly, and never goes below one member", () => {
    render(<CheckoutForm {...props} />);
    expect(screen.getByRole("heading", { name: "Subscribe to Team Advanced" })).toBeTruthy();
    // $16 × 12 × 2 members.
    expect(screen.getAllByText("$384.00")).toHaveLength(4);
    expect(screen.queryByRole("group", { name: "Price" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More members" }));
    expect(screen.getAllByText("$576.00")).toHaveLength(4);

    for (let i = 0; i < 5; i++)
      fireEvent.click(screen.getByRole("button", { name: "Fewer members" }));
    expect(screen.getAllByText("$192.00")).toHaveLength(4);
    expect(screen.getByText(/Renews Oct 27, 2027/)).toBeTruthy();
  });

  it("prices Team (?plan=club) at $8 a member a month, with thousands separators", () => {
    render(<CheckoutForm {...props} plan="club" initialMembers={300} />);
    expect(screen.getByRole("heading", { name: "Subscribe to Team" })).toBeTruthy();
    expect(screen.getByText("Team · Robotics Club")).toBeTruthy();
    expect(screen.getAllByText("$28,800.00")).toHaveLength(4);
  });

  it("gives a school address the flat student price, by the year or the semester", () => {
    render(<CheckoutForm {...props} plan="club" initialMembers={40} schoolEmail />);
    expect(screen.getAllByText("$199.00")).toHaveLength(4);
    expect(screen.getByText(/Renews Aug 25, 2027 for the next academic year/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Semester" }));
    expect(screen.getAllByText("$119.00")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    expect(screen.getAllByText("$3,840.00")).toHaveLength(4);
  });

  it("uses the standard price once a student organization passes the member cap", () => {
    render(<CheckoutForm {...props} plan="club" initialMembers={101} schoolEmail />);
    expect(screen.getAllByText("$9,696.00")).toHaveLength(4);
    expect(screen.getByText(/Student pricing covers up to 100 members/)).toBeTruthy();
  });

  it("charges Personal Plus in full with a school address: there is no student price", () => {
    render(<CheckoutForm {...props} plan="plus" schoolEmail />);
    expect(screen.getAllByText("$72.00")).toHaveLength(3);
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("sells Personal Plus yearly by default, or monthly, with no seats", () => {
    render(<CheckoutForm {...props} plan="plus" />);
    expect(screen.getByRole("heading", { name: "Subscribe to Personal Plus" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More members" })).toBeNull();
    expect(screen.getAllByText("$72.00")).toHaveLength(3);
    expect(screen.getByText(/Yearly saves \$24\.00/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getAllByText("$8.00")).toHaveLength(3);
    expect(screen.queryByText("$72.00")).toBeNull();
  });

  it("does not submit: Subscribe says card payments aren't connected", () => {
    render(<CheckoutForm {...props} />);
    // The seat count is an <output> (a status too); the notice is the <p>.
    const status = screen.getAllByRole("status").find((el) => el.tagName === "P");
    expect(status?.textContent).toBe("");

    const submit = new Event("submit", { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("form", { name: "Pay with card" }), submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(status?.textContent).toBe("Card payments aren't connected yet, so nothing was charged.");
  });

  it("gives the card fields no names and labels every field", () => {
    const { container } = render(<CheckoutForm {...props} />);
    for (const field of container.querySelectorAll("input, select")) {
      expect(field.getAttribute("name")).toBeNull();
    }
    for (const name of [
      "Email",
      "Card number",
      "Expiration date (MM / YY)",
      "Security code (CVC)",
      "Cardholder name",
      "Country or region",
      "ZIP",
    ]) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
    expect(screen.getByRole("group", { name: "Card information" })).toBeTruthy();
  });
});
