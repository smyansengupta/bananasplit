# Org Chart: setup

The **Org Chart** section shows who holds each role, who they report to,
what they own and what they can decide alone. Owners and admins build it by
importing a document, by starting from the club template, or by hand; they
review everything and publish. Every member can browse the published chart.

**You do not need a Claude API key.** The portal reads org-chart documents
itself, for nothing. A key is only a backup for a document it cannot make
sense of, and for PDFs.

## For an org

### 1. Get the chart in (three ways)

**Import a document.** **Org Chart > Import**, then drop a file on the drop
zone (or choose one).

- Formats: Word (.docx), a Google Doc downloaded as .docx, Markdown (.md),
  plain text (.txt) or PDF. Up to 4 MB; PDFs up to 20 pages. Macro-enabled
  Word files (.docm), .doc, ODT and RTF are refused.
- The portal reads the document during the upload, so the draft is usually
  ready to review by the time the page opens. A PDF is the exception: its
  text cannot be read in the portal, so a PDF needs a Claude key.
- Each import becomes a new draft version.

**Start from the club template.** **Org Chart > Import > Start from the club
template** creates a draft with the nine roles a student club usually has -
President, a faculty advisor, VP Operations, VP Growth, Head of Finance,
Head of Programs, Head of Tech, Head of Social & Membership and an open
Graphic Designer - already laid out, with responsibilities and
decides-alone lines written in and nobody assigned. Fill in the people,
change what does not fit, delete the rest.

**By hand.** **Org Chart > Import > Start a blank draft**, or **Edit chart**
to start from the published version.

### 2. What reads best

The portal understands the shapes a club actually writes. Any of these works:

| Shape | Looks like |
|---|---|
| A section per role | `### VP Growth: Lucas Salzgeber` then `Reports to: Jackson · Manages: Kristine, Designer`, then bullets |
| A markdown heading hierarchy | `## President — Jackson`, `### VP Ops — Oliver`, `#### Head of Tech — Smyan`, with bullets under each |
| An indented outline | each role on its own line, its reports indented under it, bullets indented further |
| A drawn tree | the same, with `|--`, `+--` or `├──` connectors |
| A drawn diagram | boxes side by side with `+-----+` bars and `|` drops, as in a handbook's chart |
| A table | `| Title | Name | Reports to |`, optionally with `Responsibilities` and `Decides alone` columns (`;` between items) |
| Bullet lists | `- **President** — Jackson`, with nested bullets for reports and responsibilities |

Details that are picked up wherever they appear:

- **Reporting lines**: `Reports to:`, `Reporting to:`, `Manager:`, and
  `Manages:` / `Direct reports:` the other way round. Odd casing and a small
  typo are tolerated (`Reports To`, `REPORTS-TO`, `Reprots to`). `N/A`,
  `None` and `-` mean "top of the chart".
- **Advisors**: an `Advisor: Mehr` line, a title containing "advisor", or
  `(advisor)` after a name. An advisor sits beside their manager on a dashed
  side branch and has no reports.
- **Open hires**: `[OPEN HIRE]`, `(open)`, `(vacant)`, `TBD`, a person of
  `Open hire`, or a `Status: open` field.
- **Decisions**: a `Decides alone:` line, or a responsibility phrased as
  "Final say on X, Y and Z" when there is no `Decides alone:` line.
- **Responsibilities**: the bullets under a role.

### 3. Review the draft (nothing is trusted blindly)

The draft page opens with **how this draft was read**: which reader produced
it, how much of the document it understood, how many positions it found, and
an expandable list of the lines it could not place under any position. It
invents nothing from those lines - if any of them belong to a role, you add
them yourself.

Below that, the editor lists every position in an outline:

- **Move** a position by dragging its handle onto another row (it then
  reports to that row) or onto a row's top or bottom edge (it sits before or
  after it). On a phone, touch and hold the handle. From the keyboard, use
  **Reports to**, **Move up** and **Move down** in the editor.
- **Rename** titles and people inline, and edit the **Responsibilities** and
  **Decides alone** bullets (Enter adds a bullet).
- **People**: only names are read. The portal suggests matching members
  (exact name, reordered name, initials, a unique first name, close spellings
  or the email name); nothing is linked until you **Confirm** a suggestion,
  pick a member, or use **Confirm all exact**. A named person you do not link
  shows as a placeholder ("Not on the portal").
- **Open hire** marks a vacancy (no person). **Advisor** places the position
  beside its manager on a dashed side branch instead of in the hierarchy.
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

### 5. Add a Claude API key (optional)

An owner or admin adds one in **Settings > Integrations > Claude API**. The
key is encrypted when saved and never shown again; only the last four
characters appear. It is used only when the portal's own parser cannot make
sense of an uploaded document, and for PDFs.

| Setting | Default | Meaning |
|---|---|---|
| `model` | `claude-haiku-4-5-20251001` | The backup reader. |
| `fallbacks` | on | Lets Anthropic re-run a declined request on its recommended fallback model. Only offered for models that support it. |

The model picker shows the cost per import next to each model:

| Model | Price (in / out per million tokens) | About, per import |
|---|---|---|
| Claude Haiku 4.5 (default) | $1 / $5 | $0.02 |
| Claude Sonnet 5 | $2 / $10 | $0.05 |
| Claude Opus 5 | $5 / $25 | $0.12 |
| Claude Opus 4.8 | $5 / $25 | $0.12 |

A draft that Claude read shows what that import actually cost.

Removing the key does not break imports: they keep working with the portal's
own parser.

### 6. History and rollback

