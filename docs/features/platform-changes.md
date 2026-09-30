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
