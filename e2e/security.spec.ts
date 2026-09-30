import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  createOrgViaOnboarding,
  dayButtonName,
  makeUser,
  signUp,
  signUpVerified,
  uniqueSuffix,
} from "./helpers";

/**
 * The 0A security fixes through the real UI: the CSP scope and zero
 * violations, the public poll (guests, same names, a signed-in non-member,
 * members-only finalize), the calendar feed's regenerate-to-view, and the
 * member role rules. Each test builds its own org.
 */

async function createOrg(page: Page, label: string): Promise<string> {
  await signUpVerified(page, makeUser(label), "create");
  return createOrgViaOnboarding(page, `E2E ${label} ${uniqueSuffix()}`);
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

/** The nonce attribute of every <script> the server rendered. */
function scriptNonces(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>/g)].map(
    (match) => match[0].match(/\snonce="([^"]*)"/)?.[1] ?? "",
  );
}

test("CSP: nonce policy on the app and auth pages, static policy elsewhere, no violations", async ({
  page,
}) => {
  const violations = await watchCsp(page);

  const home = await page.goto("/");
  const homePolicy = home?.headers()["content-security-policy"] ?? "";
  expect(homePolicy).toContain("script-src 'self' 'unsafe-inline'");
  expect(homePolicy).not.toContain("nonce-");

  for (const path of ["/sign-in", "/sign-up", "/poll/does-not-exist", "/invite/not-a-token"]) {
    const response = await page.goto(path);
    const policy = response?.headers()["content-security-policy"] ?? "";
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce, path).toBeTruthy();
    const nonces = scriptNonces((await response?.text()) ?? "");
    expect(nonces.length, path).toBeGreaterThan(0);
    expect(new Set(nonces), path).toEqual(new Set([nonce]));
  }

  const orgSlug = await createOrg(page, "CSP Owner");
  for (const path of [
    `/app/${orgSlug}`,
    `/app/${orgSlug}/tasks`,
    `/app/${orgSlug}/calendar`,
    `/app/${orgSlug}/notes`,
    `/app/${orgSlug}/finance`,
    `/app/${orgSlug}/settings`,
    `/app/${orgSlug}/settings/members`,
    `/app/${orgSlug}/settings/calendar`,
  ]) {
    const response = await page.goto(path);
    expect(response?.headers()["content-security-policy"], path).toMatch(/'nonce-[^']+'/);
    await page.waitForLoadState("networkidle");
    expect(await violations(), path).toEqual([]);
  }
});

/** A separate browser session (its own cookies) on the test server. */
async function newGuest(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  return { context, page: await context.newPage() };
}

