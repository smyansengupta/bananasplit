# Meetings: the remaining phases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish what the meetings spec describes but `main` (7aaac51) does not do yet: the provider loose ends, a meeting's own page, real reminders for members and guests, and the one shape-first create flow.

**Architecture:** A meeting stays an `Event`. The provider work is in `src/server/conference/`. The meeting's own page reuses `EventDetailView` with a Meetings context. Reminders generalise the existing `rsvp-fanout` / `rsvp-email` jobs to any list of offsets and to members, with `EventReminderSend` as the once-only guard. The create flow is the existing `EventFormDialog` with a shape choice in front of it.

**Tech Stack:** Next.js (App Router; read `node_modules/next/dist/docs/` before writing route or page code, per AGENTS.md), Prisma + Postgres with RLS, zod, the in-house job queue (`src/server/jobs`), Vitest (`unit` and `db` projects), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-meetings-design.md`. What was built against it is in `docs/features/meetings.md`, which describes reminders as done even though they are not; Task 13 corrects it.

## Global Constraints

- A meeting is an `Event`. There is no new meeting model.
- The provider meeting is made by the `conference-sync` job, never during the save. A provider being down must never lose the meeting someone typed.
- We only move or cancel a meeting **we** made (`conferenceManaged`). A pasted link is never touched.
- You connect providers in **Meetings**, not in Settings. No notice, error or link may send someone to Settings › Integrations for a meeting provider.
- A join URL is stored only if `isAllowedJoinUrl` passes (https, on a host that provider owns).
- The host link (`conferenceHostUrl`, Zoom's `start_url`) starts the meeting as host. Show it only to people with `events.write`. Never put it in a reminder, notification, email, ICS feed or public page.
- The public sign-up page shows the join link only to someone who signed up (already true; keep it).
- Reminders are **one system** for members and public guests: the RSVP fanout, generalised (spec E5).
- Reminder offsets must pass `app.reminder_offsets_ok`: at most **8**, each **1–40320** minutes, no duplicates. The org default is `OrgSettings.meetingReminderMinutes`, `[1440, 60]`.
- Wording: "organization" replaces "club" in the **Meetings section only** (its page, its components, the meeting page). The Calendar and the rest of the app keep their wording.
- The Calendar section (the grid) stays as it is.
- Migrations: write SQL by hand or with `prisma migrate diff`. `migrate dev` is blocked here. Any RLS or GRANT change needs a matching `prisma/rls/phases.mjs` row, and `pnpm test:rls` must stay green.
- Errors stored on rows or shown in the UI go through `sanitize`. No token or secret appears in any error, log, audit diff or UI.
- Lint only the files you changed (`pnpm exec eslint <files>`). Do not run `prettier --write` on existing files, because many are not prettier-clean on `main`. Format only the files you create.
- DB tests (`*.db.test.ts`) skip silently when Postgres is unreachable. Run them with `pnpm exec vitest run --project db <file> --reporter=verbose` and check the durations show they really ran. The worktree's `.env` points at a migrated, seeded database (`bananasplit_meetings_rem`).
- Do not modify `AGENTS.md`. Commit only your own files.

## Review Focus

1. **A meeting moved after its reminder went out** must remind again for the new time, exactly once per person per offset. The old time's queued fanout must send nothing. Task 8 owns this.
2. **A meeting saved before its provider was connected** (or left FAILED by an expired connection) must get its link once someone connects or reconnects. Task 1 owns this.
3. **Two refreshes racing a rotated refresh token** must not end in NEEDS_REAUTH while a valid token is stored. Task 2 owns this.
4. **Switching shape in the create form** (Online → In person) must not save a provider. Switching In person → Online must not save a location. Task 10 owns this.
5. **The host link must never reach someone without `events.write`.** That covers the meeting page, the Meetings list, member reminders and the ICS export. Tasks 4, 6 and 8 own this.

## Out of scope

These spec items are not about meetings, or are already done, so they are deliberately left out: F (tool capsule; built), G1–G3 (built), **G4** (a list of hidden Up next cards; only "show all" exists), **H3/H4** (weekly-update entry point, the Epics button), I and J (built). C6 is a decision, not code: the provider integration stays on the FREE `rsvp` feature, with no new gate.

---

## Phase 1 — Provider loose ends (spec B5–B8)

### Task 1: Connecting or reconnecting picks up waiting meetings

Today `completeConferenceConnect` only stores the secret. A meeting saved before its provider was connected stays without a link forever: `needsConferenceSync` skips it when the provider isn't connected. A meeting left FAILED by an expired grant is never retried, even though `sync.ts` and `reauth.ts` both promise that reconnecting queues the work again. Two messages also still send people to "Admin panel > Integrations".

**Files:**
- Create: `src/server/conference/requeue.ts`
- Modify: `src/server/conference/connect.ts` (call it after `setSecret`)
- Modify: `src/server/conference/reauth.ts` (link and body copy)
- Modify: `src/server/conference/sync.ts` (the NEEDS_REAUTH `why` copy)
- Test: `src/server/conference/requeue.db.test.ts`; update any assertion on the old copy in `src/server/conference/sync.db.test.ts`

**Interfaces:**
- Produces: `requeueWaitingMeetings(orgId: string, integration: IntegrationProvider, now?: Date): Promise<number>` and `export const REQUEUE_LIMIT = 500`.

- [ ] **Step 1: Write the failing tests** in `requeue.db.test.ts`, using `sync.db.test.ts`'s setup (org, events, `Job` rows). Each case seeds Zoom-provider events and calls `requeueWaitingMeetings(orgId, "ZOOM")`:
  - `requeues an online meeting saved before Zoom was connected`: future event, `conferenceProvider ZOOM`, `format ONLINE`, `conferenceUrl null`, `conferenceManaged false`, `conferenceSyncState NOT_APPLICABLE`. Expect the return to be `1`, the row `PENDING`, and one `Job` with `kind 'conference-sync'` and `dedupeKey 'conference-sync:{eventId}'`.
  - `requeues a FAILED meeting`: `conferenceSyncState FAILED`, `conferenceManaged true`, `conferenceManagedAt ZOOM`. It is requeued.
  - Each of these returns `0` and enqueues no job:
    - `leaves a pasted link alone`: `conferenceUrl` set, `conferenceManaged false`.
    - `skips past meetings`: `endsAt` before `now`.
    - `skips deleted and merged meetings`.
    - `skips in-person rows`.
    - `skips other providers`: a `MEET` event.
    - `stays inside the org`: a second org's Zoom event is untouched.
  - `does not touch updatedAt`: `updatedAt` before equals after.
- [ ] **Step 2: Run** `pnpm exec vitest run --project db src/server/conference/requeue.db.test.ts --reporter=verbose`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `requeueWaitingMeetings`.**
  - Open one `withSystemOrgTx(orgId, …)`.
  - Select up to `REQUEUE_LIMIT` ids, ordered by `startsAt` ascending, where all of these hold:
    - the event is live (`deletedAt` and `mergedIntoId` null) and `endsAt > now`;
    - `conferenceProvider` = `providerOf(integration).conference` and `format <> IN_PERSON`;
    - either `conferenceSyncState = FAILED`, or `conferenceManaged = false AND conferenceUrl IS NULL`.
  - Mark them PENDING with raw SQL, as `afterSave` does (`src/server/events/service.ts`, the `UPDATE "Event" SET "conferenceSyncState" = 'PENDING'` statement), so `updatedAt` stays put.
  - Call `enqueueJob(db, { orgId, kind: "conference-sync", key: id, payload: { eventId: id } })` for each.
- [ ] **Step 4: Call it from `completeConferenceConnect`** right after `setSecret` succeeds. Wrap it in `try/catch` with `console.warn("[conference] requeue after connect failed: " + sanitize(error))`: a failed requeue must not turn a good connect into an error.
- [ ] **Step 5: Fix the copy.**
  - `reauth.ts`:
    - `linkUrl` → `/app/${slug}/meetings`;
    - body → `` `${label} stopped accepting the connection, so new online meetings are not being created there. An owner or admin can reconnect it from Meetings; meetings made meanwhile get their link once it is back.` ``
  - `sync.ts`: the NEEDS_REAUTH reason → `` `${def.label} needs to be reconnected from Meetings.` ``
- [ ] **Step 6: Run** the new test and `src/server/conference/sync.db.test.ts` (verbose). Expected: PASS, with real durations.
- [ ] **Step 7: Commit.** `git commit -m "Meetings: connecting a provider picks up the meetings waiting for it"`

### Task 2: Keep rotated refresh tokens

`getAccessToken` (`src/server/conference/token.ts`) throws away the `refresh_token` a refresh returns. Zoom issues a new refresh token on each refresh and Microsoft recommends replacing it. If the provider has invalidated the old one, the org drops to NEEDS_REAUTH an hour after connecting. `setSecret` cannot be reused here: it alerts every owner with SECURITY_ALERT ("was replaced") and resets the status, so calling it on every refresh would page owners hourly. This task also fills spec B8's gap: there are no cache or refresh tests for `token.ts`.

**Files:**
- Modify: `src/server/secrets/index.ts` (add `rotateSecret`)
- Modify: `src/server/conference/token.ts`
- Create: `src/server/conference/token.test.ts` (unit, with `vi.mock` of `@/server/secrets` and `./oauth`)
- Test: add a `rotateSecret` case to `src/server/integrations/integrations.db.test.ts`, the existing db suite for secrets (it needs `SECRETS_KEK_V1`, which the worktree `.env` has)

**Interfaces:**
- Produces: `rotateSecret(input: { orgId: string; provider: IntegrationProvider; kind: SecretKind; previous: string; value: string }): Promise<boolean>`. This is service path only, like `getSecret`: no actor, no permission check, never inside a transaction. It returns `true` when it replaced the secret. It returns `false` when the stored secret's fingerprint no longer matches `secretFingerprint(previous)`, which means someone else already rotated or reconnected.

- [ ] **Step 1: Write failing unit tests** in `token.test.ts`:
  - `caches the access token until a minute before it expires`: two calls make one `refreshTokens` call. With the clock advanced to 59 s before expiry, a third call refreshes.
  - `a different stored refresh token bypasses the cache`: `getSecret` returns a new value, so `refreshTokens` is called again.
  - `clearAccessToken forgets the cached token`.
  - `persists a rotated refresh token`: `refreshTokens` returns `refreshToken: "r2"` when the store held `"r1"`. Expect `rotateSecret({ previous: "r1", value: "r2", kind: "REFRESH_TOKEN", provider: "ZOOM", orgId })`.
  - `does not persist when the provider echoes the same token or none`.
  - `invalid_grant with an unchanged stored token throws ConferenceReauthError`.
  - `invalid_grant after someone else rotated retries once with the newer token`: `getSecret` returns "r1" then "r2". The first refresh with r1 rejects `invalid_grant` and the retry with r2 resolves. Expect the access token returned and no `ConferenceReauthError`.
  - `a failed rotateSecret does not fail the call`: it rejects, and the access token is still returned, with a `console.warn` that never includes the token value.
- [ ] **Step 2: Write the failing db test** `rotateSecret replaces only while the previous token is still stored`. Using the suite's setup:
  1. `setSecret` "r1".
  2. `rotateSecret(previous "r1", value "r2")` returns `true`. `getSecret` now returns "r2", and the status is unchanged (`CONNECTED`).
  3. No new `SECURITY_ALERT` notification exists.
  4. `rotateSecret(previous "r1", value "r3")` returns `false`, and "r2" is kept.
- [ ] **Step 3: Run both.** Expected: FAIL.
- [ ] **Step 4: Implement `rotateSecret`.**
  - Inside `withSystemOrgTx`, read the `OrgIntegration` row and lock it (`SELECT … FOR UPDATE` via `$queryRaw`).
  - Compare its `secretFingerprint` with `secretFingerprint(previous)`.
  - On a match, call `app.secret_write` exactly as `setSecret` does, then update `secretLast4` and `secretFingerprint` only. Leave `status`, `lastError` and `connectedById` alone.
  - Write no owner alert and no audit row: it is the provider's routine rotation, not a person's change. Add a comment saying so.
- [ ] **Step 5: Implement in `token.ts`.**
  - After a successful refresh, if `tokens.refreshToken` is set and differs from the one used, call `await rotateSecret(...)` inside a try/catch that warns via `sanitize`.
  - Cache under the **new** token's fingerprint.
  - On `invalid_grant`, re-read `getRefreshToken` once. If it differs from the token just used, retry the refresh once with it. Only if it does not differ, or the retry also says `invalid_grant`, throw `ConferenceReauthError`.
- [ ] **Step 6: Run both tests** (the db one verbose). Run `src/server/conference/clients.test.ts` and `oauth.test.ts` too. Expected: PASS.
- [ ] **Step 7: Commit.** `git commit -m "Meetings: keep the refresh token a provider rotates"`

### Task 3: Disconnect a provider

There is no way to disconnect a meeting provider (spec B7). Copy the shape of `disconnectGoogle` (`src/server/integrations/service.ts`), minus its revoke job.

**Files:**
- Create: `src/server/conference/disconnect.ts`
- Modify: `src/app/app/[orgSlug]/meetings/actions.ts` (a new action)
- Modify: `src/components/meetings/video-connections.tsx` (the button, and "Connected as …" per row)
- Test: `src/server/conference/disconnect.db.test.ts`

**Interfaces:**
- Consumes: `getRefreshToken`, `clearAccessToken` (`token.ts`); `revokeToken` (`oauth.ts`); `removeSecret` (`@/server/secrets`); `OrgActor` / `IntegrationResult` as `disconnectGoogle` uses them.
- Produces:
  - `disconnectMeetingProvider(orgId: string, actor: OrgActor, integration: IntegrationProvider): Promise<IntegrationResult>`;
  - the server action `disconnectMeetingProviderAction(orgId: string, provider: string): Promise<{ ok: boolean; message: string }>`, which rejects any `provider` not in `MEETING_INTEGRATIONS`.

- [ ] **Step 1: Write failing tests**, mocking `conferenceHttp.fetch` as `sync.db.test.ts` does:
  - `an owner disconnects: revoked at the provider, token deleted`: the status becomes `DISCONNECTED`, `config.disconnectedAt` is set, `getSecret` returns `null`, one `integration.disconnected` audit row exists, and the revoke URL was called. The message is `"Disconnected. Access was revoked at Zoom and the token deleted."`.
  - `an admin disconnects: token kept until an owner removes it`: `DISCONNECTED`, and the secret is still readable.
  - `a revoke that fails still disconnects`: the fetch returns 500, the status is still `DISCONNECTED`, the secret is kept, and the message is `"Disconnected. Remove Bananasplit from that Zoom account's connected apps to finish."`.
  - `members cannot disconnect`: a MEMBER actor throws the permission error.
  - `not connected`: no row gives `{ ok: false }` with `"Zoom is not connected."`.
  - `existing meetings keep their links`: a SYNCED Zoom event is unchanged after the disconnect.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `disconnectMeetingProvider`.**
  1. `requirePermission(actor, "integrations.write")`.
  2. Revoke inline as a best effort, with no transaction open: `getRefreshToken` → `revokeToken(def, token, AbortSignal.timeout(10_000))`.
  3. In one system transaction: set `DISCONNECTED`, merge `disconnectedAt` into the config, and write the audit row (`diff: { provider, revokedInline }`).
  4. Call `clearAccessToken`.
  5. Call `removeSecret` only when the revoke succeeded and `can(actor, "integrations.remove")`.
  6. Use the messages above, with `def.label` in place of Zoom.
- [ ] **Step 4: Add the action and the UI.**
  - The action follows the `run(...)` pattern in `settings/integrations/actions.ts`.
  - In `VideoConnections`, every connected or needs-reauth row shows "Connected as {accountEmail}" and a "Disconnect" button. The button confirms with `useConfirm`: title `Disconnect {label}?`, description `"Meetings already made keep their links. Changing or cancelling them won't reach {label} until you connect again."`.
  - Show the result message.
  - Then `router.refresh()`.
- [ ] **Step 5: Run the test** (verbose). Lint the changed files. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Meetings: disconnect a video-call provider"`

