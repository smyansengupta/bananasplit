import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { signIn, signOut, uniqueSuffix } from "./helpers";

// Phase 6 (tasks + email), against the seeded Claude Builders Club: Oliver
// (VP Ops & Programs) hands a task down to Alex (Head of Programs); Alex gets
// the assignment email (read from the dev mail sink), follows its link while
// signed out, signs in through the callbackUrl and lands on the task.
// Needs the seed (pnpm db:seed) and the mail sink (RESEND_API_KEY empty).

const ORG = "claude-builders-club";
const SEED_PASSWORD = "password123";
const oliver = { email: "oliver@example.edu", password: SEED_PASSWORD };
const alex = { email: "alex@example.edu", password: SEED_PASSWORD };
const MAIL_DIR = path.join(process.cwd(), ".data", "mail");

async function readTaskLink(to: string, title: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let names: string[] = [];
    try {
      names = (await readdir(MAIL_DIR)).filter((n) => n.endsWith(".json")).sort().reverse().slice(0, 50);
    } catch {
      names = [];
    }
    for (const name of names) {
      let message: { to?: string; subject?: string; text?: string };
      try {
        message = JSON.parse(await readFile(path.join(MAIL_DIR, name), "utf8"));
      } catch {
        continue;
      }
      if (message.to !== to || !message.subject?.includes(title)) continue;
      const match = new RegExp(`(/app/${ORG}/tasks/[A-Za-z0-9_-]+)`).exec(message.text ?? "");
      if (match) return match[1]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No assignment email to ${to} for "${title}" in ${MAIL_DIR}.`);
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("a handed-down task emails a deep link that survives sign-in", async ({ page }) => {
  const title = `E2E hand-down ${uniqueSuffix()}`;

  await signIn(page, oliver);
  await page.goto(`/app/${ORG}/tasks?view=board`);
  await page.getByRole("button", { name: "Add a task to Not started" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Owner").click();
  await page.getByRole("option", { name: /Alex Green/ }).click();
  await page.getByLabel("Due date").fill(inDays(14));
  await page.getByRole("button", { name: "Save" }).click();
  // (The owner popover is also a role=dialog while it animates out.)
  await expect(page.getByRole("dialog", { name: "New task" })).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();

  const link = await readTaskLink(alex.email, title);
  await signOut(page);

  // Signed out, the link goes through sign-in and comes back to the task.
  await page.goto(link);
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=/);
  await page.getByLabel("Email").fill(alex.email);
  await page.getByLabel("Password").fill(alex.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(new RegExp(`${link}$`));
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Created by")).toBeVisible();

  // Alex owns it now; clean up.
  await page.getByRole("button", { name: "Delete" }).click();
  await page.waitForURL(new RegExp(`/app/${ORG}/tasks$`));
});
