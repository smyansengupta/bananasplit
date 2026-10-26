import { expect, test } from "@playwright/test";

import { createOrgViaOnboarding, makeUser, signUpVerified, uniqueSuffix } from "./helpers";

// RSVP pages (docs/features/rsvp.md): a host makes an event with a public
// page and caps it at two spots; three guests sign up in their own
// browsers, the third onto the waitlist; the host checks one in, cancels
// another, and the waitlisted guest moves up. Real UI, dev server, Postgres.
test("RSVP page: create, sign up, waitlist, check in and move up", async ({ page, browser }) => {
  const host = makeUser("Host");
  const suffix = uniqueSuffix();
  const title = `E2E Robot night ${suffix}`;

  await signUpVerified(page, host, "create");
  const orgSlug = await createOrgViaOnboarding(page, `E2E RSVP ${suffix}`);

  await page.goto(`/app/${orgSlug}/calendar`);
  await page.getByRole("button", { name: "New event" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Location").fill("Engineering Hall 112, 1 Main St");
  await dialog.getByRole("switch", { name: /Take RSVPs with a public page/ }).click();
  await dialog.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(page).toHaveURL(/\/meetings\/[^/]+\/rsvp/);
  await expect(page.getByRole("heading", { name: "RSVP page" })).toBeVisible();

  await page.getByRole("button", { name: "Page settings" }).click();
  await page.getByRole("switch", { name: "Limit spots" }).click();
  await page.getByLabel("Number of spots").fill("2");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("RSVP page saved")).toBeVisible();

  const link = await page.getByRole("link", { name: /\/e\/[a-z0-9]{8}$/ }).getAttribute("href");
  expect(link).toBeTruthy();
  // The link is absolute on NEXT_PUBLIC_APP_URL; the test server may be on another port.
  const pagePath = new URL(link!).pathname;

  const guests = ["Ava Guest", "Ben Guest", "Cam Guest"];
  for (const [i, name] of guests.entries()) {
    const context = await browser.newContext();
    const guest = await context.newPage();
    await guest.goto(pagePath);
    await expect(guest.getByRole("heading", { name: title })).toBeVisible();
    await guest.getByLabel("Name").fill(name);
    await guest.getByLabel("Email").fill(`guest${i}-${suffix}@example.com`);
    await guest.getByLabel("Phone").fill(`617-555-01${10 + i}`);
    await guest.getByRole("button", { name: i < 2 ? "Register" : "Join the waitlist" }).click();
    await expect(
      guest.getByRole("heading", { name: i < 2 ? /You're going/ : "You're on the waitlist" }),
    ).toBeVisible();
    await context.close();
  }

  await page.reload();
  await expect(page.getByRole("button", { name: "Guests (3)" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Ava Guest checked in" }).click();
  await expect(page.getByRole("checkbox", { name: "Ava Guest checked in" })).toBeChecked();

  await page.getByRole("button", { name: "Actions for Ben Guest" }).click();
  await page.getByRole("menuitem", { name: "Cancel spot" }).click();
  await expect(page.getByText("Ben Guest's spot was cancelled")).toBeVisible();
  await expect(page.getByRole("row", { name: /Cam Guest/ })).toContainText("Going");
});