## Phase 2 — The meeting's own page (spec C2–C4, B6)

### Task 4: `/meetings/{id}`, with the join details and a retry

**Files:**
- Create: `src/lib/meetings/conference-status.ts` and `.test.ts`
- Create: `src/components/meetings/meeting-join-card.tsx` and `.test.tsx`
- Create: `src/app/app/[orgSlug]/meetings/[id]/page.tsx`
- Modify: `src/components/calendar/event-detail-view.tsx` (new optional props, below)
- Modify: `src/app/app/[orgSlug]/calendar/queries.ts`. Add the conference fields `getEventById` does not load yet: `format`, `conferenceManaged`, `conferenceHostUrl`, `conferencePasscode`, `conferenceDialIn`, `conferenceSyncState`, `conferenceSyncError`, `locationDetails`.
- Modify: `src/app/app/[orgSlug]/meetings/actions.ts` (`retryConferenceSync`)
- Test: `src/app/app/[orgSlug]/meetings/actions.db.test.ts`

**Interfaces:**
- Produces:
  - `type ConferenceStatus = { kind: "none" } | { kind: "ready" } | { kind: "pending"; line: string } | { kind: "failed"; line: string; reason: string | null }`.
  - `conferenceStatus(e: { conferenceProvider: ConferenceProvider; conferenceManaged: boolean; conferenceUrl: string | null; conferenceSyncState: CalendarSyncState; conferenceSyncError: string | null }, canEdit: boolean): ConferenceStatus`.
  - `retryConferenceSync(orgId: string, eventId: string): Promise<{ error?: string }>`.
  - `MeetingJoinCard` props: `{ orgId: string; eventId: string; providerLabel: string; joinUrl: string | null; hostUrl: string | null; passcode: string | null; dialIn: ConferenceDialIn[]; status: ConferenceStatus; canEdit: boolean }`. `hostUrl` is already `null` for anyone without `events.write`; the page enforces that.
  - New `EventDetailView` props, all optional so the Calendar's page is unchanged:
    - `section?: "calendar" | "meetings"` (default `"calendar"`): the back link (Calendar or Meetings), and where Delete returns to;
    - `joinCard?: ReactNode`: replaces the plain "Join meeting" button when given;
    - `locationDetails?: string | null` and `showMapLink?: boolean`: the Where fact gains "How to find it" and an "Open in Maps" link (`https://www.google.com/maps/search/?api=1&query=` + `encodeURIComponent(location)`).

