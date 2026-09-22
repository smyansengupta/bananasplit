import { createHash, randomBytes } from "node:crypto";

import type { Page } from "@playwright/test";
import "dotenv/config";
import pg from "pg";

export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

export function makeUser(label: string): TestUser {
  const suffix = uniqueSuffix();
  return {
    name: `E2E ${label}`,
    email: `e2e-${label.toLowerCase().replace(/\s+/g, "-")}-${suffix}@example.com`,
    password: "correct-horse-battery-staple",
  };
}

export async function signUp(page: Page, user: TestUser): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

/**
 * Verifies a signed-up user's email the way the emailed link does (0A Fix
 * 4(b)): a token whose sha256 sits in VerificationToken, opened at
 * /verify-email/<token> and confirmed with the button. The test mints the
 * token itself because there is no inbox to read; the page and the
 * consumption code are the real ones. Writes through the identity role
 * (DATABASE_URL_AUTH), falling back to DATABASE_URL.
 */
export async function verifyEmail(page: Page, email: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL_AUTH || process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    // TIMESTAMP(3) columns hold UTC wall time (as Prisma writes them).
    await client.query(
      `INSERT INTO "VerificationToken" ("identifier", "token", "expires")
       VALUES ($1, $2, (now() AT TIME ZONE 'UTC') + interval '1 hour')`,
      [email.trim().toLowerCase(), createHash("sha256").update(token).digest("hex")],
    );
  } finally {
    await client.end();
  }
  await page.goto(`/verify-email/${token}`);
  await page.getByRole("button", { name: "Confirm my email" }).click();
}

/** Sign up, then verify the address: the state every org-level flow needs. */
export async function signUpVerified(page: Page, user: TestUser): Promise<void> {
  await signUp(page, user);
  await page.waitForURL(/\/onboarding/);
  await verifyEmail(page, user.email);
  await page.waitForURL(/\/onboarding/);
}

export async function signIn(page: Page, user: Pick<TestUser, "email" | "password">): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The credentials sign-in server action redirects to /app once the session
  // cookie is set — wait for that before navigating again, or a subsequent
  // goto() can race the redirect and land pre-auth.
  await page.waitForURL(/\/app/);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Open user menu/i }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  // next-auth's client signOut() does its own fetch + redirect — wait for
  // that navigation to fully land before driving the page again, or a
  // subsequent goto() races it and gets aborted.
  await page.waitForURL("/");
}

/** Matches the accessible name react-day-picker gives each day button. */
export function dayButtonName(date: Date): RegExp {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
  const day = date.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return new RegExp(`${weekday}, ${month} ${day}${suffix}`);
}
