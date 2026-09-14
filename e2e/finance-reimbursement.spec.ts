import { expect, test } from "@playwright/test";

import { makeUser, signIn, signOut, signUp, uniqueSuffix } from "./helpers";

// Spec 6.5, flow (b): member submits an expense with a receipt -> treasurer
// (here, the org owner, who also carries finance access) approves -> marks
// reimbursed -> the dashboard balance and the submitter's "owed to you" both
// update. Real UI, real dev server, real Postgres.
test("expense reimbursement lifecycle", async ({ page }) => {
  const owner = makeUser("Treasurer");
  const member = makeUser("Submitter");
  const orgName = `E2E Finance ${uniqueSuffix()}`;
  const expenseDescription = `E2E pizza run ${uniqueSuffix()}`;

  await signUp(page, owner);
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/app\/[^/]+$/);
  const orgSlug = new URL(page.url()).pathname.split("/")[2];

  await page.goto(`/app/${orgSlug}/finance/budget`);
  await page.getByRole("button", { name: "New period" }).click();
  await page.getByPlaceholder("Label, e.g. FY 2026–27").fill("E2E fiscal year");
  const endsOn = new Date();
  endsOn.setFullYear(endsOn.getFullYear() + 1);
  await page.locator("input[type='date']").nth(1).fill(endsOn.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Create and activate" }).click();
  await expect(page.getByText("E2E fiscal year")).toBeVisible();

  await page.goto(`/app/${orgSlug}/settings/invitations`);
  await page.getByLabel("Email").fill(member.email);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invite sent.")).toBeVisible();

  await signOut(page);
  await signUp(page, member);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${orgSlug}$`));

  // Baseline: nothing owed yet.
  await page.goto(`/app/${orgSlug}`);
  await expect(page.getByText("Money owed to you", { exact: true }).locator("..").first()).toContainText("$0.00");

  // --- member submits an expense with a receipt ---
  await page.goto(`/app/${orgSlug}/finance/my-reimbursements`);
  await page.getByRole("button", { name: "New transaction" }).click();
  await page.getByLabel("Description").fill(expenseDescription);
  await page.getByLabel("Amount").fill("42.50");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByText(expenseDescription).click();
  await page.getByRole("tab", { name: /Receipts/ }).click();
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  await page.getByRole("button", { name: "Upload receipt" }).click();
  await page
    .locator("input[type='file']")
    .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: pngBytes });
  await expect(page.getByText("receipt.png")).toBeVisible();

  await page.getByRole("tab", { name: "Details" }).click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("dialog").getByText("Submitted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).first().click();

  await page.goto(`/app/${orgSlug}`);
  await expect(page.getByText("Money owed to you", { exact: true }).locator("..").first()).toContainText("$42.50");

  // --- owner (finance access) approves, then marks reimbursed ---
  // /finance redirects non-finance roles to my-reimbursements, so the
  // Balance card is only visible from the owner/treasurer's session.
  await signOut(page);
  await signIn(page, owner);
  await page.goto(`/app/${orgSlug}/finance`);
  await expect(page.getByText("Balance", { exact: true }).locator("..").first()).toContainText("-$42.50");

  await page.goto(`/app/${orgSlug}/finance/transactions`);
  await page.getByText(expenseDescription).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("dialog").getByText("Approved", { exact: true })).toBeVisible();

  await page.getByPlaceholder("Reimbursement method").fill("Venmo");
  await page.getByRole("button", { name: "Mark reimbursed" }).click();
  await expect(page.getByRole("dialog").getByText("Reimbursed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).first().click();

  // Reimbursement doesn't touch the ledger balance — the expense already
  // counted against it the moment it was created.
  await page.goto(`/app/${orgSlug}/finance`);
  await expect(page.getByText("Balance", { exact: true }).locator("..").first()).toContainText("-$42.50");

  // --- the submitter's "owed to you" clears back to zero ---
  await signOut(page);
  await signIn(page, member);
  await page.goto(`/app/${orgSlug}`);
  await expect(page.getByText("Money owed to you", { exact: true }).locator("..").first()).toContainText("$0.00");
});