- [ ] **Step 1: Write failing tests.**
  - `conference-status.test.ts`:
    - NONE gives `none`; a managed SYNCED meeting with a url gives `ready`; a pasted OTHER link gives `ready`.
    - PENDING gives `pending`, with line `"Getting the Zoom link…"`.
    - FAILED gives `failed`, line `"Couldn't make the Zoom meeting."`. `reason` is the stored error only when `canEdit`, else `null`.
  - `meeting-join-card.test.tsx`:
    - The Join link has the join URL, `target="_blank"` and `rel="noopener noreferrer"`.
    - "Copy link" calls `navigator.clipboard.writeText(joinUrl)`.
    - The passcode is shown with its own copy button, and the dial-in numbers are listed.
    - "Start as host" renders only when `hostUrl` is set.
    - A failed status shows the line, plus "Try again" for `canEdit` only; clicking it calls `retryConferenceSync`, which is mocked.
  - `actions.db.test.ts` for `retryConferenceSync`:
    - An admin retrying a FAILED Zoom event sets it PENDING and enqueues `conference-sync:{eventId}`.
    - A member gets `{ error }` and nothing changes.
    - An in-person event gets `{ error: "This meeting has no video call to make." }`.
    - A pasted OTHER link gets the same error.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `conferenceStatus`, `retryConferenceSync` and `MeetingJoinCard`.**
  - `conferenceStatus` labels providers with the Meetings page's `CONFERENCE_LABELS`; move it into `src/lib/meetings/conference-status.ts` and import it back.
  - `retryConferenceSync` uses `withOrgAction` and `requirePermission(ctx, "events.write")`. It sets PENDING with raw SQL and enqueues with `key: eventId`.
  - `MeetingJoinCard` is a client component, styled like the existing cards (`Card` and `Fact`). Copying shows `toast({ title: "Link copied" })`.