test("public poll: guests keep separate answers, non-members answer as guests, only members attend", async ({
  page,
  browser,
  baseURL,
}) => {
  const orgSlug = await createOrg(page, "Poll Owner");

  await page.goto(`/app/${orgSlug}/calendar/polls/new`);
  await page.getByLabel("Title").fill(`E2E guest poll ${uniqueSuffix()}`);
  await page
    .getByRole("button", { name: dayButtonName(new Date(Date.now() + 24 * 60 * 60 * 1000)) })
    .click();
  await page.getByRole("button", { name: "Create poll" }).click();
  // Not /polls/new itself: wait for the created poll's page.
  await expect(page).toHaveURL(/\/calendar\/polls\/(?!new$)[a-z0-9]+$/);
  await page.getByRole("grid", { name: "Your availability" }).waitFor();
  const pollId = new URL(page.url()).pathname.split("/").pop()!;

  // The public page, as an anonymous visitor sees it, carries no emails
  // (the stripped DTO).
  const anonymous = await newGuest(browser, baseURL);
  const publicHtml = await (await anonymous.page.request.get(`/poll/${pollId}`)).text();
  expect(publicHtml).toContain("Your name");
  expect(publicHtml).not.toMatch(/@example\.com/);
  await anonymous.context.close();

  const firstCell = (p: Page, grid = "Your availability") =>
    p.getByRole("grid", { name: grid }).locator('[data-cell="0:0"]');

  // Two guests type the same name: two respondents, neither erases the other.
  // Reloading shows what the server kept, not the page's own copy.
  for (const [index, name] of ["Alex", "Alex"].entries()) {
    const guest = await newGuest(browser, baseURL);
    await guest.page.goto(`/poll/${pollId}`);
    await guest.page.getByLabel("Your name").fill(name);
    await firstCell(guest.page).click();
    await expect(guest.page.getByText("Saved", { exact: true })).toBeVisible();
    await guest.page.reload();
    await expect(guest.page.getByText(`${index + 1} responded`)).toBeVisible();
    await guest.context.close();
  }

  // A signed-in user from another org answers as a guest, never as themselves.
  const outsider = await newGuest(browser, baseURL);
  await signUp(outsider.page, makeUser("Outsider"));
  await outsider.page.waitForURL(/\/onboarding/);
  await outsider.page.goto(`/poll/${pollId}`);
  await expect(outsider.page.getByText(/not a member of the organization/)).toBeVisible();
  await outsider.page.getByLabel("Your name").fill("Outsider");
  await firstCell(outsider.page).click();
  await expect(outsider.page.getByText("Saved", { exact: true })).toBeVisible();
  await outsider.page.reload();
  await expect(outsider.page.getByText("3 responded")).toBeVisible();
  await outsider.context.close();

  await page.goto(`/app/${orgSlug}/calendar/polls/${pollId}`);
  await page.getByRole("tab", { name: /Everyone/ }).click();
  await expect(firstCell(page, "Everyone's availability")).toHaveAttribute(
    "aria-label",
    /Available: Alex, Alex \(2\), Outsider\./,
  );
  await page.getByRole("tab", { name: "Your availability" }).click();
  await firstCell(page).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("4 responded")).toBeVisible();

  // Nobody marked a whole hour, so schedule from the time itself.
  await page.getByRole("tab", { name: /Everyone/ }).click();
  await firstCell(page, "Everyone's availability").click();
  await page.getByRole("button", { name: "Schedule at this time" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/3 guests can make it but can't be invited/)).toBeVisible();
  await dialog.getByRole("button", { name: "Schedule" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${orgSlug}/calendar/(?!polls)[a-z0-9]+$`));
  // Only the member (the owner) became an attendee.
  await expect(page.getByText("Invited (1)")).toBeVisible();
});

test("calendar feed: the link is shown once, and regenerating kills the old one", async ({
  page,
}) => {
  const orgSlug = await createOrg(page, "Feed Owner");
  await page.goto(`/app/${orgSlug}/settings/calendar`);

  await page.getByRole("button", { name: "Create link" }).click();
  const first = await page.getByLabel("Calendar feed URL").inputValue();
  expect(first).toMatch(/^https?:\/\/[^/]+\/api\/calendar\/feed\/[A-Za-z0-9_-]+$/);
  const firstPath = new URL(first).pathname;
  expect((await page.request.get(firstPath)).status()).toBe(200);

  // Never shown again after a reload.
  await page.reload();
  await expect(page.locator("#main-content").getByText(/Feed active since/)).toBeVisible();
  await expect(page.getByLabel("Calendar feed URL")).toHaveCount(0);

  await page.getByRole("button", { name: "Regenerate link" }).click();
  const second = await page.getByLabel("Calendar feed URL").inputValue();
  expect(second).not.toBe(first);
  await expect(page.getByText(/previous feed link has stopped working/)).toBeVisible();
  expect((await page.request.get(firstPath)).status()).toBe(404);
  expect((await page.request.get(new URL(second).pathname)).status()).toBe(200);
});

test("member roles: an admin is never offered OWNER and cannot touch an owner", async ({
  page,
  browser,
  baseURL,
}) => {
  const orgSlug = await createOrg(page, "Roles Owner");
  const admin = makeUser("Roles Admin");

  await page.goto(`/app/${orgSlug}/settings/members`);
  await page.getByLabel("Email").fill(admin.email);
  await page.locator("#invite-role").click();
  await page.getByRole("option", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invite sent.")).toBeVisible();

  const adminSession = await newGuest(browser, baseURL);
  await signUpVerified(adminSession.page, admin);
  await adminSession.page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(adminSession.page).toHaveURL(new RegExp(`/app/${orgSlug}$`));

  await adminSession.page.goto(`/app/${orgSlug}/settings/members`);
  await expect(adminSession.page.getByText("Only an owner can change an owner.")).toBeVisible();
  await expect(adminSession.page.getByRole("combobox", { name: /Role for/ })).toHaveCount(0);
  await adminSession.context.close();

  // The owner manages the admin, and the dropdown offers OWNER to owners only.
  await page.goto(`/app/${orgSlug}/settings/members`);
  await page.getByRole("combobox", { name: /Role for/ }).click();
  await expect(page.getByRole("option", { name: "Owner" })).toBeVisible();
});
