# Platform changes (suite/platform-changes)

What changed for every club, where it lives, and what it needs. Stacked on
`suite/onboarding-flow`.

## Any club, not just CBC

- The CBC workspace template (Settings › Danger zone) shows, and runs, only
  for platform admins (`PLATFORM_ADMIN_EMAILS`).
- The theme preset once named "Claude Builders Club" is "Paper & Coral" (same
  id `cbc`, so saved themes still resolve). Two new presets: Sunset, Midnight.
- The starter org chart is generic club roles. Database descriptions, CSV
  examples, calendar placeholders, the theme preview and the join-code
  domain hint no longer name CBC or Northeastern.
- The stamp-card report shows only for orgs with stamp milestones.
- Default budget categories are one shared list
  (`src/lib/finance/default-categories.ts`).
- Still club-shaped, left for later: the fixed event kinds (an enum), the
  fall/spring terms in `app.term_of`, the Sunday update's day and time, and
  the website connector's signup labels.

## Navigation, Overview, pins

- The sidebar is three short groups (your work, Club, Data) with Settings at
  the bottom. People is in it; Reports moved into Databases.
- The pin button in the top bar pins any page, note, task, file, database or
  person. Pins show in the sidebar and on the Overview. `Pin` rows are the
  member's own (RLS on user and org); labels are looked up live under RLS,
  so a pin to something the viewer can no longer open drops out.
- The Overview shows a greeting, pinned items, my tasks, meetings (board
  meetings and anything titled "... meeting"), other events and recently
  visited pages (`RecentVisit`, the last 30, own rows only). "Money owed to
  you" moved to Finance › My reimbursements. Finance shows only to finance
  roles.
- Owners and admins of a new club see a getting-started checklist worked out
  from the org's data.

## Themes and pictures

- Settings › Theme says when your own theme hides the club's, with "Match the
  club instead". The personal picker starts with "Match my club" (stored as
  NULL), shows presets as small app previews, and builds a custom theme from
  one colour and one page style. Every combination passes WCAG AA.
- Pictures work with a single Vercel Blob store. Without
  `BLOB_PUBLIC_READ_WRITE_TOKEN`, public images (avatars, logos) are kept in
  the private store and served by `/api/media/[...key]`, which serves
  public-kind keys only. A missing store gives a clear 503 message.
- Admins upload a cropped club picture at the top of Settings › General.

## Finance

A board of widgets each member arranges (`MemberPrefs.financeWidgets`):
numbers, charts (monthly bars, balance over time, category donut, by type),
budget vs. actual, runway, sponsorships and lists. "Add transaction" is the
first thing on the page. The registry is `src/lib/finance/widgets.ts`.

A sponsorship is **cash** or **credits** (`Sponsorship.type`). Cash works as
before: reaching Received books an IN transaction. Credits (cloud, API or
software credits) carry a dollar value for the pipeline but never reach the
ledger: no transaction is booked, and they stay out of the balance, the
runway and the cash Committed/Received totals. The Sponsorships page and the
dashboard card show them on their own lines.

## Databases