- [ ] **Step 4: Implement the page.**
  - `meetings/[id]/page.tsx` mirrors `calendar/[eventId]/page.tsx`: same loading, `canEdit = can({ role }, "events.write")`, and `startInEdit` from `?edit=1`.
  - It renders `EventDetailView` with `section="meetings"`, the `joinCard` (only when `conferenceProvider !== NONE`), `locationDetails`, and `showMapLink={Boolean(event.location)}`.
  - It passes `hostUrl: canEdit ? event.conferenceHostUrl : null`.
  - Parse `conferenceDialIn` defensively: an array of objects with string `number`; anything else becomes `[]`.
  - The detail view's existing Delete pushes to `/app/{slug}/meetings` when `section === "meetings"`.
- [ ] **Step 5: Run the tests** and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Meetings: each meeting gets its own page with the join details"`

### Task 5: Sign-up management moves into Meetings (spec C3)

**Files:**
- Move: `src/app/app/[orgSlug]/calendar/[eventId]/rsvp/page.tsx` → `src/app/app/[orgSlug]/meetings/[id]/rsvp/page.tsx`
- Move: `.../calendar/[eventId]/rsvp/door/page.tsx` → `.../meetings/[id]/rsvp/door/page.tsx`
- Leave `calendar/[eventId]/rsvp/actions.ts` where it is: many components import it, and moving it buys nothing.
- Create: redirect pages at the two old paths
- Modify: every internal link to `/calendar/{id}/rsvp`. Find them with `grep -rn 'calendar/\${[^}]*}/rsvp\|/rsvp/door' src`. They include at least:
  - `event-detail-view.tsx` (two links);
  - `event-form-dialog.tsx` (the `router.push` after `turnOnRsvpPage`);
  - `meetings/page.tsx` (`hrefOf`);
  - the `links` the RSVP manager page builds.
- Test: `src/app/app/[orgSlug]/calendar/[eventId]/rsvp/redirect.test.ts`

**Interfaces:**
- Consumes: `section` on `EventDetailView` (Task 4).
- Produces: `/app/{slug}/meetings/{id}/rsvp` (`?new=1` honoured, as before) and `/app/{slug}/meetings/{id}/rsvp/door`.

- [ ] **Step 1: Write the failing test.** With `next/navigation` mocked:
  - The old RSVP page redirects `{orgSlug: "acme", eventId: "e1"}` to `/app/acme/meetings/e1/rsvp`.
  - With `?new=1`, it goes to `/app/acme/meetings/e1/rsvp?new=1`.
  - The old door page redirects to `/app/acme/meetings/e1/rsvp/door`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Move the two pages with `git mv`.** Rename the param from `eventId` to `id`; `PageProps<"/app/[orgSlug]/meetings/[id]/rsvp">` gives the type. Update the manager's links:
  - `back` → `{ href: /app/{slug}/meetings/{id}, label: title }`;
  - `edit` → `/app/{slug}/meetings/{id}?edit=1`;
  - `door` → `/app/{slug}/meetings/{id}/rsvp/door`.
  - Non-editors redirect to `/app/{slug}/meetings/{id}`.
- [ ] **Step 4: Write the redirect pages at the old paths.** Repoint every internal link found by the grep.
- [ ] **Step 5: Check it.** Run the test, `pnpm typecheck`, and the grep again; expect no hits outside the two redirect pages. Update `e2e/rsvp.spec.ts` URLs if it asserts the old ones.
- [ ] **Step 6: Commit.** `git commit -m "Meetings: sign-ups are managed from the meeting, old links redirect"`

### Task 6: The Meetings list: shape, one-click join, copy (spec C2, D7)

Each card is a single `<Link>` today. That leaves nowhere for a Join button that does not navigate to the card, and it shows the shape only as a line of text.

