import "dotenv/config";

import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { createOrgViaOnboarding, makeUser, signUpVerified, uniqueSuffix } from "./helpers";

// Meetings (docs/features/meetings.md): the three ways to start a meeting
// from the Meetings page (Online, In person, Event), what each one leaves on
// the meeting's page and in the list, and who gets to see the join link on a
// sign-up page. Real UI, dev server, Postgres.
//
// A meeting made at a provider (Zoom, Meet, Teams) is not covered here: that
// would need a fake provider inside the dev server, and the conference-sync
// job is tested against mocked HTTP (src/server/conference/sync.db.test.ts).
// The Video calls bar test relies on this environment having no provider
// credentials, and skips itself when a client id is set (see the end).
//
// To run it (the database comes from `.env`, which the dev server loads):
//
//   PLAYWRIGHT_CHANNEL=chrome AUTH_REQUIRE_EMAIL_VERIFICATION=true \
//     pnpm test:e2e e2e/meetings.spec.ts
//
// - AUTH_REQUIRE_EMAIL_VERIFICATION=true: local development otherwise treats
//   every new address as confirmed and sends no mail, and `signUpVerified`
//   reads the confirmation link from the dev mail sink (.data/mail).
// - PLAYWRIGHT_CHANNEL=chrome: use the installed Google Chrome when
//   Playwright's own Chromium has not been downloaded.
test.describe.configure({ mode: "serial", timeout: 120_000 });

/**
 * The first visit to a page compiles it in the dev server, which can take
 * longer than an assertion's default five seconds.
 */
const COLD = { timeout: 45_000 };

const PASTED_LINK = "https://example.com/call/abc";
const EVENT_LINK = "https://example.com/call/event";

let context: BrowserContext;
let page: Page;
let orgSlug = "";
const suffix = uniqueSuffix();

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  context = await browser.newContext();
  page = await context.newPage();
  await signUpVerified(page, makeUser("Meetings Host"), "create");
  orgSlug = await createOrgViaOnboarding(page, `E2E Meetings ${suffix}`);
});

test.afterAll(async () => {
  await context?.close();
});

/** Meetings, with New meeting open: the one create form, with nothing chosen. */
async function openNewMeeting() {
  await page.goto(`/app/${orgSlug}/meetings`);
  // The empty page repeats the button, quietly; the header's is the first.
  await page.getByRole("button", { name: "New meeting" }).first().click();
  const dialog = page.getByRole("dialog");
  // The form is fetched when first asked for, and on a cold dev server the
  // click can land before the page is hydrated.
  await expect(dialog.getByRole("heading", { name: "New meeting" })).toBeVisible(COLD);
  return dialog;
}

/** Video call > "A link I'll paste", then the link. */
async function pasteCall(dialog: Locator, link: string) {
  await dialog.getByRole("button", { name: /^Video call/ }).click();
  await page.getByRole("menuitem", { name: "A link I'll paste" }).click();
  await dialog.getByLabel("Meeting link").fill(link);
}

/** A meeting's card on the Meetings list, found by its title link. */
function cardOf(on: Page, title: string) {
  return on.getByRole("listitem").filter({
    has: on.getByRole("link", { name: title, exact: true }),
  });
}

test("Online: a pasted link is the meeting's join link, on its page and in the list", async () => {
  const title = `E2E Online ${suffix}`;
  const dialog = await openNewMeeting();

  await dialog.getByRole("radio", { name: "Online" }).click();
  await dialog.getByLabel("Title").fill(title);
  // Online asks for the call, not a place.
  await expect(dialog.getByLabel("Location")).toHaveCount(0);
  await pasteCall(dialog, PASTED_LINK);
  await dialog.getByRole("button", { name: "Create meeting", exact: true }).click();

  // A create from Meetings lands on the meeting's own page.
  await expect(page).toHaveURL(new RegExp(`/app/${orgSlug}/meetings/[^/]+$`), COLD);
  await expect(page.getByRole("heading", { name: title })).toBeVisible(COLD);
  // The join card is a labelled section ("<provider> meeting"; a pasted link is
  // "Online"). This is the control for the In person test's "no such section".
  await expect(page.getByRole("region", { name: "Online meeting" })).toBeVisible();
  const join = page.getByRole("link", { name: "Join meeting" });
  await expect(join).toBeVisible();
  await expect(join).toHaveAttribute("href", PASTED_LINK);
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();

  await page.goto(`/app/${orgSlug}/meetings`);
  const card = cardOf(page, title);
  await expect(card).toBeVisible();
  await expect(card.getByText("Online", { exact: true })).toBeVisible();
  // Named for its meeting ("Join {title}") so a list of them reads clearly.
  const cardJoin = card.getByRole("link", { name: /^Join/ });
  await expect(cardJoin).toHaveAttribute("href", PASTED_LINK);
});