With no data and nothing connected, admins get setup inside Databases:
connect the website database inline (the guided setup's data step), import
a CSV, or start from the calendar. Members see a plain empty state. Empty
databases fold away once some have data. Reports is a tab
(`/databases/reports`; `/reports` redirects).

## Notes

- **Files tab.** Upload PDFs, Word, PowerPoint, Excel, images, and text
  files (.txt, .md, .csv), up to 4 MB. They are stored in `OrgFile` and the
  `files` storage kind.
  - The type is read from the bytes.
  - A file is shared with the club or kept private to the uploader, enforced
    by RLS. The uploader or an admin can remove it.
- **In-app preview.** `/notes/files/[id]` shows each type in place:
  - PDFs in the browser's viewer, inside a same-origin frame. The files route
    is the only path without `X-Frame-Options: DENY` or the static CSP, and
    it sends `frame-ancestors 'self'`.
  - Images as images, Word documents as a read-only note, CSV as a table.
- **Folders** are made from New › Folder, the "New folder" row under the
  folders in the rail, or "Move to folder…" › Create and move.
- **New › Word document or Google Doc** turns the document into a note.
  - Word files pass the zip-bomb guards before mammoth reads them.
  - Google Docs must be shared by link; the import follows redirects only
    between Google's document hosts.
  - The browser keeps only what the note schema allows, and the server
    checks the result again (`importNote`).
- **Editor.** A toolbar, word count and reading time, and an "On this page"
  outline.

## Availability

"Import a screenshot" in the week editor sends the image to Claude using the
platform key, `ANTHROPIC_API_KEY`.
- The answer is schema-bound, and the request has no tools.
- The image is never stored.
- Each member can import 10 an hour.

Detected classes appear in a review dialog before they join the week as
regular commitments. Without the key, the button says the feature isn't set
up.

## Tasks

The Tasks calendar uses the main Calendar's month table and chips instead of
FullCalendar. You drag chips between days and from the "No due date" tray.
Week, board, table and team share one group header and panel style
(`src/components/tasks/layout-ui.tsx`).

## Round two: customizable everything

- **Boards** (`src/lib/boards`, `src/components/boards/widget-board.tsx`): the
  Overview and Finance are each member's own board. They can:
  - add any widget from the gallery;
  - drag it by the handle to reorder;
  - drag its corner to resize (width snaps to 1-4 columns, height to 20px),
    or use the width and height buttons.

  Saved in `MemberPrefs.overviewWidgets` / `financeWidgets`. The Overview has
  no finance widgets at all.
- **Pins:**
  - Drag any sidebar page or in-app link onto Pinned (in the sidebar, or the
    Overview widget) to pin it, and drag pins to reorder them.
  - Note, file and database cards have a pin button.
  - The top bar's button says "Pin" or "Pinned".
- **Pin anything:** "Pin something" (the + by Pinned, the Overview widget,
  the arrow on the Pin button, or ⌘K) searches everything the member can
  open and pins it. That covers notes, files, folders, tasks, events,
  polls, people, databases, pages and views.
  - Views that live in the query string (a Notes folder, the Files tab, a
    Tasks layout) have one canonical address (`src/lib/pins/pages.ts`).
  - Pin buttons appear on task rows, the task panel, people, polls, folders,
    and note, file and database cards.
- **Sidebar per org** (`src/lib/nav/sidebar.ts`, Settings › Sidebar): owners
  and admins hide, reorder, regroup and rename sections and headings.
  - Overview and Settings always stay.
  - A member who opens a hidden section sees a notice. Hiding tidies the app;
    it isn't a permission.
- **Settings** has a grouped rail with icons, and the settings overview lists
  every section by group.
- **Notes:**
  - Shared folders (`NoteFolder`). Any member creates one; its creator or an
    admin renames, recolours or deletes it. A trigger keeps notes and files in
    their own org's folders.
  - Drag cards onto a folder to move them. Moving a note is an edit, so its
    author or an admin can do it.
  - Search, sort, grid or list view, and templates.
  - A Word document or Google Doc is previewed before it becomes a note. You
    pick the title, folder and who can see it, and can keep the original
    `.docx`.
  - File cards show a text excerpt (`OrgFile.excerpt`) or an image thumbnail.
  - Word files and text files preview as a page.

## Round three: things that have to just work

**Finance never dead-ends.**
- With no budget period, Finance shows a "Set up your budget" card (school
  year, semester or calendar year, one click) above the normal board, and
  "Add transaction" works anyway: a treasurer's first transaction makes this
  school year (Aug 1 to Jul 31) with the starter categories
  (`ensureActivePeriod`, `src/server/finance/periods.ts`). A member's
  reimbursement request needs a period the treasurer set up and says so.
- Budget is rebuilt: labelled fields, presets, rename or move a period,
  delete an empty one, and per category the budget, spent and left with a
  bar. Typing an amount and clicking away saves it. Dates show in UTC, so
  Aug 1 no longer prints as Jul 31.
- Deleting a category that's in use leaves its transactions uncategorized
  (each change audited) instead of refusing; reconciled ones still lock it.
- Widget boards: "Add widget" sits next to Customize, there's a dashed
  "Add a widget" tile at the end, and each widget's "…" menu makes it wider
  or narrower, moves it, or removes it, saved at once.

**Delete anything, the same way everywhere.** Every card and row has a
"…" menu (`src/components/item-menu.tsx`) with Delete last and red. Deletes
ask first in one themed dialog (`src/components/ui/confirm-dialog.tsx`;
`window.confirm` is gone) and most offer Undo in a toast
(`src/components/ui/toaster.tsx`, mounted in the app shell).
- Notes and Notes files: card menu (open, download, copy link, move to
  folder, delete), a Delete button in the editor, drag a card onto
  "Recently deleted". "Recently deleted" in the Notes rail keeps notes and
  files for 30 days (`NOTE_TRASH_DAYS`) with Restore. A deleted file's bytes
  now stay until then; the daily maintenance job removes them after.
- Tasks: "…" on rows and board cards, a confirm (with subtask count) in the
  editor and for bulk delete in the table, Undo through `restoreTask`.
  Comments ask first too.
- Finance: transactions get Delete (treasurers on anything not reconciled,
  members on their own requests until approved). Money rows are never
  erased: Delete voids with the reason "Deleted", lists hide them ("Show
  deleted transactions" brings them back into view) and Restore or Undo
  un-voids, all in the finance audit log. Receipts, categories, periods,
  sponsorships and sponsors can be deleted as well.
- Events and labels use the same dialog.

**Notes always save.** The autosave (`use-autosave.ts`) never drops an
edit: a failed save keeps its text and retries with backoff ("Couldn't save
— retrying", with Retry now), leaving the editor or hiding the tab sends
what's waiting at once, and closing the tab with unsaved changes asks
first. Each save also keeps a copy in the browser (`note-backup.ts`) until
the server confirms it; reopening a note whose last changes never arrived
offers to restore them.

**Files without setting anything up.** With no Vercel Blob store, files go
to Postgres (`StoredBlob`, `src/server/storage/database-driver.ts`):
club pictures, avatars, receipts, Notes files and exports all work on a
fresh deployment. A Blob store, once added, takes over; files saved before
stay readable, and an upload the store refuses still lands in the database.
`/api/media` serves public pictures from either. The table has no grants:
only `app.blob_put/get/delete/list` reach it, and only `app_service` may run
them (RLS tests P-BLOB-01 to 03).

**Saving a theme shows.** Saving the club theme also applies its light or
dark mode for you (a mode picked earlier in the user menu used to win in
that browser). If your own personal theme hides the club's, the save says
so with "Show me the club theme". "Match my club" in your profile also goes
back to the club's light or dark.

## Migration

`20261001120000_pins_files_prefs`:
- Adds `Pin`, `RecentVisit`, `MemberPrefs` and `OrgFile`, with RLS, grants
  and checks. Each table's security is covered by the RLS tests P-PIN-01
  and P-PIN-02.
- Adds the manifest allowlist entries for their own-row writes.

It only adds tables.

`20261002120000_folders_sidebar_boards`:
- Adds the `NoteFolder` table, with RLS, grants and the same-org trigger.
- Adds the columns `Note.folderId`, `OrgFile.folderId`, `OrgFile.excerpt`,
  `OrgSettings.sidebar` and `MemberPrefs.overviewWidgets`.
- Covered by the RLS test P-PIN-03.

It only adds things.

`20261003120000_pin_folder_kind` lets pins and recent pages point at a
folder.

`20261004120000_database_blob_storage` adds `StoredBlob` and the four
`app.blob_*` functions (app_service only). It only adds things.

`20261007120000_sponsorship_type` adds the `SponsorshipType` enum (`CASH`,
`CREDITS`) and `Sponsorship.type`, defaulting to `CASH`, so every existing
sponsorship stays cash. It only adds things.