**Files:**
- Create: `src/lib/meetings/shape.ts` (labels only here; Task 10 extends it)
- Create: `src/components/meetings/meeting-card.tsx` and `.test.tsx`. Extract the card from `meetings/page.tsx`.
- Modify: `src/app/app/[orgSlug]/meetings/page.tsx`
- Modify: the visible copy in `video-connections.tsx`, `conference-picker.tsx` and `meetings/page.tsx` ("club" → "organization", Meetings section only)

**Interfaces:**
- Produces:
  - `FORMAT_LABEL: Record<MeetingFormat, string>`, set to `{ ONLINE: "Online", IN_PERSON: "In person", HYBRID: "Hybrid" }`;
  - `MeetingCard` props: the page's `PageRow`, plus `orgSlug`, `canManage`, `status: ConferenceStatus` (Task 4) and `href: string`.

- [ ] **Step 1: Write failing tests** in `meeting-card.test.tsx`:
  - The title links to `/app/acme/meetings/e1`.
  - It shows a `FORMAT_LABEL` badge, plus a "Sign-ups" badge when `rsvpEnabled`.
  - An online card with a `conferenceUrl` has a "Join" link to it and a "Copy link" button that writes it to the clipboard.
  - There are no nested interactive elements: `container.querySelectorAll("a a, a button").length === 0`.
  - The host link is never rendered.
  - A failed status shows its line.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The card is a plain container. The title is the link; stretch it with an `after:absolute after:inset-0` overlay if the whole card should stay clickable. Join and Copy sit above that overlay (`relative z-10`).
  - `hrefOf` in the page points every card at `/app/{slug}/meetings/{id}`.
- [ ] **Step 4: Do the wording pass.** Grep `-i club` in the three files and change only user-visible strings. Comments may stay.
- [ ] **Step 5: Run the tests.** Lint the changed files. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Meetings: the list shows each meeting's shape, with join and copy on the card"`

## Phase 3 — Reminders (spec E1–E5)

### Task 7: Reminder offsets in the model layer

`Event.reminderMinutes`, `OrgSettings.meetingReminderMinutes` and `EventReminderSend` exist in the schema, but nothing reads or writes them.

**Files:**
- Create: `src/lib/meetings/reminders.ts` and `.test.ts`
- Modify: `src/server/events/service.ts`:
  - `eventFields` and `EVENT_SELECT` gain `reminderMinutes`;
  - `createEvent` defaults it.
- Modify: `src/app/app/[orgSlug]/calendar/actions.ts` (the form schema and `serviceFields` pass `reminderMinutes` through)
- Modify: `src/app/app/[orgSlug]/settings/general/actions.ts` (`updateMeetingReminderDefault`)
- Test: `src/server/events/reminders.db.test.ts`; add a case to `src/app/app/[orgSlug]/settings/general/actions.db.test.ts`

**Interfaces:**
- Produces, in `src/lib/meetings/reminders.ts`:
  - `MAX_REMINDERS = 8`, `MAX_REMINDER_MINUTES = 40320`, `DEFAULT_REMINDER_MINUTES = [1440, 60]`;
  - `REMINDER_CHOICES = [10080, 2880, 1440, 120, 60, 30, 10]`;
  - `reminderOffsetsSchema`: a zod array of ints 1–40320, at most 8, distinct, transformed to descending order;
  - `reminderLabel(minutes: number): string`;
  - `reminderLead(minutes: number): string`.
- Produces `updateMeetingReminderDefault(orgId: string, minutes: number[]): Promise<{ error?: string }>`, a `withOrgAction` gated on `settings.general.write`. It writes the audit row `settings.meeting_reminders_changed` with `diff: { from, to }`.
- Produces `EventInput.reminderMinutes?: number[]`, and the same on `EventPatch` and `EventFormInput`.

- [ ] **Step 1: Write the failing unit tests** in `reminders.test.ts`.
  - The schema:
    - `[60, 1440]` parses to `[1440, 60]`;
    - `[]` is accepted;
    - it rejects 9 entries, `0`, `40321`, `1.5` and `[60, 60]`.
  - `reminderLabel`:

    | minutes | label |
    |---|---|
    | 10 | "10 minutes before" |
    | 60 | "1 hour before" |
    | 120 | "2 hours before" |
    | 90 | "90 minutes before" |
    | 1440 | "1 day before" |
    | 2880 | "2 days before" |
    | 10080 | "1 week before" |

  - `reminderLead`:

    | minutes | lead |
    |---|---|
    | 10 | "in 10 minutes" |
    | 60 | "in an hour" |
    | 120 | "in 2 hours" |
    | 1440 | "tomorrow" |
    | 2880 | "in 2 days" |
    | 10080 | "in a week" |
    | 90 | "in 90 minutes" |

- [ ] **Step 2: Write the failing db tests.**
  - `createEvent without reminderMinutes takes the org default`.
  - `after updateMeetingReminderDefault([30]) a new event gets [30]`.
  - `an explicit [10] wins`.
  - `an invalid list is an EventValidationError`.
  - `updateEvent changes reminderMinutes`.
  - A MEMBER calling `updateMeetingReminderDefault` is refused.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - The service reads `OrgSettings.meetingReminderMinutes` in `createEvent` when the input has none. Fall back to `DEFAULT_REMINDER_MINUTES` when there is no settings row.
  - The calendar form schema accepts `reminderMinutes: z.array(z.number().int()).max(8).optional()`; the service validates it.
- [ ] **Step 5: Run the tests** (db verbose) and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Meetings: reminder offsets on each meeting, with an organization default"`

### Task 8: One reminder fanout for members and guests

**Files:**
- Create: `prisma/migrations/20261026120000_event_reminders/migration.sql`, containing `ALTER TYPE "NotificationType" ADD VALUE 'EVENT_REMINDER';` and nothing else
- Modify: `prisma/schema.prisma`. Add `EVENT_REMINDER` to `NotificationType`, then `pnpm exec prisma generate`.
- Modify: `src/lib/notifications/preferences.ts`. Add `EVENT_REMINDER: { label: "A reminder before a meeting I'm going to", group: "events" }`, plus any default map typecheck asks for.
- Modify: `src/server/jobs/registry.ts` (the `rsvp-fanout` and `rsvp-email` payloads and descriptions)
- Modify: `src/server/rsvp/service.ts`:
  - `scheduleEventReminders` replaces `scheduleRsvpReminders`;
  - delete `resetRsvpReminders`;
  - `enqueueRsvpEmails` options gain `offsetMinutes`.