**Org Chart > Versions** lists every version with the reader that produced it
(read here, read by Claude, club template, by hand) and, for the portal's own
reader, how much of the document it understood. Open a version to see its
positions and the changes against any other version (added, removed, renamed,
moved, person changed, advisor, bullets). **Restore** copies an old version
forward as a new version and publishes it; nothing is ever deleted. Members
who have left since show as placeholders in the restored chart.

### Browsing the chart (every member)

- **Chart** is a zoomable, pannable tree (pinch and drag on a phone; the
  buttons zoom and fit). **List** is the same chart as an accessible nested
  list.
- Click a position (or press Enter on it) to open its panel: title, person,
  reports to and manages (click to jump to them), advisors, responsibilities,
  decides alone, a link to the person's profile and their open tasks. The
  panel is linkable: `/app/{org}/org-chart?position={key}`.

### Privacy and cost

- A document read by the portal never leaves your server.
- A document sent to Anthropic travels under your org's API key, as data:
  the request has no tools and instructions inside the document are ignored.
  Member emails are never sent; matching happens in the portal.
- The original upload is stored privately and only owners and admins can
  download it from the draft page.
- An org may send 20 documents a day to Claude, one at a time. Documents the
  portal reads itself are not limited.

## For developers

| Piece | Where |
|---|---|
| Pages | `src/app/app/[orgSlug]/org-chart/` (chart, `import`, `drafts/[versionId]`, `versions`, `versions/[versionId]`) and `actions.ts` |
| Upload route | `POST /api/orgs/[orgId]/org-chart/imports`; the original is served to admins by `GET .../imports/[versionId]/source` |
| **Built-in parser** | `src/server/org-chart/parse/` - `index.ts` (the shape readers, assembly and the confidence score), `document.ts` (line model and segmentation), `fields.ts` (labels, role lines, lists), `diagram.ts` (the ASCII grid reader) |
| Parse job (Claude) | `claude-parse` in `src/server/jobs/registry.ts` (heavy; runs only from `/api/cron/jobs` or its kick) -> `src/server/org-chart/parse-job.ts` |
| Claude call | `src/server/org-chart/claude.ts` (`parseWithClaude`, `claudeConnectionTest` for Settings); models, prices and per-model request rules in `src/lib/org-chart/models.ts` |
| Extraction | `src/server/org-chart/extract.ts` (sniffing, DOCX zip-bomb guards, PDF page cap) |
| Starter structure | `src/lib/org-chart/starter.ts` |
| Services | `src/server/org-chart/service.ts` (upload, drafts, publish, rollback, reads); `queries.ts` (cached published chart, `getReportingSubtree`) |
| Pure logic | `src/lib/org-chart/` (schema, normalize, match, validate, layout, diff, draft operations) and `__fixtures__/` |
| UI | `src/components/org-chart/` (canvas, list, side panel, editor, `editor/parse-report.tsx`) |

### How the two readers fit together

```
upload  ->  extract text  ->  built-in parser  --confident-->  READY draft (no key, no cost)
                                    |
                                    +-- not confident, org has a key --> claude-parse job
                                    |                                     -> READY draft (CLAUDE)
                                    |                                     -> on failure, the
                                    |                                        parser's reading
                                    +-- not confident, no key ----------> READY draft (BUILTIN)
                                                                          with a note

PDF (no local text)  ->  Claude if there is a key, else an empty draft with a note
```

Nothing publishes without a human review on any path.

**Confidence.** `scoreConfidence()` in `src/server/org-chart/parse/index.ts`
combines three ratios, and fewer than two positions scores zero:

| Signal | Weight | Meaning |
|---|---|---|
| coverage | 0.4 | content lines placed / content lines considered |
| linkage | 0.4 | (positions with a manager + one allowed root) / positions |
| identified | 0.2 | positions naming a person or marked open / positions |

At or above `BUILTIN_CONFIDENCE_THRESHOLD` (**0.7**) the built-in reading
becomes the draft. Below it, Claude is asked. The CBC chart scores 0.97 as
markdown, plain text or a table, 0.99 as an outline, tree, heading hierarchy
or bullet list, and 1.00 as the bare diagram; the same chart described in
prose scores 0. Those figures are asserted in
`src/server/org-chart/parse/parse.test.ts`, so this table cannot drift.

`OrgChartVersion` records the outcome: `parseMethod`
(`BUILTIN | CLAUDE | TEMPLATE | MANUAL`), `parseConfidence`, and
`parseReport` (the counts, notes and unplaced lines the admin sees).
`parseUsage.costUsd` holds what a Claude parse cost.

### Local development

Run `pnpm jobs:drain --watch` if the dev server cannot reach its own
`/api/cron/jobs` (the upload's kick needs `CRON_SECRET` and
`NEXT_PUBLIC_APP_URL` pointing at the dev server). Only the Claude path uses
a job; a document the built-in parser reads never enqueues one.

Tests never call Anthropic: `pnpm test` replaces the SDK with a double.
The parser fixtures are the CBC chart in every supported shape
(`src/lib/org-chart/__fixtures__/cbc-*.md|txt`), all asserted against
`expected.json`; regenerate the .docx/.pdf/.txt derivatives with
`pnpm exec tsx src/lib/org-chart/__fixtures__/generate.ts`.

### What the built-in parser does not do

- **PDFs.** There is no local PDF text extraction, so a PDF goes to Claude
  or to the editor.
- **Images and scans.** No OCR on either path.
- **Prose.** A document that describes the structure in sentences
  ("Jackson runs the club, Oliver looks after operations") is not parsed; it
  goes to Claude, or lands in the editor with a note.
- **Judgement.** It never invents the open items a document leaves implicit,
  and it does not paraphrase: "Final say on budget, ..." becomes the
  decision "Budget", where Claude writes "Budget (final say)".
