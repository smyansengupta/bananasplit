import { expect, test } from "@playwright/test";

import { dayButtonName, makeUser, signIn, signOut, signUp, uniqueSuffix } from "./helpers";

// Spec 6.5, flow (a): sign in -> create org -> invite member -> create/drag
// task -> write/share note -> create poll -> respond -> finalize into event
// -> download .ics. Exercises the whole app through the real UI against a
// real dev server and Postgres — nothing here is mocked.
test("full workspace workflow", async ({ page }) => {
  const owner = makeUser("Owner");
  const member = makeUser("Member");
  const orgName = `E2E Robotics ${uniqueSuffix()}`;

  await signUp(page, owner);
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByLabel("Organization name").fill(orgName);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/app\/[^/]+$/);
  const orgSlug = new URL(page.url()).pathname.split("/")[2];

  // --- invite a member and have them join ---
  await page.goto(`/app/${orgSlug}/settings/invitations`);
  await page.getByLabel("Email").fill(member.email);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invite sent.")).toBeVisible();

  await signOut(page);
  await signUp(page, member);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${orgSlug}$`));

  await signOut(page);
  await signIn(page, owner);

  // --- create a task, then drag it to a different status column ---
  await page.goto(`/app/${orgSlug}/tasks`);
  const taskTitle = `E2E task ${uniqueSuffix()}`;
  await page.getByRole("button", { name: "Add task to Not started" }).click();
  await page.getByLabel("Title").fill(taskTitle);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  const card = page.getByRole("button", { name: new RegExp(taskTitle) });
  await expect(card).toBeVisible();
  const targetColumn = page.getByTestId("kanban-column-IN_PROGRESS");

  // dnd-kit's PointerSensor needs real intermediate pointermove events (past
  // its 8px activation distance) to register the drag and run collision
  // detection — a single-step locator.dragTo() isn't reliable for it.
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) throw new Error("Could not measure drag source/target");
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(columnBox.x + columnBox.width / 2, cardBox.y, { steps: 10 });
  await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + 30, { steps: 10 });
  await page.mouse.up();

  await expect(targetColumn.getByText(taskTitle)).toBeVisible();

  // --- write and share a note ---
  await page.goto(`/app/${orgSlug}/notes`);
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${orgSlug}/notes/`));
  const noteTitle = `E2E note ${uniqueSuffix()}`;
  await page.getByPlaceholder("Untitled note").fill(noteTitle);
  await page.locator(".tiptap, [contenteditable='true']").first().click();
  await page.keyboard.type("Meeting notes body text.");
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await expect(page.getByText(/Saved|Saving/)).toBeVisible();

  // --- create an availability poll, respond, and finalize into an event ---
  await page.goto(`/app/${orgSlug}/calendar/polls/new`);
  const pollTitle = `E2E poll ${uniqueSuffix()}`;
  await page.getByLabel("Title").fill(pollTitle);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dayAfter = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  await page.getByRole("button", { name: dayButtonName(tomorrow) }).click();
  await page.getByRole("button", { name: dayButtonName(dayAfter) }).click();
  await page.getByRole("button", { name: "Create poll" }).click();
  await expect(page).toHaveURL(/\/calendar\/polls\/[a-z0-9]+$/);

  // The redirect from "Create poll" briefly leaves the previous page's own
  // <table> (the date-picker calendar) in the DOM before the poll page's
  // response grid mounts — wait for a marker unique to the response grid so
  // "table button" below can't resolve to the wrong page's table.
  await page.getByText("Mark as:").waitFor();
  const firstSlotButton = page.locator("table button").first();
  await firstSlotButton.click();
  await expect(page.getByText(/1 responded/)).toBeVisible();

  await page.getByRole("button", { name: "Finalize" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/${orgSlug}/calendar/`));

  // --- download the .ics for the finalized event ---
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /Download \.ics/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.ics$/);
});
