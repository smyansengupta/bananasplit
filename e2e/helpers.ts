import { randomInt } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

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

/**
 * A fresh client address for each sign-up. Sign-up is limited per client IP
 * (5 an hour, src/app/sign-up/actions.ts) and a full run signs up more
 * people than that from one machine. Off Vercel the app takes the client IP
 * from x-real-ip (src/lib/request-ip.ts); 198.18.0.0/15 is the benchmarking
 * range, never a real client.
 */
function testClientIp(): string {
  return `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}

export async function signUp(page: Page, user: TestUser): Promise<void> {
  await page.context().setExtraHTTPHeaders({ "x-real-ip": testClientIp() });
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

/** Where the dev mail sink writes messages (src/server/email/transport.ts). */
const MAIL_DIR = path.join(process.cwd(), ".data", "mail");

/**
 * The token from the newest verification email sent to `email`, read from
 * the dev mail sink. The verify-email job sends it right after sign-up (or
 * after "Send a new link"), so this waits for it to appear. Requires the
 * sink: RESEND_API_KEY empty and EMAIL_DELIVERY unset or "sink".
 */
export async function readVerificationToken(email: string, timeoutMs = 30_000): Promise<string> {
  const address = email.trim().toLowerCase();
  // Sink files are named by ISO timestamp; only look at the last 10 minutes.
  const oldest = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace(/[:.]/g, "-");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let names: string[] = [];
    try {
      names = (await readdir(MAIL_DIR))
        .filter((name) => name.endsWith(".json") && name >= oldest)
        .sort()
        .reverse();
    } catch {
      names = [];
    }
    for (const name of names) {
      let message: { to?: string; text?: string };
      try {
        message = JSON.parse(await readFile(path.join(MAIL_DIR, name), "utf8"));
      } catch {
        continue; // still being written
      }
      if (message.to?.trim().toLowerCase() !== address) continue;
      const match = /\/verify-email\/([A-Za-z0-9_-]{20,200})/.exec(message.text ?? "");
      if (match) return match[1]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `No verification email for ${email} in ${MAIL_DIR}. The e2e run needs the dev mail sink (RESEND_API_KEY empty).`,
  );
}

/**
 * Verifies a signed-up user's email the way a person does (0A Fix 4(b)):
 * reads the link the verify-email job sent (from the dev mail sink), opens
 * /verify-email/<token>, presses the button, then continues into the app
 * (signed-in callers land on /app, which routes onward).
 */
export async function verifyEmail(page: Page, email: string): Promise<void> {
  const token = await readVerificationToken(email);
  await page.goto(`/verify-email/${token}`);
  await page.getByRole("button", { name: "Confirm email" }).click();
  await page.getByText("Email confirmed").waitFor();
  await page.getByRole("link", { name: /^(Continue|Sign in)$/ }).click();
}

/**
 * Profile setup (onboarding Flow A): Continue through the six steps with
 * what sign-up already filled in, then A7's choice. "join" lands on
 * /onboarding/join (invite code, and any emailed invites with a Join
 * button); "create" on B1, /onboarding/organization.
 */
export async function completeProfileSetup(page: Page, next: "join" | "create"): Promise<void> {
  await page.waitForURL(/\/onboarding\/profile\/basics/);
  for (const step of ["school", "bio", "theme", "availability", "review"]) {
    await page.getByRole("button", { name: /^(Continue|Use .+)$/ }).click();
    await page.waitForURL(new RegExp(`/onboarding/profile/${step}$`));
  }
  await page
    .getByRole("button", {
      name: next === "join" ? "Join with invite code" : "Create an organization",
    })
    .click();
  await page.waitForURL(next === "join" ? /\/onboarding\/join/ : /\/onboarding\/organization$/);
}

/**
 * Org setup (onboarding Flow B) with the defaults: name the org, skip the
 * connections, keep the labels, finance and starter teams, and land on the
 * new org's home as its OWNER. Returns the org's slug.
 */
export async function createOrgViaOnboarding(page: Page, orgName: string): Promise<string> {
  if (!/\/onboarding\/organization$/.test(new URL(page.url()).pathname))
    await page.goto("/onboarding/organization");
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/onboarding\/organization\/[^/]+\/data$/);
  const slug = new URL(page.url()).pathname.split("/")[3]!;
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.waitForURL(/\/labels$/);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/finance$/);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/teams$/);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL(new RegExp(`/app/${slug}\\?welcome=1$`));
  return slug;
}

/**
 * Sign up, verify the address and finish profile setup: the state every
 * org-level flow needs. Ends on /onboarding/join ("join", the default) or
 * on B1 ("create").
 */
export async function signUpVerified(
  page: Page,
  user: TestUser,
  next: "join" | "create" = "join",
): Promise<void> {
  await signUp(page, user);
  await page.waitForURL(/\/onboarding/);
  await verifyEmail(page, user.email);
  await completeProfileSetup(page, next);
}

export async function signIn(
  page: Page,
  user: Pick<TestUser, "email" | "password">,
): Promise<void> {
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
