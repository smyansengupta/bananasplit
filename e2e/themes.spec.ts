import "dotenv/config";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import pg from "pg";

/**
 * Phase 8 (Themes) through the real UI, on the seeded fixture orgs (Debate
 * Society: eve OWNER, dave ADMIN, grace MEMBER; Robotics Club: alice OWNER,
 * with a seeded availability poll). Sessions are minted with AUTH_SECRET
 * (no password typing). Every test resets the theme it changed, so the
 * fixture orgs end on the default theme.
 *
 * Covers: a preset restyles the app (tokens on <html>, a portaled menu),
 * the org default mode vs a member's stored choice, the lock, the member
 * view of Settings > Theme, the themed public poll page, and no CSP
 * violation with the theme <style> present.
 */

const HARBOR_LIGHT_PRIMARY = "#1d4ed8";
const HARBOR_DARK_BACKGROUND = "#0b1220";
const EVERGREEN_LIGHT_PRIMARY = "#1f6b43";

function db(): pg.Client {
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("themes.spec needs MIGRATE_DATABASE_URL or DATABASE_URL");
  return new pg.Client({ connectionString: url });
}

async function query<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = db();
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** A signed-in context for a seeded user, via a minted Auth.js session cookie. */
async function signedIn(
  browser: Browser,
  baseURL: string,
  email: string,
  options: { colorScheme?: "light" | "dark"; storedTheme?: string } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const [user] = await query<{ id: string; name: string | null }>(
    `SELECT id, name FROM "User" WHERE email = $1`,
    [email],
  );
  if (!user) throw new Error(`seed user ${email} missing: run pnpm db:seed`);
  const token = await encode({
    token: { sub: user.id, id: user.id, name: user.name, email },
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
  });
  const context = await browser.newContext({
    baseURL,
    colorScheme: options.colorScheme ?? "light",
  });
  await context.addCookies([
    { name: "authjs.session-token", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" },
  ]);
  if (options.storedTheme) {
    const stored = options.storedTheme;
    await context.addInitScript((value) => localStorage.setItem("theme", value), stored);
  }
  return { context, page: await context.newPage() };
}

/** Records securitypolicyviolation events from the first script onward. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      w.__csp.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? []);
}

function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim(),
    name,
  );
}

function isDark(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.classList.contains("dark"));
}

async function openTheme(page: Page, slug: string): Promise<void> {
  await page.goto(`/app/${slug}/settings/theme`);
  await expect(page.getByRole("heading", { name: "Theme", level: 1 })).toBeVisible();
}

async function save(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save theme" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
}

async function resetTheme(page: Page, slug: string): Promise<void> {
  await openTheme(page, slug);
  const reset = page.getByRole("button", { name: "Reset to default" });
  if (await reset.isDisabled()) return;
  await reset.click();
  await page.getByRole("button", { name: "Reset theme" }).click();
  await expect(page.getByRole("status")).toContainText("Reset to the default theme");
}

test("a preset restyles the whole app, portals included, with no CSP violation", async ({
  browser,
  baseURL,
}) => {
  const admin = await signedIn(browser, baseURL!, "dave@example.edu");
  const violations = await watchCsp(admin.page);
  try {
    await resetTheme(admin.page, "debate-society");
    await openTheme(admin.page, "debate-society");
    // next-themes' inline script ran under the nonce: it set the class and color-scheme.
    expect(await admin.page.evaluate(() => document.documentElement.style.colorScheme)).toBe(
      "light",
    );

    await admin.page.getByText("Harbor", { exact: true }).click();
    await save(admin.page);
    await expect.poll(() => token(admin.page, "primary")).toBe(HARBOR_LIGHT_PRIMARY);

    // A fresh load renders the org <style> on the server.
    await admin.page.goto("/app/debate-society/calendar");
    expect(await admin.page.locator("style[data-org-theme]").count()).toBe(1);
    expect(await token(admin.page, "primary")).toBe(HARBOR_LIGHT_PRIMARY);
    // FullCalendar reads the tokens.
    const fcButton = admin.page.locator(".fc .fc-button-primary").first();
    await expect(fcButton).toHaveCSS("background-color", "rgb(29, 78, 216)");

    // A Radix portal on <body> picks up the theme.
    await admin.page.getByRole("button", { name: /Open user menu/ }).click();
    const menu = admin.page.getByRole("menu");
    await expect(menu).toBeVisible();
    const popover = await token(admin.page, "popover");
    const menuBg = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(menuBg).toBe(
      await admin.page.evaluate((hex) => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = hex;
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      }, popover),
    );
    await admin.page.keyboard.press("Escape");

    for (const path of ["/app/debate-society", "/app/debate-society/tasks", "/sign-in"]) {
      await admin.page.goto(path);
    }
    expect(await violations()).toEqual([]);
  } finally {
    await resetTheme(admin.page, "debate-society");
    await admin.context.close();
  }
});

test("the org mode applies only without a stored choice, and the lock forces it", async ({
  browser,
  baseURL,
}) => {
  const admin = await signedIn(browser, baseURL!, "dave@example.edu");
  try {
    await resetTheme(admin.page, "debate-society");
    await admin.page.getByText("Harbor", { exact: true }).click();
    await admin.page.getByRole("radio", { name: /^Dark/ }).check();
    await save(admin.page);

    // No stored choice, light device: the org default (dark) applies.
    const fresh = await signedIn(browser, baseURL!, "grace@example.edu");
    await fresh.page.goto("/app/debate-society");
    expect(await isDark(fresh.page)).toBe(true);
    expect(await token(fresh.page, "background")).toBe(HARBOR_DARK_BACKGROUND);
    await fresh.context.close();

    // A member's own choice wins while the mode is not locked.
    const chooser = await signedIn(browser, baseURL!, "grace@example.edu", {
      storedTheme: "light",
    });
    await chooser.page.goto("/app/debate-society");
    expect(await isDark(chooser.page)).toBe(false);

    // Locked: dark for everyone, and the user menu says so.
    await admin.page.getByRole("switch", { name: "Lock the mode for everyone" }).click();
    await save(admin.page);
    await chooser.page.reload();
    expect(await isDark(chooser.page)).toBe(true);
    await chooser.page.getByRole("button", { name: /Open user menu/ }).click();
    await expect(chooser.page.getByText("Theme (set by your organization)")).toBeVisible();
    await expect(chooser.page.getByRole("menuitemradio", { name: "Light" })).toBeDisabled();

    // Members cannot manage the theme.
    await chooser.page.goto("/app/debate-society/settings/theme");
    await expect(chooser.page.getByText("Only owners and admins can manage this.")).toBeVisible();
    await chooser.context.close();
  } finally {
    await resetTheme(admin.page, "debate-society");
    await admin.context.close();
  }
});

test("the public poll page wears the org theme and logo header", async ({ browser, baseURL }) => {
  const [poll] = await query<{ id: string }>(
    `SELECT p.id FROM "AvailabilityPoll" p JOIN "Organization" o ON o.id = p."organizationId"
      WHERE o.slug = 'robotics-club' LIMIT 1`,
  );
  test.skip(!poll, "the seed has no Robotics Club poll");

  const owner = await signedIn(browser, baseURL!, "alice@example.edu");
  try {
    await resetTheme(owner.page, "robotics-club");
    await owner.page.getByText("Evergreen", { exact: true }).click();
    await owner.page.getByRole("radio", { name: /^Light/ }).check();
    await save(owner.page);

    const guest = await browser.newContext({ baseURL, colorScheme: "dark" });
    const page = await guest.newPage();
    const violations = await watchCsp(page);
    await page.goto(`/poll/${poll!.id}`);
    await expect(page.locator("header")).toContainText("Robotics Club");
    expect(await token(page, "primary")).toBe(EVERGREEN_LIGHT_PRIMARY);
    expect(await isDark(page)).toBe(false); // the org default beats the device for a first visit
    await page.goto("/invite/not-a-real-token");
    expect(await page.locator("header").count()).toBe(0);
    expect(await violations()).toEqual([]);
    await guest.close();
  } finally {
    await resetTheme(owner.page, "robotics-club");
    await owner.context.close();
  }
});