test("In person: the place and how to find it, a map link, and no video call", async () => {
  const title = `E2E In person ${suffix}`;
  const dialog = await openNewMeeting();

  // In person is the form's own default; choosing it says so out loud.
  await dialog.getByRole("radio", { name: "In person" }).click();
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Location").fill("Room 101");
  await dialog.getByLabel("How to find it").fill("Second floor, left");
  // In person asks for a place, not a call.
  await expect(dialog.getByRole("button", { name: /^Video call/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Create meeting", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/app/${orgSlug}/meetings/[^/]+$`), COLD);
  await expect(page.getByRole("heading", { name: title })).toBeVisible(COLD);
  await expect(page.getByText("Room 101")).toBeVisible();
  await expect(page.getByText("Second floor, left")).toBeVisible();
  const maps = page.getByRole("link", { name: "Open in Maps" });
  await expect(maps).toBeVisible();
  await expect(maps).toHaveAttribute("href", /google\.com\/maps\/search\/.*Room%20101/);

  // No call was chosen, so the page has no video-call section and no Join
  // (the join card is a labelled section, "<provider> meeting"). It does
  // offer to add one later.
  await expect(page.getByRole("region", { name: /meeting$/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Join/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a video call" })).toBeVisible();

  await page.goto(`/app/${orgSlug}/meetings`);
  const card = cardOf(page, title);
  await expect(card.getByText("In person", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: /^Join/ })).toHaveCount(0);
});

test("Event: its sign-up page hides the join link until someone signs up", async ({ browser }) => {
  const title = `E2E Event ${suffix}`;
  const dialog = await openNewMeeting();

  await dialog.getByRole("radio", { name: "Event" }).click();
  await dialog.getByLabel("Title").fill(title);
  // An event asks for both a place and a call.
  await dialog.getByLabel(/^Location/).fill("Hall");
  await pasteCall(dialog, EVENT_LINK);
  await dialog.getByRole("button", { name: "Create meeting", exact: true }).click();

  // A new event goes on to its sign-up settings, where the public link is.
  await expect(page).toHaveURL(new RegExp(`/app/${orgSlug}/meetings/[^/]+/rsvp\\?new=1$`), COLD);
  const publicLink = page.getByRole("link", { name: /\/e\/[a-z0-9]{8}$/ });
  await expect(publicLink).toBeVisible(COLD);
  const link = await publicLink.getAttribute("href");
  expect(link).toBeTruthy();
  // The link is absolute on NEXT_PUBLIC_APP_URL; the test server may be on another port.
  const pagePath = new URL(link!).pathname;

  // A stranger, in a browser with no session.
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto(pagePath);
    await expect(guest.getByRole("heading", { name: title })).toBeVisible(COLD);
    await expect(guest.getByRole("button", { name: "Register" })).toBeVisible();
    // No link on the page, in what is shown or in what was sent.
    await expect(guest.getByRole("link", { name: /join/i })).toHaveCount(0);
    expect(await guest.content()).not.toContain(EVENT_LINK);

    await guest.getByLabel("Name").fill("Dana Guest");
    await guest.getByLabel("Email").fill(`dana-${suffix}@example.com`);
    await guest.getByLabel("Phone").fill("617-555-0142");
    await guest.getByRole("button", { name: "Register" }).click();
    await expect(guest.getByRole("heading", { name: /You're going/ })).toBeVisible();

    // Signed up: now it is theirs.
    const join = guest.getByRole("link", { name: "Join the meeting" });
    await expect(join).toBeVisible();
    await expect(join).toHaveAttribute("href", EVENT_LINK);
  } finally {
    await guestContext.close();
  }
});

test("Video calls: with no provider set up, none can be connected", async () => {
  // With a provider's OAuth client configured, the bar offers Connect, by
  // design. The dev server reads `.env` (documented place for these ids) and
  // so does this file (`dotenv/config` above), as well as the shell, so the
  // guard sees what the server sees. Next also reads `.env.local` and
  // `.env.development*`, which the runner does not: an id kept only there
  // is not seen here.
  test.skip(
    Boolean(
      process.env.GOOGLE_MEET_CLIENT_ID ||
      process.env.ZOOM_CLIENT_ID ||
      process.env.MICROSOFT_TEAMS_CLIENT_ID,
    ),
    "provider OAuth clients are configured in this environment",
  );
  await page.goto(`/app/${orgSlug}/meetings`);
  // The e2e environment has no Google Meet, Zoom or Teams client, so the bar
  // is one honest line, with nothing to press, rather than three Connect buttons.
  const bar = page.locator("section").filter({
    has: page.getByText("Video calls", { exact: true }),
  });
  await expect(bar).toContainText("aren't switched on for Bananasplit yet");
  await expect(bar).toContainText("paste a link into any meeting");
  await expect(page.getByRole("button", { name: /Connect|Reconnect/ })).toHaveCount(0);
  for (const label of ["Google Meet", "Zoom", "Teams"]) {
    await expect(bar.getByRole("button", { name: new RegExp(label) })).toHaveCount(0);
  }
});
