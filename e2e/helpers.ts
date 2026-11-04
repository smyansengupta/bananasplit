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
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

/** Where the dev mail sink writes messages (src/server/email/transport.ts). */
const MAIL_DIR = path.join(process.cwd(), ".data", "mail");

/**
 * The token from the newest email sent to `email` that links to
 * `/<route>/<token>`, read from the dev mail sink. Jobs send right after the
 * request that queued them, so this waits for it to appear. Requires the
 * sink: RESEND_API_KEY empty and EMAIL_DELIVERY unset or "sink".
 */
async function readMailedToken(
  email: string,
  route: "verify-email" | "reset-password",
  timeoutMs: number,
): Promise<string> {
  const address = email.trim().toLowerCase();
  const link = new RegExp(`/${route}/([A-Za-z0-9_-]{20,200})`);
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
      const match = link.exec(message.text ?? "");
      if (match) return match[1]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `No ${route} email for ${email} in ${MAIL_DIR}. The e2e run needs the dev mail sink (RESEND_API_KEY empty).`,
  );
}

/** The token from the newest verification email sent to `email`. */
export function readVerificationToken(email: string, timeoutMs = 30_000): Promise<string> {
  return readMailedToken(email, "verify-email", timeoutMs);
}

/** The token from the newest password reset email sent to `email`. */
export function readPasswordResetToken(email: string, timeoutMs = 30_000): Promise<string> {
  return readMailedToken(email, "reset-password", timeoutMs);
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
  await page.getByRole("heading", { name: /Email confirmed/ }).waitFor();
  await page.getByRole("link", { name: /^(Continue|Log in)$/ }).click();
}

/**
 * "Your profile" (onboarding Flow A, five steps): step 1 with what sign-up
 * already filled in (it makes the Personal space), then "Finish later" from
 * step 2, which opens the Personal dashboard; the skipped steps wait there.
 * Then "join" goes on to /onboarding/join (invite code, and any emailed
 * invites with a Join button), "create" to B1, /onboarding/organization.
 */
export async function completeProfileSetup(page: Page, next: "join" | "create"): Promise<void> {
  await page.waitForURL(/\/onboarding\/profile\/basics/);
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await page.waitForURL(/\/onboarding\/profile\/school$/);
  await page.getByRole("button", { name: "Finish later" }).click();
  // Personal's home (docs/features/personal-and-clubs.md).
  await page.waitForURL(/\/app\/me-[a-z0-9]+$/);
  // "Start an organization" is a link on Personal's home; joining is a code field
  // there, so the join flow opens its page (where emailed invites list too).
  if (next === "join") await page.goto("/onboarding/join");
  else await page.getByRole("main").getByRole("link", { name: "Start an organization" }).click();
  await page.waitForURL(next === "join" ? /\/onboarding\/join/ : /\/onboarding\/organization$/);
}

/**
 * After joining a club (a code, an invite link or an emailed invite): the
 * one small club step, "Your role in <club>". Picks `role` when given, then
 * goes into the club.
 */
export async function chooseClubRole(page: Page, orgSlug: string, role?: string): Promise<void> {
  await page.waitForURL(new RegExp(`/onboarding/join/${orgSlug}$`));
  if (role) await page.getByRole("button", { name: role, exact: true }).click();
  await page.getByRole("button", { name: /^Go to / }).click();
  await page.waitForURL(new RegExp(`/app/${orgSlug}$`));
}

/**
 * Org setup (onboarding Flow B) with the defaults: name the club, keep the
 * suggested labels, finance, starter teams and pulse, invite no one, skip the
 * connections, and land on the new club's home as its OWNER. Returns the slug.
 */
export async function createOrgViaOnboarding(page: Page, orgName: string): Promise<string> {
  if (!/\/onboarding\/organization$/.test(new URL(page.url()).pathname))
    await page.goto("/onboarding/organization");
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/onboarding\/organization\/[^/]+\/labels$/);
  const slug = new URL(page.url()).pathname.split("/")[3]!;
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/finance$/);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/teams$/);
  await page.getByRole("button", { name: "Continue" }).click();
  // The weekly pulse, with its defaults (Fridays at 5 PM, to everyone).
  await page.waitForURL(/\/pulse$/);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/invite$/);
  await page.getByRole("button", { name: "Continue" }).click();
  // Connecting tools is optional: the club's data is stored in Bananasplit either way.
  await page.waitForURL(/\/data$/);
  await page.getByRole("button", { name: "Continue" }).click();
  // A new club starts its 30-day trial with everything (Society), so the
  // flows under test have the whole club; its home is the Overview.
  await page.waitForURL(new RegExp(`/app/${slug}(\\?welcome=1)?$`));
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
  await page.getByRole("button", { name: "Log in" }).click();
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