- Modify: `src/server/rsvp/jobs.ts` (`rsvpFanoutJob` and `rsvpEmailJob`)
- Modify: `src/server/rsvp/email.ts` (a `"reminder"` template using `reminderLead`)
- Modify: `src/server/events/service.ts` (`afterSave` scheduling)
- Modify: `src/app/app/[orgSlug]/calendar/actions.ts` (schedule when attendees are added on update)
- Test: create `src/server/rsvp/reminders.db.test.ts`; update the reminder parts of `src/server/rsvp/rsvp.db.test.ts` and `src/server/rsvp/email.test.ts`; update the registry test if it snapshots payloads.

**Interfaces:**
- Consumes: `reminderLead` and `reminderOffsetsSchema` (Task 7); `notifyUsers` (`src/server/notifications.ts`); the meeting page path `/app/{slug}/meetings/{id}` (Task 4).
- Produces: `scheduleEventReminders(db: Db, event: { id: string; organizationId: string; startsAt: Date; allDay: boolean; reminderMinutes: number[] }, now?: Date): Promise<number>`.
- Payloads:
  - `rsvp-fanout`: `{ eventId, stage: "day" | "hour" | "reminder" | "cancelled", offsetMinutes?: int 1–40320, startsAt? }`;
  - `rsvp-email`: `template` gains `"reminder"`, plus `offsetMinutes?`.
  - `"day"`, `"hour"`, `"reminder-day"` and `"reminder-hour"` stay **accepted** and are read as offsets 1440 and 60, because jobs queued by the current code are still pending in production. New code never enqueues them.

