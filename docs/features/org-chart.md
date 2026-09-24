# Org Chart: setup

The **Org Chart** section shows who holds each role, who they report to,
what they own and what they can decide alone. Owners and admins build it by
importing a document (Claude reads it into a draft) or by hand, review
everything, and publish. Every member can browse the published chart.

## For an org

### 1. Add a Claude API key (for imports only)

Importing a document needs your organization's own Claude API key: an owner
or admin adds it in **Settings > Integrations > Claude API**. The key is
encrypted when saved and never shown again; only the last four characters
appear. Without a key you can still build and edit the chart by hand
(**Org Chart > Import > Start a blank draft**, or **Edit chart**).

Optional settings on the Claude integration (non-secret config):

| Setting | Default | Meaning |
|---|---|---|
| `model` | `claude-opus-5` | The model that reads documents. |
| `fallbacks` | on | Lets Anthropic re-run a declined request on its recommended fallback model. |

### 2. Import a document

**Org Chart > Import**, then drop a file on the drop zone (or choose one).

- Formats: PDF, Word (.docx), a Google Doc downloaded as .docx or PDF,
  Markdown (.md) or plain text (.txt). Up to 4 MB; PDFs up to 20 pages.
  Macro-enabled Word files (.docm), .doc, ODT and RTF are refused.
- From Google Docs use **File > Download > Microsoft Word (.docx)** or
  **PDF**. PDFs keep diagrams best; Word and text files are read as text.
- What reads best: one section per role with its title and person, a
  "Reports to" line, then bullets for responsibilities and a "Decides
  alone" line. Mark vacancies ("Open hire") and advisors explicitly.
- Each import becomes a new draft version. An org can import 20 documents a
  day, one at a time. The draft page shows progress and usually has the
  result within two minutes; you can leave and come back.
- If the import fails (unreadable file, key rejected, document too long),
  the draft says why and offers **Try again**, **Discard**, or building the
  chart by hand.

### 3. Review the draft (nothing is trusted blindly)

The draft editor lists every position in an outline:

- **Move** a position by dragging its handle onto another row (it then
  reports to that row) or onto a row's top or bottom edge (it sits before or
  after it). On a phone, touch and hold the handle. From the keyboard, use
  **Reports to**, **Move up** and **Move down** in the editor.
- **Rename** titles and people inline, and edit the **Responsibilities** and
  **Decides alone** bullets (Enter adds a bullet).
- **People**: Claude only reads names. The portal suggests matching members
  (exact name, reordered name, initials, a unique first name, close spellings
  or the email name); nothing is linked until you **Confirm** a suggestion,
  pick a member, or use **Confirm all exact**. A named person you do not link
  shows as a placeholder ("Not on the portal").
- **Open hire** marks a vacancy (no person). **Advisor** places the position
  beside its manager on a dashed side branch instead of in the hierarchy; an
  advisor has a manager and no reports.
- **Add position**, **Add a report** and **Delete position** (its reports
  move up to its manager).
- The **checklist** lists problems that block publishing (loops, advisors
  with reports, a vacancy linked to a member) and things to check (several
  top positions, unconfirmed matches, placeholders), plus notes from reading
  the document. **Open items** are questions the document left open.
- **Preview** shows the chart as members will see it.
- **Save draft** keeps your work; if someone else saved the same draft in the
  meantime you are asked to reload instead of overwriting them.

### 4. Publish

**Review and publish** saves, checks everything again on the server and
publishes. Tick **Also set each linked member's title** to copy each
member's position title into their workspace title. The org-chart position
never changes anyone's permission role.

### 5. History and rollback

**Org Chart > Versions** lists every version: imports, edits, restores and
discarded drafts. Open a version to see its positions and the changes
against any other version (added, removed, renamed, moved, person changed,
advisor, bullets). **Restore** copies an old version forward as a new
version and publishes it; nothing is ever deleted. Members who have left
since show as placeholders in the restored chart.

### Browsing the chart (every member)

- **Chart** is a zoomable, pannable tree (pinch and drag on a phone; the
  buttons zoom and fit). **List** is the same chart as an accessible nested
  list.
- Click a position (or press Enter on it) to open its panel: title, person,
  reports to and manages (click to jump to them), advisors, responsibilities,
  decides alone, a link to the person's profile and their open tasks. The
  panel is linkable: `/app/{org}/org-chart?position={key}`.

### Privacy and cost

- The document is sent to Anthropic under your org's API key to be read, as
  data: the request has no tools and instructions inside the document are
  ignored. Member emails are never sent; matching happens in the portal.
- The original upload is stored privately and only owners and admins can
  download it from the draft page.
- Cost per import is roughly $0.10 to $0.40 on Claude Opus 5 for a chart
  like the Claude Builders Club's (a few thousand input tokens and a
  schema-bound answer with adaptive thinking; estimate).

## For developers

| Piece | Where |
|---|---|
| Pages | `src/app/app/[orgSlug]/org-chart/` (chart, `import`, `drafts/[versionId]`, `versions`, `versions/[versionId]`) and `actions.ts` |
| Upload route | `POST /api/orgs/[orgId]/org-chart/imports`; the original is served to admins by `GET .../imports/[versionId]/source` |
| Parse job | `claude-parse` in `src/server/jobs/registry.ts` (heavy; runs only from `/api/cron/jobs` or its kick) -> `src/server/org-chart/parse-job.ts` |
| Claude call | `src/server/org-chart/claude.ts` (`parseWithClaude`, `claudeConnectionTest` for Settings) |
| Extraction | `src/server/org-chart/extract.ts` (sniffing, DOCX zip-bomb guards, PDF page cap) |
| Services | `src/server/org-chart/service.ts` (upload, drafts, publish, rollback, reads); `queries.ts` (cached published chart, `getReportingSubtree`) |
| Pure logic | `src/lib/org-chart/` (schema, normalize, match, validate, layout, diff, draft operations) and `__fixtures__/` |
| UI | `src/components/org-chart/` (canvas, list, side panel, editor) |

Locally, run `pnpm jobs:drain --watch` if the dev server cannot reach its own
`/api/cron/jobs` (the upload's kick needs `CRON_SECRET` and
`NEXT_PUBLIC_APP_URL` pointing at the dev server). Tests never call
Anthropic: `pnpm test` replaces the SDK with a double. Regenerate the parser
fixtures with `pnpm exec tsx src/lib/org-chart/__fixtures__/generate.ts`.
