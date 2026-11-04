import { expect, test } from "@playwright/test";

import { createOrgViaOnboarding, makeUser, signUpVerified, uniqueSuffix } from "./helpers";

// Club-made databases (docs/features/databases.md): a new club makes a
// database from a template with nothing connected, types into it (each cell
// saves itself), reloads to find it all there, adds a field, and imports a
// spreadsheet as a second database. Real UI, dev server, Postgres.
test("a club makes its own database, and it saves as you type", async ({ page }) => {
  const owner = makeUser("Archivist");
  const suffix = uniqueSuffix();
  await signUpVerified(page, owner, "create");
  const orgSlug = await createOrgViaOnboarding(page, `E2E Databases ${suffix}`);

  await page.goto(`/app/${orgSlug}/databases`);
  // Nothing to connect first: the club's own databases are right here.
  await expect(
    page.getByText(/only your organization can see|no other organization can see/i).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "New database" }).first().click();
  await page.getByRole("radio", { name: /Equipment/ }).click();
  await page.getByRole("button", { name: "Create database" }).click();
  await expect(page).toHaveURL(/\/databases\/equipment$/);

  await page.getByRole("button", { name: "New row" }).first().click();
  const row = page.locator("tbody tr").first();
  await row.locator("[data-primary] [data-cell-input]").fill("Soldering iron");
  await row.getByLabel(/^Quantity for/).fill("3");
  await row.getByLabel(/^Quantity for/).press("Enter");
  await row.getByLabel(/^Status for/).click();
  await page.getByRole("option", { name: "Checked out" }).click();
  await expect(page.getByRole("status").first()).toHaveText("All changes saved");

  await page.getByRole("button", { name: "Add a field" }).click();
  await page.getByLabel("Field name").fill("Serial number");
  await page.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByRole("button", { name: /^Serial number \(Text\) options/ })).toBeVisible();

  await page.reload();
  const saved = page.locator("tbody tr").first();
  await expect(saved.locator("[data-primary] [data-cell-input]")).toHaveValue("Soldering iron");
  await expect(saved.getByLabel(/^Quantity for/)).toHaveValue("3");
  await expect(saved.getByLabel(/^Status for/)).toHaveText("Checked out");

  await page.goto(`/app/${orgSlug}/databases`);
  await page.getByRole("button", { name: "New database" }).first().click();
  await page.getByRole("button", { name: "Import a spreadsheet" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "dues.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,Paid,Amount\nAva,yes,$20.00\nBen,no,$20.00\nCam,yes,$15.00\n"),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page).toHaveURL(/\/databases\/dues$/);
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /^Paid \(Checkbox\) options/ })).toBeVisible();
});