**Rules** (the fanout's algorithm, which the tests pin):
- **Scheduling:**
  - Queue one `rsvp-fanout` per offset, with key `` `${id}:r${offset}:${Math.floor(startsAt / 60000)}` `` and `runAt = startsAt − offset`.
  - Skip offsets whose `runAt <= now`.
  - An all-day event skips offsets under 1440: an hour before a midnight start is 11 PM the night before.
- **When `afterSave` schedules:**
  - on create, unless `origin` is `"import"` or `"sync"` (pass `origin` into `afterSave`);
  - when the start moved;
  - when `reminderMinutes` changed.
  - Never for `event.deleted`. Job keys dedupe, so scheduling twice is harmless.
- **Other schedulers:** `enableRsvpPage` calls `scheduleEventReminders`, and so does the calendar `updateEvent` action when it added attendees.
- **Fanout, stage `reminder`:**
  1. Do nothing if any of these holds:
     - the event is gone (deleted or merged);
     - its start differs from the payload's `startsAt`;
     - it has already started;
     - it is all day and the offset is under 1440.
  2. Delete `EventReminderSend` rows for this event and offset whose `sentAt < (startsAt − offset) − 60s`. They were for an earlier time, so the moved meeting reminds again.
  3. **Guests**, when `rsvpEnabled`: take the `GOING` registrations with no `email` send row for this offset and call `enqueueRsvpEmails(..., "reminder", { startsAt, offsetMinutes })`.
  4. **Members**: take `EventAttendee` rows whose `rsvp` is not `NO` and that have no `app` send row for this offset.
     - In the same transaction, `createMany` their `EventReminderSend` rows (`channel 'app'`, `recipientKey 'u:'+userId`, `skipDuplicates`).
     - Then call `notifyUsers` with `type EVENT_REMINDER`, `dedupeKey: event-reminder:{eventId}:{offset}:{startMinute}` and `linkUrl: /app/{slug}/meetings/{eventId}`.
     - Title: `` `${title} starts ${reminderLead(offset)}` ``, for example "General meeting starts in an hour". When the lead is "tomorrow", the title is `` `${title} is tomorrow` ``.
     - Body: the when line; the place, when there is one; and `Join: {conferenceUrl}` for an online or hybrid meeting with a link. **Never the host link.**
- **Email job, `reminder` template:**
  - **Claim:** insert the `email` send row (`recipientKey 'g:'+registrationId`, `skipDuplicates`). A count of 0 means it was already sent, so stop.
  - **Release:** if the send throws, delete that row, then rethrow.
  - Keep the existing still-true checks.
  - **Stop reading or writing `reminderDaySentAt` / `reminderHourSentAt`.** The columns stay in the schema for now: dropping them while the previous deploy is still serving would break it.

- [ ] **Step 1: Write the failing db tests** in `reminders.db.test.ts`.
  - **Scheduling:**
    - `schedules one fanout per offset at start minus offset`;
    - `skips offsets already past`;
    - `an all-day event keeps only offsets of a day or more`;
    - `an imported event schedules nothing`;
    - `moving the start schedules the new time's fanouts`.
  - **Who gets reminded:**
    - `reminds GOING guests once`: running the fanout twice enqueues one `rsvp-email` per guest, and running the email job twice sends once (check the mailer mock's calls).
    - `reminds members who did not decline`: YES, MAYBE and PENDING are notified, and NO is not.
    - `member reminders carry the join link but never the host link`: the body contains the conferenceUrl, not `conferenceHostUrl`.
    - `in-person member reminder has no Join line`.
    - `a member who is also a guest gets both`: the app row and the email row.
  - **Moves, legacy jobs and failures:**
    - `a moved meeting reminds again for the new time, once`: send, move, run the new fanout → a second notification; run it again → no third.
    - `the old time's fanout sends nothing after a move`.
    - `a legacy stage "day" payload reminds as 1440`.
    - `a failed send releases the claim so the retry sends`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Write the migration** and apply it with `pnpm exec prisma migrate deploy`. Regenerate the client. `pnpm test:rls` must still pass, since an enum value needs no RLS.
- [ ] **Step 4: Implement**, following the Rules above. Update the two registry descriptions so they say what the jobs now do.
- [ ] **Step 5: Update the existing tests.** Fix `rsvp.db.test.ts` assertions on the old columns, and add a `"reminder"` template case to `email.test.ts`: the subject and lead use `reminderLead`.
- [ ] **Step 6: Run.** Run the new and updated suites (db verbose), plus `src/server/jobs/registry.test.ts` if it exists and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 7: Commit.** `git commit -m "Meetings: reminders at any offsets, for members as well as sign-ups"`

### Task 9: Choosing reminders

**Files:**
- Create: `src/components/meetings/reminder-picker.tsx` and `.test.tsx`
- Modify: `src/components/calendar/event-form-dialog.tsx`:
  - `EventFormEvent.reminderMinutes: number[]`;
  - a new prop `defaultReminderMinutes?: number[]`;
  - the picker goes inside "More details", and `payload()` sends `reminderMinutes`.
- Modify: `src/components/calendar/event-detail-view.tsx`. Add a "Reminders" card when `section === "meetings"`: the labels, or "No reminders", plus an Edit control for `canEdit` that saves through `updateEvent(orgId, id, { reminderMinutes })`.
- Modify: every place that builds an `EventFormEvent` or opens `EventFormDialog` for create (calendar page, Meetings page, detail pages): pass `reminderMinutes` and `defaultReminderMinutes`. `typecheck` lists them.
- Modify: `src/app/app/[orgSlug]/settings/general/page.tsx` and `general-forms.tsx`. Add `MeetingRemindersForm`: "Meeting reminders", "New meetings remind everyone going at these times. Each meeting can change its own."
- Test: `reminder-picker.test.tsx`

**Interfaces:**
- Consumes: `REMINDER_CHOICES`, `reminderLabel`, `MAX_REMINDERS` and `updateMeetingReminderDefault` (Task 7).
- Produces: `ReminderPicker` props `{ id?: string; value: number[]; onChange: (next: number[]) => void; disabled?: boolean }`.

- [ ] **Step 1: Write failing tests** in `reminder-picker.test.tsx`:
  - It renders one toggle per `REMINDER_CHOICES` entry, labelled by `reminderLabel`, with `aria-pressed` reflecting `value`.
  - Toggling adds or removes an entry, and `onChange` receives a descending list.
  - An offset in `value` that is not a choice (for example 45) is shown as a pressed toggle and can be removed.
  - With 8 selected, unpressed toggles are disabled.
  - An empty value shows "No reminders".
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the picker and the three call sites.** The create form starts from `defaultReminderMinutes ?? DEFAULT_REMINDER_MINUTES`, and the edit form from `event.reminderMinutes`.
- [ ] **Step 4: Run the tests**, `pnpm typecheck`, and lint the changed files. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Meetings: choose a meeting's reminders, and the organization's default"`

## Phase 4 — The one create flow (spec D1–D6)

### Task 10: Pick the shape first

There is one dialog today, `EventFormDialog`, and it shows every field for every kind of meeting. Ruling: the three shapes are a choice **at the top of that same dialog**, not a separate first screen. A title and Enter still save, the Calendar's dialog and the Meetings flow stay one flow (D6), and spec D1's "opens with the three shapes" holds.

**Files:**
- Modify: `src/lib/meetings/shape.ts` (from Task 6) and create `shape.test.ts`
- Modify: `src/components/calendar/event-form-dialog.tsx`
- Modify: `src/server/events/service.ts`. `eventFields` gains `locationDetails: optionalText(1000)`, and `EVENT_SELECT` gains it.
- Modify: `src/app/app/[orgSlug]/calendar/actions.ts` (`locationDetails` passes through)
- Test: `shape.test.ts`; create `src/components/calendar/event-form-dialog.test.tsx`

**Interfaces:**
- Produces:
  - `type MeetingShape = "online" | "in-person" | "event"` and `SHAPES: readonly MeetingShape[]`;
  - `SHAPE_META: Record<MeetingShape, { label: string; hint: string }>`, set to:
    - online: `{ "Online", "A Google Meet, Zoom or Teams call" }`;
    - in-person: `{ "In person", "A room or an address" }`;
    - event: `{ "Event", "Either of those, with a public sign-up page" }`;
  - `shapeFields(shape): { place: boolean; call: boolean; signUp: boolean }`:
    - online → `{ false, true, false }`;
    - in-person → `{ true, false, false }`;
    - event → `{ true, true, true }`;
  - `shapeFromParam(value: string | null | undefined): MeetingShape | null`. It accepts `"online"`, `"in-person"` and `"event"`, reads `"rsvp"` as `"event"`, and returns `null` for anything else.
  - New `EventFormDialog` prop `defaultShape?: MeetingShape`. Create mode only; edit mode shows every field (D5's promote-in-place).
  - `EventFormEvent.locationDetails: string | null`.

- [ ] **Step 1: Write failing tests.**
  - `shape.test.ts` covers the three tables above.
  - `event-form-dialog.test.tsx` mocks the actions and `ConferencePicker`'s data:
    - `opens with the three shapes, In person chosen by default`.
    - `Event is chosen when defaultRsvpPage is set`.
    - **Online:** `Online hides Location and shows the video-call picker`.
    - **In person:** `In person hides the video-call picker and shows Location and How to find it`.
    - **Switching shapes:**
      - `switching from Online to In person saves no provider`: choose a provider, switch, save, and `createEvent` gets `conferenceProvider: "NONE"` and `conferenceUrl: null`;
      - `switching from In person to Online saves no location`.
    - **Event:** `Event saves, turns the sign-up page on and continues to its settings`: `turnOnRsvpPage` is called and the router is pushed to `/app/acme/meetings/{id}/rsvp?new=1`.
    - **Edit mode:** `edit mode has no shape choice and shows both halves`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The shape control is a `role="radiogroup"` of three cards, the first thing in the form, with arrow-key navigation like any radio group.
  - Initial shape: `defaultShape ?? (defaultRsvpPage ? "event" : "in-person")`.
  - `withRsvpPage` follows the shape, so the separate RSVP switch goes away in create mode.
  - `payload()` sends location and `locationDetails` only when `shapeFields(shape).place` holds, and a provider only when `.call` holds; otherwise `NONE` and `null`.
  - "How to find it" is a `Textarea` with `maxLength={1000}`.
- [ ] **Step 4: Run the tests**, `pnpm typecheck`, and lint the changed files. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Meetings: a new meeting starts by picking online, in person or event"`

### Task 11: Every way in opens that flow, and meetings grow in place

**Files:**
- Create: `src/components/meetings/new-meeting-button.tsx` and `.test.tsx`
- Modify: `src/app/app/[orgSlug]/meetings/page.tsx`:
  - "New meeting" replaces the "New event" link to the Calendar;
  - load the `members`, `timezone` and `defaultReminderMinutes` the dialog needs;
  - handle `?new=`.
- Modify: `src/lib/calendar/range.ts`. `newRsvpEventHref(orgSlug)` → `/app/${orgSlug}/meetings?new=event`, and the JSDoc of `NEW_EVENT_PARAM` changes to match.
- Modify: `src/components/calendar/event-calendar.tsx`. `?new=` also accepts the shapes through `shapeFromParam` and passes `defaultShape`.
- Modify: `src/components/shell/nav-config.ts` (`createActions` gains New meeting) and `nav-config.test.ts`
- Modify: `src/components/calendar/event-form-dialog.tsx`. Add a new prop `afterCreate?: (eventId: string) => string | null`; when it returns a path, push there instead of refreshing. The event shape's push to the sign-up settings still comes first.
- Modify: `src/components/calendar/event-detail-view.tsx` (meetings section). With no call on an IN_PERSON meeting, an "Add a video call" button opens the edit dialog. The existing "Set up an RSVP page" button is relabelled "Add a sign-up page" there.

**Interfaces:**
- Consumes: `shapeFromParam`, `defaultShape` (Task 10); `defaultReminderMinutes` (Task 9).
- Produces:
  - `NewMeetingButton` props `{ orgId, timeZone, members, defaultReminderMinutes, initialShape?: MeetingShape | null, startOpen?: boolean }`; a create from Meetings lands on `/app/{slug}/meetings/{id}`;
  - the create action `{ id: "meeting", label: "New meeting", icon: "Video", href: "{meetings path}?new=1" }`, present when the `meetings` link exists and `canCreateEvents`.

- [ ] **Step 1: Write failing tests.**
  - `nav-config.test.ts`:
    - `New meeting appears for event creators when Meetings is in the sidebar`;
    - `not for members who cannot create events`;
    - `not when Meetings is hidden`.
  - `new-meeting-button.test.tsx`:
    - `opens the dialog`;
    - `startOpen with initialShape "online" opens on Online`;
    - `after a create it navigates to the meeting's page`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - On `/meetings`, `?new=1` opens the dialog with no preset, and `?new=online|in-person|event|rsvp` opens it on that shape.
  - Remove the param after opening, as `event-calendar.tsx` already does for its own `?new=`.
- [ ] **Step 4: Run the tests**, `pnpm typecheck`, and lint the changed files. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Meetings: New meeting everywhere opens the same flow; add a call or sign-ups later"`

## Phase 5 — Keeping it green (spec K1–K3)

### Task 12: End-to-end: the three create paths

Ruling: a provider-backed meeting is **not** covered end to end. That would need a fake Zoom inside the dev server, and the `conference-sync` path is already covered with mocked HTTP in `sync.db.test.ts`. The e2e covers what only a browser can: the three shapes, the meeting page, sign-ups, and the join link's privacy on the public page.

**Files:**
- Create: `e2e/meetings.spec.ts`, using `e2e/helpers.ts` (`signUpVerified` and `createOrgViaOnboarding`) the way `e2e/rsvp.spec.ts` does

- [ ] **Step 1: Write the spec.**
  1. **Online with a pasted link.** On Meetings, open New meeting and choose Online. In the picker, choose "A link I'll paste" and enter `https://example.com/call/abc`. Save, then expect:
     - the meeting page shows a "Join" link with that href;
     - the Meetings list card shows "Online" and a Join link.
  2. **In person.** Choose In person, then fill Location "Room 101" and How to find it "Second floor, left". Save, then expect:
     - the meeting page shows both, plus an "Open in Maps" link;
     - there is no video-call section.
  3. **Event.** Choose Event, with Location "Hall" and a pasted link. Save, then expect:
     - you land on `/meetings/{id}/rsvp?new=1`;
     - opening the public page in a fresh context shows no join link;
     - after signing up there as a guest, the join link is shown.
  4. **Video calls bar.** With no provider credentials in the e2e environment, each provider shows the "isn't switched on yet" state, and none offers Connect.
- [ ] **Step 2: Run** `pnpm test:e2e e2e/meetings.spec.ts`. Expected: PASS. If the e2e environment cannot start here (no browsers, or no e2e database), say so in the report with the error. Do not mark this step done.
- [ ] **Step 3: Commit.** `git commit -m "Meetings e2e: online, in person and event"`

### Task 13: Docs say what is true

**Files:**
- Modify: `docs/features/meetings.md`:
  - **Reminders:** describe what Task 8 built (offsets, members, the send log, moves). Note that the old `EventRegistration` reminder columns are no longer used and will be dropped in a later migration.
  - Add a **The meeting's page** section (Tasks 4–6).
  - Add **Disconnecting**, **Reconnecting picks up waiting meetings** and **Rotated refresh tokens** under the providers.
  - Add **The create flow** (Tasks 10–11).
  - Update the Files table.
- Modify: `docs/setup/meeting-providers.md`. Add a step 4 to "Checking it worked": Disconnect, then Connect again, and the meeting made while disconnected gets its link.
- Modify: `docs/features/rsvp.md`. The management screen now lives at `/meetings/{id}/rsvp`.
- Modify: `docs/superpowers/specs/2026-10-24-meetings-design.md`. Tick every checkbox that is now true: A1–A6, B1–B8, C1–C5, D1–D7, E1–E5, F, G1–G3, H1, H2, H5, I, J, K2, K3. For each item left unticked (C6, G4, H3, H4), add one line saying why.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Check them.** Every path the docs name exists (`ls`), and every function name they cite is found by grep.
- [ ] **Step 3: Commit.** `git commit -m "Docs: meetings as built"`
