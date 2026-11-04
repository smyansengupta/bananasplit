# CRM add-on: plan

Status: Phases 1 to 5 built and wired together on `claude/crm` (see the "as built"
sections and "Integration as built" at the end); phase 6 is plan. Source material: the CRM teardown PDF (seven
CRMs, 12 modules, rebuild costs), read against this repo on `claude/fc-all`,
plus three research passes on 2026-11-02: user complaints (about 80
sources), 53 newer CRMs and tools, and the facts on self-hosted models,
Tavily and email permissions.

## The goal in one paragraph

An industry-grade CRM that any organization on **Team Advanced** adds from
**Integrations and apps**, like Forms and Finance. Its center is **people
and reaching out to them**: who you know, who you need to reach, what you
last said, and what happens next. It should cover what Salesforce, HubSpot,
Pipedrive, Zoho, Attio, Close and monday CRM sell (the 12 modules below),
built into Bananasplit so people, outreach, meetings, tasks, forms,
databases, files and money all point at each other. **We spend as close to
$0 a month as we can**:
no new servers, no per-seat vendors, and anything that costs money per use
(AI, email volume, calls, enrichment) runs on the organization's own keys or
their own Claude. Our own AI comes later, behind the same switch.

**This is a product for other organizations, not our own CRM.** Every
choice below assumes thousands of separate organizations on one deployment:
each one's data is walled off by RLS, each one connects its own accounts
and keys, nothing is configured by hand for a customer, and every setting
has a default that works on the first click. An organization that has
never used a CRM should get value in its first five minutes; one leaving
Salesforce should find the depth it expects.

**It's for any organization reaching out to people, not just sales.** The same CRM runs:

| Who you're reaching | Example pipeline (ready-made, renameable) |
|---|---|
| New members, volunteers, applicants | Interested, Reached out, Talked, Applied, Joined |
| Donors and funders | Identified, Asked, Pledged, Received, Thanked |
| Partners and deals | Prospect, Committed, Invoiced, Received (Finance's Deals) |
| Speakers, guests, judges, mentors | Invited, Confirmed, Briefed, Done, Thanked |
| Alumni and past members | Keep in touch (no stages, just a cadence) |
| Press, venues, vendors | Contacted, Quoted, Booked |
| Clients and customers | Lead, Qualified, Proposal, Won or Lost |
| Grants | Researching, Drafting, Submitted, Awarded or Declined |

So the words on screen follow the organization: a pipeline names what it
tracks ("an applicant", "a donation", "a deal"), amounts are
optional, and Won/Lost can read Joined/Didn't join. Underneath, it's one
system. On screen, the other side of the relationship is a **Company**,
never an "organization", so it can't be confused with the workspace.

## Six decisions that shape everything

1. **We build the CRM inside Bananasplit; we don't bolt on Twenty or n8n.**
   The PDF's cheapest rebuild is Twenty + n8n, but Twenty is AGPL-3.0 and
   n8n's license is internal-use only. Both are fine for running your own
   team and wrong for a product other organizations download. We already
   have most of the parts (below), so building it ourselves is also less work
   than integrating a second app with its own login, database and UI.
2. **No new monthly bills for us.** It runs on what we already pay for
   (Vercel, Neon Postgres, Resend, Vercel Blob), using the job queue we
   already have for anything slow. The only new free service is inbound
   email (see "Email without the expensive Google scopes").
3. **Usage costs go to the organization's own accounts.** AI on their Claude
   (or OpenAI-compatible) key, or through their own Claude app over our MCP
   connector; email on their Resend sender or their Gmail/Outlook; calls and
   texts on their Telnyx or Twilio key; enrichment on their Hunter or
   Prospeo key; web research on their Tavily key. Every one of these is
   optional, and the CRM works with none of them.
4. **AI sits behind one interface so we can swap in our own models later.**
   Every AI call goes through `src/server/ai/` and is metered (tokens, model,
   feature, who) from day one, so turning on "Bananasplit AI" (our own
   models, later) is a billing change, not a rewrite.
5. **The CRM is part of Databases, not a separate island.** People,
   companies and every pipeline are databases in the Databases section, with
   the same field engine, views, filters, import, export, Forms and Reports
   (see "How it fits into Databases").
6. **Each member's own accounts do the outreach.** Mail goes out from the
   member's own Gmail or Outlook once they connect it, so replies come back
   to them and nothing is sent "from Bananasplit".

## Whose keys pay for what

Everything that costs money per use runs on a key the organization saved
in CRM settings > AI (`src/components/crm/settings/org-keys.tsx`, server
side `src/server/crm/org-keys.ts` and `crm/org-keys-actions.ts`). Keys are
`OrgSecret`s through `src/server/secrets` (encrypted at rest, audited,
owners alerted); owners and admins save and test them, only owners remove
them, and only the last four characters ever come back ("sk-ant-…4f2a").

| Cost | Where | Whose key |
|---|---|---|
| AI: drafts, summaries, briefs, Ask, AI fields, agents, transcripts, scans, describe an automation, call summaries | `runCrmAi` and `crmCredentials` in `src/server/crm/ai.ts` | The organization's Claude key, else its OpenAI-compatible key. Bananasplit's own key (`ANTHROPIC_API_KEY`) only when `BANANASPLIT_AI=1` (the later plan, billed as ours and outside the cap). The local stand-in only with `AI_STANDIN=1` off Vercel. |
| Web research and enrichment | `enrich.ts`, `agents.ts`, `ai-fields.ts` | Its Tavily, Hunter or Prospeo key, or Claude's own web search on its Claude key |
| Texts and calls | `src/server/crm/phone/` | Its Telnyx or Twilio account |
| Call and voice note transcripts | `crmTranscribeJob` | Its Deepgram key |
| Bulk email and campaigns | `sendFromMailbox` | Its own Resend sender on a verified domain, always |
| One-to-one and sequence email | `sendFromMailbox` | Its Resend sender when verified; until then our sender on its behalf, only for mail a person pressed Send on (or Start, for a plan's first email): counted (an `AiUsage` row paid by PLATFORM, outside the cap) and at most 50 a day per organization. Never bulk, never a booking receipt, never anything queued without a person |
| Your own Claude over MCP | `src/server/connectors/tools/crm*.ts` | The member's own Claude plan |

**The meter and the cap.** Every use writes one `AiUsage` row: tokens for
AI (plus $10 per thousand for Claude's web searches), and an estimated
list price for everything else (`src/lib/crm/per-use.ts`: a Tavily search,
a Hunter or Prospeo lookup, an SMS segment, a call minute, a transcript
minute, an email on the organization's sender), metered by
`src/server/crm/spend.ts`. One monthly spending cap
(`CrmSettings.aiMonthlyCapCents`, owners and admins, no cap by default)
covers all of it: past the cap, AI and lookups refuse with "Your
organization has reached this month's spending cap of $25. An owner or
admin can raise it in CRM settings > AI.", texts and calls refuse before
they start, queued texts, bulk, sequence, campaign and automation email
on its own Resend stop, and transcripts leave the audio as it is.
One-to-one email still goes. A paid call about to run holds its estimated
cost (an `AiUsage` row, feature `crm.reserve`, dropped when the real use
is written, lapsing after ten minutes; checks run one at a time per
organization), so calls at once can't all pass a full cap
(`reserveUnderCap` in `ai.ts`, used by `runCrmAi`, enrichment, AI fields'
and agents' searches). A missing key says where to
add it ("Add your Telnyx or Twilio key in CRM settings > AI first.").
Outside the CRM, the AI imports (`docs/features/ai-imports.md`), Reports'
AI, Forms' AI and the pulse summary still use the shared connection list
(`resolveAiCredentials`), which ends with the platform key; that's a
separate decision for those features.

## What we already have and will reuse

| Need | Already in Bananasplit | Where |
|---|---|---|
| Add-on switch, add-on page | `ADD_ONS`, `OrgSettings.addOns`, `/integrations/crm` placeholder | `src/lib/addons.ts` |
| Custom fields and field types | Custom databases: fields, JSONB values with a GIN index, CSV import | `DatabaseField`, `DatabaseRecord`, `src/lib/databases/fields.ts` |
| Bringing people in | Forms that write every response to a database, no sign-in needed | `Form`, `FormResponse`, `docs/features/forms.md` |
| Partners and a deals pipeline (Finance › Deals) | `Sponsor`, `Sponsorship` (Prospect to Received), linked to Finance | Finance |
| People we've met | `Contact` + `ContactEmail` (check-ins, sign-ups, unsubscribes) | website sync |
| Tasks, notes, meetings, files | Tasks, Notes, Meetings/Events, Files, plus `ItemLink` to link any two | `ItemLink` |
| Booking links | Availability (`UserAvailability`), Find a time, RSVP pages | Meetings |
| Background work | `Job` queue drained by `/api/cron/jobs` | `src/server/jobs` |
| Reports and dashboards | Reports on any database, a Pipeline widget, schedules, snapshots | `src/lib/reports`, `src/server/reports` |
| AI with the org's key | `CLAUDE` and `OPENAI_COMPATIBLE` integrations, encrypted `OrgSecret` | `src/server/ai`, `src/lib/ai/vendors.ts` |
| "Connect your own Claude" | MCP server at `/api/mcp` with read and write tools, per-member grants | `docs/features/ai-connectors.md` |
| Email sending | Per-org Resend sender, else the platform sender; unsubscribe flags | `src/server/email` |
| Google sign-in and Calendar | OAuth, Calendar mirror, Meet/Zoom/Teams links | `src/server/google-calendar`, `src/server/conference` |
| Texting | SMS module | `src/server/sms` |
| PDFs | `@react-pdf/renderer` (quotes and invoices) | dependency |
| Security | Per-org RLS, the `test:rls` suite, audit log, export and deletion | `prisma/rls`, `OrgAuditLog`, `OrgExport` |
| Inbox and notifications | Inbox with Overdue/Today/To review, notifications, email digests | `src/server/inbox` |

## Data model

The CRM's core objects get **their own typed tables** (stages, owners,
dates, amounts and "last contacted" need to be real columns so pipelines,
follow-up lists, forecasts and dedupe are fast and indexed). Each table
also has a `custom` JSONB column for the fields an organization adds, and
those fields are ordinary `DatabaseField` rows (next section), so adding a
field never needs a migration.

| Table | What it is |
|---|---|
| `CrmPerson` | The heart of it. Name, emails, phones, socials, title, company, owner, relationship type (member prospect, donor, partner, alumni, speaker, client, custom), source, last contacted, next follow-up, keep-in-touch cadence, score, unsubscribe and consent flags, custom fields. Linked to an existing `Contact` and/or `User` when the email matches, so check-ins, RSVPs and membership show on their page. |
| `CrmCompany` | The other side when it's a group: a business, school, foundation, venue, another organization. Name, domain, size, industry, owner, custom fields. On screen, "Company". |
| `CrmPipeline`, `CrmStage` | Any number of pipelines from the templates above or from scratch. Each names what it tracks ("applicant", "donation"). A stage has an order, an optional likelihood, a "stuck after N days" limit and an Open/Won/Lost kind with renameable labels. |
| `CrmDeal` | One thing moving through a pipeline (an application, a pledge, a deal, a booking). Stage, owner, people with roles, optional amount and expected date, optional forecast category (Pipeline, Best case, Commit), won/lost reason, next step, custom fields. Called by its pipeline's own word on screen; `CrmDeal` is only the table name. |
| `CrmActivity` | One timeline row: email, meeting, call, text, note, form response, RSVP, check-in, stage change, field change, sequence step. Points at any mix of person, company and pipeline item. |
| `CrmEmailThread`, `CrmEmailMessage` | Emails logged from any source, threaded, with open/click/reply state. |
| `CrmTemplate`, `CrmSequence`, `CrmSequenceStep`, `CrmEnrollment` | Email templates with merge fields; timed multi-step sequences that stop on reply. |
| `CrmWorkflow`, `CrmWorkflowRun` | If-this-then-that automations and their run history. |
| `CrmView` | Saved views: filters, sort, columns, board or table, shared or personal. |
| `CrmFieldHistory` | Every field change: who, when, old, new (Salesforce field history). |
| `CrmGoal`, `CrmForecastSnapshot` | Targets per person or team per quarter; weekly forecast snapshots so you can see how a quarter's call moved. |
| `CrmScoreRule` | Points rules for scoring people and pipeline items. |
| `CrmQuote`, `CrmQuoteLine` | Quotes and invoices with line items, a PDF and a public accept page. |
| `CrmBooking` | A booking page per member (or round-robin per team) on top of availability. |
| `AiUsage` | Every AI call: org, user, feature, model, tokens in/out, cost estimate, which key paid. |

Rules carried over from the house rules: every table has RLS, GRANTs and a
row in `prisma/rls/phases.mjs`; deletes go to a restorable trash
(`deletedAt`); every write that matters lands in `CrmFieldHistory` or the
audit log.

**Moving Finance deals in.** Finance's deals become one of the ready-made
pipelines, not the point of the CRM. Existing `Sponsor` rows (partners on
screen) become companies (their contact name and email become people) and
`Sponsorship` rows (deals on screen) become items in a **Deals** pipeline
(Prospect, Committed, Invoiced, Received, Declined, Written off). Marking
one Received still records the Finance transaction, as today, and Finance
keeps its deal totals by reading the CRM. Organizations that never had
Finance deals never see this pipeline.

## How it fits into Databases

The CRM should feel like a smarter part of Databases, not a second place to
keep lists. Bananasplit already shows built-in databases backed by their own
tables (attendance, sign-ups, people): a `DatabaseDefinition` whose rows come
from typed tables, with built-in columns from code. The CRM uses exactly that.

- **People, Companies and each pipeline are databases.** Adding the CRM
  creates `DatabaseDefinition` rows of new kinds (`CRM_PEOPLE`,
  `CRM_COMPANIES`, `CRM_PIPELINE`, one per pipeline). They show in the
  Databases section with the CRM's icon, and open in the same table, board,
  filters, sort, search, bulk edit and CSV export as any other database. A
  row edited in Databases and a record edited in the CRM are the same row.
- **One field engine.** The CRM's custom fields are `DatabaseField` rows on
  those definitions, with every existing type (text, number, currency, date,
  select, member, email, phone, URL). Learn fields once, use them everywhere.
- **A new Relation field, for every database.** `DatabaseFieldType` gains
  `RELATION` (to CRM people, companies, pipeline items, or any other
  database), shown both ways with counts and rollups (sum, latest, count).
  So "Events we ran together", "Equipment on loan" or "Grant reports" can
  be ordinary databases whose rows point at people and companies, and they
  appear on those records. This replaces a separate "custom objects"
  system.
- **Turn any database into CRM records.** Pick an existing database (an old
  partner spreadsheet, form responses, an alumni list), match its columns
  to the CRM's (suggested automatically from names and types), and it
  creates or updates people and companies, deduped on email and domain. The
  original database stays, with a Relation column pointing at the records
  it made, so nothing is lost.
- **Forms send straight in.** A form's destination can be the CRM (new
  person, new item in a pipeline), mapped the same way.
- **Reports work on day one.** Because they're databases, every Reports
  widget (Number, Over time, Breakdown, Pipeline, Top values, Goal, Compare
  periods) already works on CRM data; the CRM adds the outreach and
  pipeline widgets in module 7.
- **Your own Claude sees it as data too.** The MCP tools that read and
  write databases work on CRM databases, with CRM-specific tools on top.

## The 12 modules, and how we build each

Cost columns: **Us** is what Bananasplit pays per month. **Org** is what an
organization pays, only if it turns that feature on.

### 1. Data model
People, companies, pipelines and their items, all as databases (above):
custom fields, relations to any database, field history, saved views, bulk
edit, merge and dedupe (fuzzy match on
name, email, domain and phone; suggest merges in a review list; merging
keeps every activity, sequence and automation). Active, Inactive and Alumni
states instead of deleting. Job history when someone changes employer.
Validation rules and fields required only at a given stage. Undo on every
bulk edit. CSV import with column mapping, reusing the database importer,
run as a job so 50,000 rows don't time out. Export to CSV anytime.
Us $0. Org $0.

### 2. Pipeline
Board, table and forecast views of each pipeline. Drag between stages; the
closing stages (Joined, Received, Won, Didn't join, Lost) ask for a reason
in one step. A card turns amber when it sits past its stage's limit.
Pipedrive's rule is on by default: every open item shows its next step,
and one with none gets flagged. Count, and amount where there is one, at
the top of each column. The toolbar is the Tasks bar
(view switch, filter chips, search), like every other page.
Us $0. Org $0.

### 3. Activity capture
One timeline on every person, company and pipeline item, pulling from:
- **Bananasplit itself (free, automatic):** meetings and events they're
  invited to, tasks and notes linked to them, form responses, RSVPs,
  check-ins, Finance transactions.
- **Email (free):** a per-member BCC/forward address
  (`log+<token>@in.<our domain>`); anything sent or forwarded there is
  matched to people by address and logged. Later, Gmail and Outlook sync
  (see below).
- **Calendar (free, already built):** Google Calendar events with a
  person's address attach to them.
- **Calls and texts:** logged by hand at first; automatic once the org
  connects a phone provider (module 5).
- **Your own Claude (free to us):** a member's Claude, which can already read
  their Gmail and calendar through its own connectors, logs emails and
  meeting notes into Bananasplit through our MCP write tools ("log my emails
  with Harbor Light from this week").
Us $0. Org $0.

### 4. Bringing people in
- **Forms:** a form can send its responses to the CRM ("Create a person",
  "Add to the Volunteers pipeline"), with field mapping and dedupe on email.
- **Website embed:** a form embed snippet and a hosted form link (forms
  already need no sign-in).
- **Import:** CSV, vCard, and from existing databases.
- **Enrichment (optional):** fill title, company, size and socials from the
  org's own Hunter or Prospeo key (about $0.01 to $0.02 a contact, per the
  teardown), from their Tavily key (web search and page extraction, then a
  model pulls the fields out), or from their Claude key using web search.
  Each value records where it came from and when, so a stale or wrong one
  can be traced and refreshed.
- **Routing:** round-robin or rules-based owner assignment, with a
  notification and an Inbox row for the new owner.
Us $0. Org $0, or a few cents per enriched contact.

### 5. Outreach (the center of the CRM)
Reaching out to people is what most organizations need most, so this is
the deepest module and comes right after the core.

**Who to reach out to today.** A follow-up queue on the CRM's home and in
each member's Inbox: follow-ups due, replies waiting on you, people going
cold, new people from forms, and people you said you'd contact this week.
Work down it with one click per person (email, text, call, log, snooze).

**Keep in touch.** Any person or list can have a cadence ("every 30 days",
"each quarter", "before every event"). When it lapses they come back to
the queue, so alumni, donors, mentors and partners don't drift away.

**Lists and campaigns.** Any saved view is a list ("alumni in Boston",
"donors who gave last year", "everyone who came to two events"). A
campaign is a list plus a goal ("reach all 200 alumni by Friday") and a
template; it can be **split among members** (each gets their share, sent
from their own mailbox) and shows progress: contacted, replied, booked,
joined.

**Personal at scale.** Mail merge with fields from the person, their
company and their history ("thanks for coming to the March showcase"); a
preview of every message before it sends; per-person edits without leaving
the list.

**Invite them to things.** From the CRM, invite people to a Bananasplit
event, meeting or form; RSVPs, check-ins and responses flow back onto
their timeline and the campaign's numbers.

**Never step on each other.** Each person shows who owns the relationship
and who talked to them last; reaching out to someone another member is
already talking to asks first. Do-not-contact and unsubscribes apply to
every member and every channel.

| Channel | How | Us | Org |
|---|---|---|---|
| 1:1 email | Compose on any record; templates with merge fields; sends from the member's own connected Gmail or Outlook (from the coming email connections), or the org's Resend sender until then; open and click tracking with our own pixel and redirect | $0 | $0 |
| Sequences | Timed steps (email, task, call reminder, LinkedIn reminder) run by the job queue; stop on reply, on meeting booked or on unsubscribe; daily send caps per mailbox | $0 | $0 |
| Bulk email | Segments from any saved view; one-click unsubscribe header; sends through the org's Resend (or SES) key, never ours, so a bad list never hurts our sending reputation | $0 | Resend or SES rates |
| Booking links | Built on availability and Find a time; booked meetings land in Meetings and on the timeline; round-robin for teams | $0 | $0 |
| Calls | Click-to-call (`tel:` links) and a call log on day one; later a browser softphone and power dialer through the org's Telnyx or Twilio key, with recording consent built in | $0 | Telnyx about $0.007 a minute |
| Texting | Two-way SMS through the org's Telnyx or Twilio key on the existing SMS module, logged to the timeline, STOP handled | $0 | carrier rates |
| AI drafts and agents | Draft an email, a follow-up or a research brief on a person; a person always approves before anything sends | $0 | on their key |

**Whose mailbox.** Each member connects their own Google or Microsoft
account; the CRM never holds a shared organization mailbox. Until the email
connections ship, the CRM still works: logging through the BCC address, and
stop-on-reply by giving each sequence email a Reply-To on our inbound
address that logs the reply and forwards it to the member. Inbound mail is
received free with Cloudflare Email Routing and an Email Worker that posts
to `/api/crm/inbound` (Resend's inbound mail is the fallback). Once a member
connects their mailbox, the CRM uses it instead (see "Email connections").

**Deliverability and law, built in from day one:** SPF/DKIM/DMARC checks
on the org's sender before bulk sends are allowed, one-click unsubscribe,
per-mailbox daily caps, consent and opt-out fields on every person, STOP
handling for texts, and an all-party recording notice for calls.

### 6. Workflow automation
A builder in the same look as the rest of the app: **When** (record
created, field changed, stage changed, form submitted, email replied,
meeting booked, date reached, no activity for N days) **If** (conditions on
any field) **Then** (create a task, update a field, assign an owner, send a
template, enroll in a sequence, invite to an event, notify someone, post to
Slack or Discord, call a webhook, create a Finance item). Runs on the job
queue, with a run history and a dry-run button. Ready-made recipes so most
organizations switch one on instead of building one ("Someone filled in the
interest form: add them, assign an owner, send the welcome email, follow up
in 3 days"; "A donor gave: thank-you task, receipt email, move to Thanked";
"A client said yes: start the project with its tasks, owner and files").
Us $0. Org $0.

### 7. Reporting
CRM data is already in Reports because it's in Databases. The CRM adds
outreach and pipeline widgets: people reached, reply rate, time to first
reply, follow-ups overdue, relationships going cold, outreach by member,
campaign progress, stage-to-stage conversion, time in stage, conversion by
source (which form, event or list brought people in), amounts raised by
source, and **pipeline velocity** (open items × success rate × average
amount ÷ days to close). Everything
Reports already does (walkthrough, Home shapes, schedules, sharing,
Insights) carries over.
Us $0. Org $0.

### 8. Forecasting
What's likely to come in: money (donations, deals, client work) and
people (applicants likely to join, speakers likely to confirm). All three
methods from the teardown: weighted pipeline (amount or count × stage
likelihood), category roll-up (members mark Commit, Best case or Pipeline;
owners and admins adjust), and a trend forecast from the org's own history
once it has enough closed items. Goals per member or team per quarter or
year, with attainment. Weekly snapshots so you can see how the forecast moved.
Us $0. Org $0.

### 9. Scoring and intelligence
- **Rules first:** points for fields (title, company size) and behaviour
  (opened, clicked, replied, booked, attended an event), recomputed by a
  job and written to a score field anyone can sort on.
- **Learned later:** a small logistic regression trained on the org's own
  won and lost items once it has about 200, run in our nightly job (no paid
  ML service), with the top reasons shown next to the score.
- **Signals:** stuck items, items with no next step, someone who went
  quiet, a renewal or anniversary coming up, a past member who's back at
  events, an unusual drop in outreach.
  They show in the Inbox's "To review".
- **Conversation intelligence:** call or meeting transcripts (pasted,
  uploaded, or from Zoom/Meet/Granola) summarized into next steps,
  objections, competitors and sentiment on the org's key. Audio
  transcription only with the org's own Deepgram key (about $0.26 an hour
  per the teardown).
Us $0. Org $0, or AI and transcription on their keys.

### 10. AI assistant and agents
Three ways in, none of which cost us anything:
1. **Your own Claude (or ChatGPT, Cursor) via MCP.** We add CRM tools to the
   existing `/api/mcp` server (next to its database tools): search, read a
   timeline, "who haven't we talked to in two months", "what changed with
   Harbor Light since Monday", create and update records, log activity,
   build a list, draft (never send) emails. The member's own subscription pays for the
   thinking. This is the main path for now.
2. **The org's API key inside the app.** "Summarize this record", "draft a
   follow-up", "research this person or company" (Claude with web search), meeting
   summaries, and overnight scoring through the Batch API (half price). The
   default model per job is set in one place (a small fast model for
   summaries, a stronger one for drafts) and every call is written to
   `AiUsage`, with a monthly cap the org sets.
3. **Later, Bananasplit AI.** Our own models on our own AWS server (see
   "Later: Bananasplit AI"). Same features, same `AiUsage` meter; the org
   just stops needing a key.
Agents (a research agent on each new person, a follow-up agent on people
going cold)
always stop at a draft for a person to approve. Nothing sends on its own.

### 11. Integrations and API
Day one: CSV in and out, Google Calendar (built), the BCC logging address,
Slack and Discord webhooks, MCP (built). With the coming email connections:
each member's Gmail, Outlook and other mailboxes. Next: a public REST API
with per-org API keys and outgoing webhooks (person added, stage changed,
item closed), which also makes Zapier and Make work without us paying for
either. Later: Stripe (a payment received closes an item and books
Finance), support inbox and website chat.

**Tavily (bring your own key).** A card on Integrations and apps, next to
Claude and the other model APIs: the org pastes its Tavily key, which is
stored as an `OrgSecret` like every other key (a new `TAVILY` integration
provider). It powers the research agent, enrichment ("find this company's
size, address and recent news"), and a "What's new with them" panel on
company pages before a meeting. We never pay for Tavily calls; with no key
these buttons explain what connecting one adds. Members who connect their
own Claude can also give it Tavily's own MCP server, so the same research
works from their Claude with no key in Bananasplit at all.

Tavily's free plan gives 1,000 credits a month (a basic search is 1 credit,
extracting 5 pages is 1), so a small organization's research costs it
nothing; paid plans start at $30 for 4,000. The connect card shows the
org's credits used this month. Before launch, get Tavily's written OK that
a customer's own key held by a SaaS on their behalf fits their terms
(the terms allow building Tavily into apps for outside users, but don't
name this case).

### 12. Admin, security, mobile
- Roles: owners and admins see everything; members see what they own plus
  what's shared, or everything, per the org's choice; a "CRM manager" role
  for people who run the pipeline without being admins. Enforced in RLS, not
  just the UI, and covered by `test:rls`.
- Field-level hiding for sensitive fields (phone, personal email).
- Field history, the audit log, a restorable trash, merge history.
- GDPR/CCPA: export a person's data, erase a person everywhere (timeline,
  emails, enrollments), honour unsubscribes across every send path.
- Mobile: the app is responsive; add an installable web app (PWA) and a
  phone-first "today" view (calls to make, follow-ups due, quick log).
  At fairs and events: photograph a business card or badge and AI makes the
  person; record a voice note and it lands on their timeline. No native app
  store fees.
- Restore any record to an earlier point from its field history.
- Guest links: a partner or client opens a private page with their own
  agreement, deliverables and recap, and nothing else in the CRM.
- Scale target: 100,000 people and 20,000 pipeline items in one org stay fast
  (server-side filters, cursor pagination, indexes, the GIN index on custom
  fields), checked with a seeded load test.

## What today's CRMs get wrong, and our answer

From user complaints across Reddit, Hacker News, G2, Capterra, TrustRadius
and the vendors' own idea boards (2026-11-02). "Widespread" means many
threads across several CRMs.

| What users complain about | How widespread | Our answer |
|---|---|---|
| Logging every call, email and meeting by hand; the CRM gets updated late or never | Widespread, every CRM | It fills itself from the workspace; email connections; paste a screenshot of any chat |
| Built for managers' reports, not the people doing the work, so teams go back to spreadsheets | Widespread | The follow-up queue is the home page; reports come for free from the same data |
| Price cliffs (HubSpot Starter to Pro is about $20 to $90 a seat plus a $1,500 to $3,000 onboarding fee), basics locked to top tiers, seats for occasional volunteers | Widespread | Included in Team Advanced for the whole organization; no seats, no onboarding fee, nothing locked inside the CRM |
| AI credit bills that spike with no cap | Common, 2025 to 2026 | Members' own AI; the org's key with a **hard** monthly cap; usage shown live |
| Duplicates everywhere; merging is risky and kicks people out of automations | Widespread | Fuzzy matching on name, email, domain and phone; merges keep history, sequences and automations |
| No "inactive" or "archived" state (requested since 2007 at Salesforce, 2017 at HubSpot) | Widespread | Every person and company has Active, Inactive or Alumni; nothing has to be deleted to tidy up |
| No validation rules or "required only at this stage" fields (HubSpot, open since 2018) | Widespread | Validation rules and stage-conditional required fields, e.g. "reason" only when moving to Lost |
| A contact changes employer and their history gets muddled | Common | Job history on the person: past companies keep their history, the person keeps all of it |
| Real reporting still means exporting to a spreadsheet; no reports across people, items and activities | Widespread | Reports on any database, joined (built), with the CRM's widgets |
| Email sync is all or nothing and admins fear the vendor reads all mail | Common | Per-member choices: nothing, who-and-when only, or full; never-log lists; only mail with known people |
| Open tracking is wrong since Apple Mail Privacy Protection | Common | Replies, clicks and bookings are the headline numbers; opens are labeled approximate |
| Outlook treated as second class (HubSpot), extensions that slow Gmail | Common | Gmail and Outlook equal; no browser extension required |
| History leaves with the person; whoever inherits their contacts gets no context | Common | Relationships owned by a **role** as well as a person (below); handover briefs |
| Partners and clients can't be let in safely, so updates live in email | Common | Guest links: a partner sees their own agreement, deliverables and recap, nothing else |
| Zapier glue that breaks quietly; sales to delivery hand-off breaks | Widespread | One system: a closed item can start a project (tasks, owner, files) automatically |
| Mobile apps are a cut-down shadow; nobody uses them | Widespread | Phone-first "today" view, card and badge scanning at events, voice notes |
| Weeks of setup and consultants | Widespread | Pick what kind of organization you are; fields, pipelines, forms and reports are made for you |
| Switching CRMs loses the timeline, not just the contacts | Common | Importers that keep notes and activity from HubSpot, Salesforce and Pipedrive exports; export includes the timeline |
| No undo for bulk edits or wrong stage moves | Narrow | Undo on every bulk action; restore any record to an earlier point from its field history |
| Nonprofits: donors, volunteers, events and grants need separate tools or workarounds | Common | Donations, recurring gifts, volunteer hours and grants on the person, through Finance and the ready-made pipelines |
| Volunteer-run organizations: partner history lives in personal inboxes and dies every leadership change; no product serves them | Common; no product found | Role ownership, handover, and records that fill from the workspace |
| Slow pages (Salesforce admits Lightning is slow) | Common | Server-side filters, cursor pagination, a seeded load test of 100,000 people, keyboard shortcuts |

**Relationships owned by a role.** A person, company or pipeline can be
owned by an org-chart position ("Partnerships lead", "Volunteer
coordinator") as well as a member. When the member in that position
changes, the relationships follow the position, the new person gets the
handover briefs, and the timeline stays. Bananasplit already has the org
chart, so this costs us little and no standalone CRM can do it.

**Paste any conversation.** A screenshot or pasted text of a WhatsApp,
LinkedIn, Instagram or text thread: AI (the org's key) finds the person and
the next step, and it lands in the review queue. Bananasplit already turns
calendar screenshots into events the same way.

**Organization setup in one step.** On adding the CRM: "What do you mostly
reach out to?" (members and volunteers, donors, partners and deals,
clients, all of these). It creates the pipelines, fields, intake forms,
saved views and a starter report, and offers to bring in existing people
from Bananasplit (members, check-ins, form responses, Finance partners) and from a
spreadsheet.

## What every CRM has in 2026 (we must match it)

From a survey of 53 CRMs and CRM-adjacent tools (2026-11-02). These are no
longer differentiators; leaving one out reads as unfinished.

| Table stakes | Where it is in this plan |
|---|---|
| Email and calendar sync with automatic logging | Email connections, module 3 |
| AI summaries of people, companies and meetings | Module 10 |
| Ask questions of the CRM in plain language | MCP (your own Claude) + an "Ask" box on CRM pages (module 10) |
| A connector for Claude and ChatGPT | Built (`/api/mcp`), CRM tools added |
| AI-filled fields (research or classify each row) | **AI fields**, added below |
| Meeting notes that suggest record updates | Module 9 (transcripts) + the review queue below |
| AI-drafted follow-ups | Module 5 |
| Describe-it-in-words workflow builder | **Added to module 6**, below |
| Agents with a run log and approval before sending | Module 10, with the review queue |
| Usage-metered AI | `AiUsage` |

**AI fields.** Any CRM database can have a field filled by AI per row: a
prompt ("Is this a good partner fit for us? Yes, Maybe, No",
"Their mission in one line"), optional web research through the org's
Tavily key, and an output type (text, select, number, URL). Runs on new
rows, on demand, or on a schedule, on the org's key (or later Bananasplit
AI); each value cites where it came from.

**Describe-it workflows.** In the workflow builder, "When someone fills in
the volunteer form, add them to Volunteers, assign whoever has the fewest,
and remind them in two days" turns into the When/If/Then steps, shown for
review before it's switched on.

## What makes ours better

Most CRMs are built for a stable sales team, charge per seat, meter AI,
and can't see the rest of the organization's work. Bananasplit's CRM wins
where those assumptions break.

1. **It fills itself from the workspace.** Meetings, calendar invites,
   RSVPs, check-ins, form responses, Finance, shared files and tasks all
   land on people's timelines with nothing connected. Other CRMs show
   nothing until you connect an inbox; ours is useful on day one.
2. **Relationship strength from every touchpoint, not just email.** Score
   each person and company on meetings together, events attended, forms,
   payments, files and tasks as well as email, and show "who in our
   organization knows them best" on every record.
3. **It knows the money.** Deals, donations, dues and invoices from
   Finance on each person and company: pledged versus received, lifetime
   total, which budget it funds, and the renewal created automatically from
   the end date. Mainstream CRMs leave this to a separate tool.
4. **What we owe them, tracked.** For partners and clients, the promises
   (logo on the shirts, a talk slot, social posts) are tasks linked to the
   agreement and its payment, and one click makes a recap for them from
   real event and attendance numbers.
5. **Handover when people change roles.** Organizations rotate leaders and
   volunteers often. When someone leaves or changes role: reassign their
   relationships in one step, write a handover brief per contact (history,
   open promises, money involved), and flag anyone left with no owner.
   Built for turnover, which sales CRMs assume away.
6. **One review queue for every AI change.** Anything AI, an automation or
   a member's own Claude proposes (a new contact, a field change, a stage
   move, a draft) arrives as a before-and-after with its source (which
   meeting, email or form), accepted or rejected in one click. Trust,
   without extra clicks.
7. **Bring your own AI, with no credits.** Members use their own Claude or
   ChatGPT through MCP, and the org can add its own key; CRM work never
   burns a Bananasplit credit meter. Later, Bananasplit AI for those who
   want none of that.
8. **Bring your own data connectors.** Tavily, Hunter, Prospeo, Apollo,
   People Data Labs: the org plugs in what it has, and enrichment tries
   them in order until one answers (Clay's "waterfall"), paying only for
   what returns data. We charge nothing per lookup.
9. **One data model.** The CRM is databases. Fields, views, Reports, Forms
   and AI tools work the same on people as on equipment or expenses.
10. **Promises become tasks.** "I'll send the deck Friday" in a meeting or
    email becomes a dated task on that person, and "they'll confirm budget
    in March" becomes a follow-up, so nothing falls through.
11. **Signals from inside the organization.** A regular stopped coming, a
    pledge is overdue, a renewal is close, a form answer sounds unhappy,
    nobody has talked to someone in 90 days. Web signals (news, job
    changes) layer on through the org's own Tavily key.
12. **Pipelines for every kind of relationship.** Members, volunteers,
    donors, partners, speakers, press, alumni, clients, grants,
    each with stages, a ready intake form, Finance links and report
    presets, in plain words rather than sales jargon.
13. **People keep their own details current.** Through the RSVP and form
    links they already use, a contact can update their own email, title or
    phone, so records stay fresh without paying for enrichment.
14. **Move in from a spreadsheet in minutes.** For most organizations the
    real competitor is a spreadsheet or a Notion or Airtable template, not
    Salesforce. Drop the file in: columns are matched, rows deduped and
    linked to existing members, events and Finance. A HubSpot or
    Salesforce CSV export maps the same way.
15. **A warm-intro map members opt into.** A member can choose to share
    who they know (from their connected mailbox) with the organization.
    "Who here knows someone at Harbor Light?" then shows that a path exists
    and offers "ask for an intro", without exposing anyone's contacts.
16. **No per-seat CRM pricing.** It comes with Team Advanced for the whole
    organization, so occasional members can look things up and log a call
    without anyone counting seats. Organizations have many part-time
    members; per-seat pricing hurts them most.
17. **Your data, your AI, your connectors.** Field-level privacy (donation
    amounts, contract terms), full export at any time, each member's AI
    sees only what they can see, and a written promise that customer data
    never trains any model.

## Email connections (coming soon): what the CRM does with them

Members will soon connect their own mailboxes (Gmail, Outlook, and others)
to Bananasplit itself, not just to the CRM. The CRM is designed so that the
day those land, it gets much better with no rework:

- **One way in for every email.** The BCC address, Reply-To replies, Gmail
  sync, Outlook sync and any other mailbox all hand messages to one function
  (`ingestEmail(source, message)`), which threads them, matches people and
  companies, and writes the timeline. Adding a mailbox type is a new source,
  not a new feature.
- **Every member decides what is shared.** Per mailbox: nothing, who and
  when only, or full messages; plus domains and addresses that are never
  logged (a doctor, a bank, family). Only mail with someone already in the
  CRM, or with a company domain the org works with, is logged at all. A
  member's personal mail never lands in the organization's CRM by accident.
- **Records that build themselves.** From real correspondence, suggest new
  people and companies (with name, title and phone from signatures) for one
  click to add, instead of typing them in. Suggestions, never silent
  creation, so the CRM doesn't fill with newsletters.
- **Relationship strength and who knows whom.** How often and how recently
  anyone in the organization has emailed or met someone, so a new member
  can see who already knows a partner before writing cold.
- **Real reply detection.** Stop-on-reply, out-of-office detection
  (pause, then resume after the return date) and bounce handling read the
  actual mailbox instead of relying on our Reply-To.
- **Send from your own mailbox, logged automatically.** 1:1 emails and
  sequence steps go out from the member's connected mailbox, appear in
  their Sent folder, and land on the timeline.
- **Calendar alongside.** The same connection's calendar fills the timeline
  with meetings and powers booking links without a second sign-in.
- **Attachments** go to Files, linked to the person and the pipeline item.

Until then, everything above works in a smaller way through the BCC address
and the org's sender, so nothing waits on email connections to ship.

**Notes for the email connections project** (checked 2026-11-02):

- **Gmail.** Sending (`gmail.send`) is a "sensitive" permission: it needs
  Google's free app verification, with no security assessment. Reading mail
  (`gmail.readonly`, `gmail.metadata`, `gmail.modify`) is "restricted": it
  also needs a yearly CASA assessment from an approved lab, about $675 to
  $855 a year at the cheapest lab's entry level (about $5,400 at the higher
  level). Until verified, an app is capped at 100 users. New mail arrives
  through Gmail's push (Pub/Sub, free at our volume) with a fallback poll.
- **Outlook / Microsoft 365.** Publisher verification is free. But since
  November 2025, Microsoft's default settings stop ordinary users from
  approving mail-reading apps themselves: in most customer workplaces an IT
  admin has to approve Bananasplit once. The connect screen should detect
  this and offer "Send this to your admin" with the approval link, instead
  of failing. Personal Outlook.com accounts aren't affected. New mail
  arrives through Graph webhooks, renewed at least weekly.
- **Other mailboxes** (iCloud, Yahoo, Fastmail, school or company mail on
  IMAP): app passwords over IMAP and SMTP, stored as encrypted secrets.
- **Shortcut if needed:** Unipile (from about €49 a month for 10 accounts)
  offers already-verified Google access to launch with; Nylas does too, but
  only on contract plans. Worth it only if Google's review is slower than
  launch.

## Build order

Each phase ships something complete, and later phases build on it. Nothing
is cut; this is only the order.

1. **People, pipelines and Databases.** Tables, RLS, the add-on switch on
   Team Advanced, the one-step organization setup, role ownership through
   the org chart, People, Companies and pipelines as databases in the
   Databases section, the Relation field for every database, "turn a
   database into CRM records", record pages with the timeline from
   Bananasplit's own data, the ready-made pipelines, custom fields, saved
   views, import/export (spreadsheets, Notion, Airtable, and HubSpot,
   Salesforce and Pipedrive exports with their notes and activity kept), dedupe and merge, field history, relationship strength
   from workspace touchpoints, Finance on people and companies, Finance
   deals moved into the Deals pipeline, the add-on page rewritten from
   "Coming later" to real feature rows.
2. **Reaching out.** The follow-up queue, keep-in-touch cadences, lists and
   campaigns split among members, templates and mail merge, 1:1 email
   (member's own mailbox when connected, the org's sender until then),
   tracking, invites to events and forms, booking links, sequences with
   stop-on-reply, bulk email with unsubscribe and sender checks, Forms to
   CRM, embeds, owner routing, the BCC logging address, handover when
   members change roles, "what we owe them" for partners and clients with
   guest links, people updating their own details through RSVP and form
   links, donations, recurring gifts and volunteer hours on the person.
3. **Automation and numbers.** Workflow builder with describe-it-in-words
   and recipes, the outreach and pipeline widgets in Reports, velocity,
   forecasting with categories, goals and snapshots, rules-based scoring,
   signals in the Inbox.
4. **AI.** The review queue for every AI change, CRM tools on the MCP
   server, the Ask box, AI fields, in-app summaries and drafts on the org's
   key, meeting briefs and promises-to-tasks, paste-any-conversation, card
   and badge scanning, voice notes, the research and follow-up
   agents with approval, the enrichment waterfall across the org's own
   connectors (Tavily and the rest), the `AiUsage` meter and monthly cap,
   Batch API scoring.
5. **Phone, quotes, API.** Click-to-call and call log first, then the
   softphone, power dialer, recording and texting on the org's Telnyx or
   Twilio key, with consent; transcription on the org's Deepgram key; quotes
   and invoices as PDFs with a public accept page (typed-name acceptance);
   public REST API, API keys and webhooks; the learned scoring model.
6. **Later.** Bananasplit AI on our own AWS server, support inbox and
   website chat, Stripe, territories, a native app, a parent organization
   over several chapters with shared contacts and roll-up reports, and
   two-way task sync with Google Tasks and Outlook To Do.

Email connections aren't a CRM phase: they're their own Bananasplit project
landing soon. Whenever they arrive, the CRM switches to them through
`ingestEmail` and the member's own mailbox for sending, and turns on what
needs a mailbox: records that build themselves, real reply detection, and
the opt-in warm-intro map.

## Later: Bananasplit AI on our own server

Not now. Written down so today's design leaves room for it.

**What it is.** Open models we host on our own AWS server, so organizations
get AI with no key and no Claude account. We pay for the server; it's
included in the plan or sold as credits. Same features as the
bring-your-own options; `AiUsage` already meters every call, so turning it
on is a provider switch and a billing rule.

**How it plugs in.** Ollama (and vLLM, below) speak the OpenAI-compatible
API that `src/lib/ai/vendors.ts` already uses. Our server becomes one more
provider, set by the platform operator in environment settings (never an
address an organization types), chosen per feature: for example ours for
summaries, scoring and suggestions, the org's own Claude for long drafts
if it has one.

**Things to know before building it** (checked 2026-11-02):

- **Ollama to start, vLLM to serve customers.** Ollama is easiest to set up
  but handles requests mostly one at a time; in Red Hat's benchmark vLLM
  served about 20 times the throughput on the same GPU. Use Ollama for
  trying models, vLLM once real organizations depend on it. Neither has
  login built in, so the server sits behind a proxy (Caddy) that checks our
  key and rate-limits per organization, and accepts traffic only from our
  app.
- **Models we can legally sell use of.** Apache-2.0 models have no strings:
  Qwen3.8-27B (strong all-rounder with tool calling, fits one 48 GB GPU),
  Gemma 4 (26B and 31B), gpt-oss-20b. Avoid Llama 4 (branding rules,
  EU limits) and the custom-license models. For search and "similar
  people", an embedding model such as Qwen3-Embedding (Apache-2.0).
- **Server cost.** One always-on GPU in us-east-1: about $590 a month (L4,
  24 GB, small models), $1,360 (L40S, 48 GB, the 27B models), or about
  $590 for the L40S on a 3-year commitment. Double it for a backup server.
- **The catch: today it costs more than the APIs.** Small hosted models
  (Claude Haiku 5.5 at $0.10 in and $0.50 out per million tokens) are so
  cheap that one $1,360 server only breaks even at billions of tokens a
  month. Amazon Bedrock also runs the same open models (Gemma 4, gpt-oss)
  by the token at about Haiku's price, with no idle cost.

**So the order is:** (1) Bananasplit AI first on a pay-per-token API on our
account (Haiku-class or Bedrock open models), with a spend cap per plan;
(2) our own GPU server once usage is big enough to beat that, or once
customers need their data never to leave our servers (a real selling point
for some organizations). Same switch either way.

## What it costs

**Bananasplit's own bill: about $0 extra a month at launch.** Everything
runs on the current Vercel, Neon, Resend and Blob setup. What can grow:
Neon storage and compute as organizations add records (CRM rows are small;
emails are stored as text, attachments go to Blob), and job-queue function
time on Vercel. Inbound email on Cloudflare is free.

**What an organization pays, only for what it turns on** (rates from the
teardown, to be checked before we quote them anywhere):

| Feature | Their cost |
|---|---|
| Everything in phases 1 to 3 | $0 |
| AI summaries (small model) | about $1.50 per 1,000 call-hours of summaries |
| AI email drafts (stronger model) | about $0.01 a draft |
| Research agent | about $0.02 to $0.05 a person |
| Bulk email | Resend free up to 3,000 a month, or SES about $0.10 per 1,000 |
| Calls | Telnyx about $0.007 a minute |
| Transcription | about $0.26 to $0.46 an hour |
| Enrichment | about $0.01 to $0.02 a contact |

Compare: the teardown puts a comparable SaaS tier at $250 to $900+ a month
for 5 users.

## Gaps we accept for now

Territory management, CPQ (complex product pricing rules), a third-party app
marketplace, predictive dialing, and full inbox sync for Gmail. The teardown
is right that these are where Salesforce is hard to match; none are needed
for the organizations using Bananasplit today.

## Plan

The CRM is an add-on on **Team Advanced** (`SOCIETY`, the highest plan),
like Deals (feature key `sponsorships`): a `crm` entry in `PLAN_FEATURES` set to `SOCIETY`,
and `crm` added to `ADD_ONS`. A 14-day trial includes it, as it includes
everything on Team Advanced.

A Personal space gets it on **Personal Plus** (`crm` in
`PERSONAL_PLUS_EXTRAS`), so a new account's 14-day trial includes it too;
Personal Free sees it locked. See "Personal CRM" at the end.

## One-time setup on our side

Not decisions, and nothing per customer:

- **The inbound address** for BCC logging and replies: a subdomain of the
  app's own domain (for example `in.<app domain>`), set up once.
- **The app registration** that members' Google and Microsoft sign-ins go
  through. Each member connects their own account; Google and Microsoft
  just need one "Bananasplit" app registered for that consent screen. It's
  the same one the coming email connections and Google Calendar use, so the
  CRM adds nothing here.


## Phase 1 as built

People, pipelines and Databases, on `claude/crm`. What exists, where it
lives, and what's left.

### Schema

- Every CRM table, with RLS and grants: `20261105090000_crm` (P-CRM-01).
- `20261105100000_crm_databases`: `CrmStage.key` (a stable key for a
  ready-made stage, so a renamed "Received" still maps to Finance);
  `DatabaseField` rows may belong to the CRM's databases (rows stay
  club-made only); CRM managers make and edit the CRM's
  `DatabaseDefinition`s and fields (`app.is_crm_database`). P-CRM-02.

### The add-on

- `crm` in `ADD_ONS` (`src/lib/addons.ts`), the `crm` plan feature on
  `SOCIETY` (`src/lib/billing/features.ts`), a sidebar section under
  Integrations and apps (`PINNED_PLACE`), and New person, New company and
  New item in New (`src/components/shell/nav-config.ts`).
- `/integrations/crm` is the real add-on page; Add goes to the setup.
- Every page starts at `crmShell` (`src/app/app/[orgSlug]/crm/shell.tsx`):
  plan, add-on, setup. Every action goes through `crmAction`
  (`src/app/app/[orgSlug]/crm/actions.ts`): `withOrgAction` with the `crm`
  feature and `requireCrm`; a refusal throws, so the whole action rolls
  back.

### Setup (`src/server/crm/setup.ts`, `src/components/crm/setup.tsx`)

"What do you mostly reach out to?" (`SETUP_KINDS`,
`src/lib/crm/templates.ts`) makes CrmSettings, the relationship types,
one pipeline per answer (alumni get a keep-in-touch cadence instead), the
People, Companies and pipeline databases, and the saved views. Finance's
deals bring the Deals pipeline even when not picked, and move in
(`src/server/crm/sponsors.ts`). Run again, it adds only what's missing.
Then: bring in members, check-in contacts and form respondents
(`src/server/crm/bring-in.ts`, a job over 200), or a file.

### Server API for later phases (`src/server/crm/`)

| Need | Call |
|---|---|
| Gate a page or action | `requireCrm(actor)`, `crmAccess(actor)`, `requireManager(access)` (access.ts) |
| People | `createPerson`, `updatePerson`, `trashPeople`, `restorePeople`, `setPersonEmails`, `personByEmail`, `workspaceMatch` (people.ts) |
| Companies | `createCompany`, `updateCompany`, `trashCompanies`, `restoreCompanies`, `companyByDomain` (companies.ts) |
| Pipeline items | `createDeal`, `updateDeal`, `moveDeal` (returns `needs` when a stage wants fields), `addDealPerson`, `removeDealPerson`, `trashDeals`, `restoreDeals`, `stageMissing` (deals.ts) |
| The timeline | `logActivity(db, input)` (idempotent with sourceKind/sourceId; moves "last contacted"), `timeline(db, orgId, target, options)`, `touchContacted`, `moveActivityTargets` (activity.ts) |
| Field history | `writeHistory`, `historyOf` (includes records merged in), `valuesAt`, `diffFields`, `diffCustom`, `newBatchId` (history.ts) |
| Bulk and undo | `bulkUpdate`, `bulkTrash`, `undoBatch`, `restoreToPoint` (bulk.ts) |
| Duplicates | `scanDuplicates`, `pendingDuplicates`, `resolveDuplicate` (dedupe.ts); `mergePeople`, `mergeCompanies`, `repointRelations` (merge.ts) |
| Custom fields | `addCrmField`, `updateCrmField`, `deleteCrmField`, `customFieldsFor`, `checkCustomValues`, `crmDatabaseIds`, `ensureCrmDatabases` (databases.ts) |
| Pipelines | `createPipeline`, `createPipelineFrom`, `updatePipeline`, `archivePipeline`, `saveStages`, `listPipelines` (pipelines.ts) |
| Role owners | `rolePositions(orgId)`, `ownerLabel`, `effectiveOwnerId`, `rolesHeldBy` (owners.ts) |
| Workspace mirroring | `mirrorWorkspace(db, orgId, { personId? })` (mirror.ts); strength: `recomputeStrength`, `touchpointsOf` (strength.ts) |
| Finance deals | `syncDealFromSponsorship`, `dropDealForSponsorship`, `companyForSponsor`, `sponsorshipsPipeline` (sponsor-sync.ts); `moveSponsorsIn` (sponsors.ts). Finance's `setSponsorshipStatus` now lives in `src/server/finance/sponsorship-status.ts` |
| Import and export | `createImportLog`, `startImport`, `runImportTurn`, `importRow` (import.ts); `previewConvert`, `convertDatabase` (convert.ts); `exportCsv` (export.ts) |
| Lists and pages | `listPeople`, `listCompanies`, `listDeals`, `todayList`, `parseListQuery` (queries.ts); `loadPerson`, `loadCompany`, `loadDeal` (records.ts); the record form: `personForm`, `companyForm`, `dealForm`, `saveForm` (forms.ts) |

Pure, client-safe helpers are in `src/lib/crm/`: templates, built-in
fields, dedupe scoring, merge plans, import mapping (with the vCard
reader), validation, strength, the record form's types and the tab list
(`nav.ts`: a later phase adds a tab by adding an entry).

### Jobs (`src/server/jobs/registry.ts`, handlers in `src/server/crm/jobs.ts`)

- `crm-refresh` (fast): mirror the workspace, recompute strength, look
  for duplicates; one step per turn, continuing itself. Enqueued at setup,
  after imports and bring-ins, for each new person (`p:{id}`), and nightly
  from `/api/cron/task-digest` (`scheduleCrmRefresh`).
- `crm-import` (heavy): a big import or bring-in, 60 rows a turn, each turn
  its own transaction, each row in a savepoint.

### Databases and Reports

- `src/server/databases/sources/crm.ts`: People, Companies and each
  pipeline as database sources with their custom fields as columns
  (filterable; not sortable, since Prisma can't order by a JSON path).
  `loadSourceFor` (sources/index.ts) builds them per definition; the
  database page and its export use it. A row opens the record's own
  fields (`src/server/crm/row-panel.ts`), saved through the same
  `saveForm` as the record page.
- Relation and AI fields for every database (`src/lib/databases/fields.ts`,
  `src/server/databases/relations.ts`, `src/components/databases/custom/`):
  links are `[{kind, id}]`, checked to exist in the organization; "Linked
  from", with sums and latest dates, on the linked record
  (`src/components/databases/linked-from.tsx`). AI fields keep their
  prompt, output and research switch; Fill is disabled until Phase 4.
- Reports read the CRM's databases like any database
  (`src/server/crm/reports.ts`): Stage is a choice field in stage order,
  won and lost counted as done.
- Tasks, notes and meetings link to CRM records through `ItemLink` kinds
  `crm-person`, `crm-company` and `crm-deal` (`src/lib/links.ts`), and the
  link lands on the timeline.

### Pages (`src/app/app/[orgSlug]/crm/`)

Today (follow-ups due, going cold, new from forms, stuck, no next step),
People and Companies (the Tasks bar, saved views, bulk edits with Undo,
the trash), each pipeline as a board (drag, counts and amounts, amber when
stuck, flagged with no next step, a reason on won and lost, what a stage
needs) and a table, record pages (fields, timeline, items, job history,
"Linked from", Linked, history with putting back, merge, trash), the
duplicates review, import (and turning a database into records), CSV
export (`/crm/export?kind=people|companies|items|timeline`) and settings.
Keys: j and k, Enter, x, n, /.

### Tests

`src/lib/crm/crm.test.ts` (pure logic), `src/server/crm/crm.db.test.ts`
(the core against the database, skipped without one), P-CRM-02 in
`prisma/rls/phases.mjs`, and the Relation and AI cases in
`src/lib/databases/fields.test.ts` and `src/server/databases/custom.db.test.ts`.

### Known gaps

- Hooks into the workspace are light: a new person mirrors at once, the
  rest waits for the nightly crm-refresh (or the next setup or import).
  Form submissions, RSVPs and check-ins don't enqueue a refresh themselves.
- The MCP database tools still read only built-in and club-made databases
  (`src/server/connectors/tools/databases.ts`); CRM tools are Phase 4.
- The CRM's custom columns don't sort in Databases.
- Remembered import mappings and import logs are CrmView rows (objectKind
  `import-mapping` and `import`), so no table was added; a dedicated
  import table would let an admin see everyone's imports.
- Role ownership resolves holders from the published chart; there is no
  handover step yet (Phase 2).
- A Finance deal's amount and date edited in the CRM need a finance role,
  as in Finance; its stage moves only through Finance's rules.
- The intake forms and starter report from setup come with Forms to CRM
  (Phase 2) and the CRM's own widgets (Phase 3).

## Phase 4 as built

AI, on `claude/crm-p4`. Every CRM AI call runs on the organization's own
key (or the local stand-in), checks the hard monthly cap, writes `AiUsage`,
and ends as a suggestion a person accepts; nothing is sent, and nothing a
person typed is overwritten, by AI.

### The review queue (`src/server/crm/review.ts`, `src/lib/crm/suggestions.ts`)

- Every AI change, automation proposal, connected-app write and
  email-sourced suggestion is a `CrmSuggestion`: kind, payload (zod per
  kind), the record it's about, a citation (meeting, email, form, file,
  transcript, conversation, card, web page, connected app, agent) and an
  assignee. Duplicates (`MERGE`) keep their own tab.
- The Review tab (`/crm/queue`, `CRM_TABS` entry `queue`, a count badge from
  `queueCount`): Waiting and Done, "For me", kind chips, a before and after
  per suggestion, Accept, Reject, Edit (drafts and tasks) and Accept all;
  Undo on anything accepted. An assignee gets a `CRM_REVIEW` notification
  (their Inbox).
- A suggestion about a record the viewer can't see (OWN access) is hidden
  from them; accepting runs as the reviewer under RLS, so it can never do
  more than they could by hand.

| For other phases | Call |
|---|---|
| Queue a change (any transaction, member or service path) | `proposeChange(db, { organizationId, kind, source, title, summary?, payload, target?, citation?, assigneeId?, proposedById? })`; an identical waiting one is returned instead |
| Apply one (history source `ai`, `connector`, `automation`...) | `acceptSuggestion(ctx, id, edits?)` |
| Say no | `rejectSuggestion(ctx, id)` |
| Accept several, one savepoint each | `acceptSuggestions(ctx, ids)` |
| Take one back (it waits again; only whoever accepted it) | `undoSuggestion(ctx, id)` |
| Read the queue as a viewer | `listQueue(db, orgId, viewerId, query)`, `queueCount` |
| Where every AI email goes (Phase 2's compose replaces its body) | `deliverDraft(db, input)` in `drafts.ts` |
| A promise as a task suggestion | `proposePromise(db, ...)` in `assist.ts` |

Accepting: `CREATE_PERSON` (with an optional timeline entry and next-step
task) and `CREATE_COMPANY` through `createPerson` and `createCompany`;
`UPDATE_FIELD` through `updatePerson`, `updateCompany` or `updateDeal` (an
allowlist of fields, custom ones as `custom.<id>`), recording the citation
in the record's enrichment; `MOVE_STAGE` through `moveDeal` (a stage that
needs fields says so); `LOG_ACTIVITY` through `logActivity`; `DRAFT_EMAIL`
as a DRAFT `CrmEmailMessage`; `CREATE_TASK` through the task service,
linked to the record by `ItemLink` (a follow-up also sets the record's next
follow-up). Undo: the batch Undo, the trash, the task deleted, the draft
removed.

### Metered calls (`src/server/crm/ai.ts`)

- `runCrmAi({ organizationId, userId, feature, request })`: the connection
  (`crmCredentials`: the org's Claude key, else its other model API, else
  Bananasplit AI when `BANANASPLIT_AI=1`, else the stand-in), 60 AI requests
  an hour per member and 400 per organization, the cap (`assertUnderCap`,
  on the service path so it counts everyone's spend), the call with no
  transaction open, one `AiUsage` row.
- `CRM_AI_JOBS`: each job's model size in one place (a small fast Claude for
  summaries, readings, Ask and AI fields; the org's chosen model for drafts,
  briefs and research). Prices come from the model list; the Batch API is
  half price.
- `claudeWebResearch` (Claude's own web search, schema-bound), and
  `createClaudeBatch` and `readClaudeBatch` for the Message Batches API.
- Prompts wrap everything members and contacts wrote as data (`dataRule`,
  `fenced`); no tools beyond web search for research.

### Email drafts: writing rules

Every AI-written email to a person follows one rule set,
`EMAIL_STYLE_RULES` in `src/lib/crm/email-style.ts` (33 short rules
distilled from the "humanizer" and "sepia" writing skills): one clear ask,
real dates, numbers and names from the timeline, nothing invented, the
sender's own voice (matching their past emails on the timeline) and first
name, plain words, no "I hope this email finds you well" openers or "Let me
know if you have any questions" closers, no em dashes, no stacked threes, no
significance claims or vague praise, plain text, short. `withEmailStyle`
appends them to a prompt; it is used by `draftSystemPrompt` (the record's
Draft a follow-up and the follow-up agent's check-ins, both through
`draftFollowUp`) and by the `crm_draft_email` tool's description, so a
member's own Claude gets the same rules.

The post-check is `emailTells`: a short list of the most obvious tells
(dashes, the opener and closer phrases, "reaching out", "don't hesitate",
a handful of AI words, "not just X, it's Y", "plays a vital role",
"lasting impact", "continued support", bracket or `{{ }}` placeholders,
markdown, emoji). `styleCheckedDraft` asks once more when a draft trips one,
naming them and passing the first draft back as data, and keeps whichever has
fewer; each try is its own `runCrmAi` call (cap, limits, an `AiUsage` row,
no transaction open), and a second try refused by the cap, a limit or the
model keeps the first. Tells that remain become a note for the sender. A
`crm_draft_email` draft is saved as written, and the tool's answer names any
tells for the app to fix. The stand-in's draft passes the check.

Workflow "owner reviews first" drafts are the organization's own templates
(no model), and describing an automation only picks templates by name, so
neither writes email text.

### Features

| What | Where |
|---|---|
| "Where we stand" (kept on the record), Draft a follow-up, Brief me, Meeting notes, Paste a chat, Enrich, Research, where values came from | `RecordAi` on every record page (`src/components/crm/ai/record-ai*.tsx`); `assist.ts` |
| Meeting and call notes: pasted, or a `.txt`, `.vtt`, `.srt` or `.md` transcript from Zoom, Meet, Teams or Granola; summary, objections, competitors, sentiment, facts, and promises as tasks | `readTranscript` |
| Paste any conversation (text or a screenshot): finds the person (email, phone, exact name) or suggests a new one, logs it, the next step as a task | `readConversation`, `PasteConversation`, `POST /api/orgs/{orgId}/crm/ai/image` |
| Card and badge scanning: a phone-first capture page | `/crm/scan`, `scanCard` (an email already in the CRM gets field changes instead) |
| Ask box (Today and Review): the model picks one allowlisted query, it runs as the member, the model answers from the numbered results, shown as links | `ask.ts`, `lookups.ts`, `CrmAiBar` |
| AI fields: Fill on a record, Fill empty and Refill all for a column, `options.auto` (when asked, new rows, every day, every week); citations in enrichment under `custom.<fieldId>`; a typed value gets a suggestion instead | `ai-fields.ts`, `AiFillButton`, CRM settings |
| Enrichment waterfall (`CrmSettings.enrichmentOrder`; by default Hunter, Prospeo, Tavily, Claude web search): empty fields filled with source and time, different values queued | `enrich.ts` |
| Research agent (Tavily, else Claude web search, else it stops and says why) and follow-up agent (drafts for people going cold, skipping anyone with a draft waiting), each with a run log | `agents.ts`; CRM settings, Agents |
| Data connectors: Tavily, Hunter and Prospeo cards (key as `OrgSecret`, test, credits used this month, remove) | `data-connectors.ts`; `DataConnectorsSection` on Integrations and apps |
| This month's use by feature and member, the hard cap (owners and admins), the waterfall's order, agents, AI fields, and a "Bananasplit AI (coming later)" note | `AiSettingsSection` on CRM settings; `usage.ts` |

Settings that needed no schema: agent switches are a CrmView row
(`objectKind` `ai-settings`), runs are CrmView rows (`agent-run`), Message
Batches in flight are CrmView rows (`ai-batch`), and a pipeline item's
enrichment (it has no column) is a CrmView row (`deal-enrichment`, one per
writer, merged on read).

### Your own Claude (MCP)

`src/server/connectors/tools/crm.ts` and `crm-writes.ts`, next to the
database tools, as the member under RLS, in a space that added the CRM:

- Read: `crm_search`, `crm_timeline`, `crm_not_contacted`,
  `crm_changes_since`, `crm_pipelines`; `fetch` opens CRM records (ids
  `crmperson:`, `crmcompany:`, `crmitem:`).
- Write (WRITE grants, 120 an hour per grant, audited, never delete or
  send): `crm_log_activity` and `crm_add_note` apply at once (low risk);
  `crm_create_person`, `crm_create_company`, `crm_update_record`,
  `crm_move_stage` and `crm_draft_email` wait in Review with the app as
  their source; `crm_build_list` saves a personal list.
- `list_databases` and `query_database` read the CRM's databases (built
  per definition with `loadSourceFor`); `add_database_record` points CRM
  databases at the CRM tools.

### Jobs

`crm-ai` (registry; handler `src/server/crm/ai-jobs.ts`): a column fill a
few rows a turn, a Message Batch poll every ten minutes, research on a new
record, the follow-up agent per owner, and the daily sweep
(`scheduleCrmAi`, from `/api/cron/task-digest`). A new person's
`crm-refresh` queues its automatic AI work (`queueNewRecordAi`). A job acts
as a member (`jobTx`) and stops if they've left; out of budget or with no
connection it stops quietly.

### Migration

`20261105130000_crm_ai`: `ItemLink_kinds_known` now names `crm-person`,
`crm-company` and `crm-deal`. Phase 1 added the kinds to `src/lib/links.ts`
but not to the constraint, so linking a task to a CRM record failed. No
tables, policies, grants or manifest entries.

### Tests

`src/server/crm/ai.test.ts` (prices and the batch discount, the model tier,
Claude faked through `aiClients`, the Batch API call, payloads and diffs,
the connector rule, the stand-in readers, AI field values, the waterfall,
Tavily and Hunter through `dataClients`), `src/server/crm/review.db.test.ts`
(accept and undo with history sources, a connected app's new person, the
assignee's notification, reject, a batch with one refused, OWN access, the
stand-in summary and transcript, the cap) and
`src/server/connectors/tools/crm.db.test.ts` (the tools against real roles
and through the MCP server).

### Not done, or not checked

- Real models, Tavily, Hunter and Prospeo were not called (no keys here):
  the stand-in and fakes cover the flows; Hunter's and Prospeo's response
  shapes are read defensively from their documentation.
- Granola, Zoom and Meet transcripts come in as uploaded files; pulling
  them from those apps waits on their integrations. Audio is Phase 5's.
- Suggestions reach the Inbox as `CRM_REVIEW` notifications to their
  assignee; a "To review" count in the Inbox itself is left to Phase 3's
  signals.
- AI fields fill on the CRM's databases only; organization-made databases
  keep the field type with Fill off.
- Credits used this month are read when a key is saved or tested.


## Phase 3 as built

Automation and numbers, on `claude/crm-p3`. What exists, where it lives,
and what's left.

### Schema

No new tables. `20261105120000_crm_automation`:

- the Inbox key check accepts `signal:<id>` (the CRM's signals are Inbox
  rows members snooze and finish);
- `ItemLink` gains an `app_service` INSERT policy and grant, pinned to the
  job's organization, so a workflow running in a job links the task,
  project or Finance item it made to the record (the grant matrix in
  `prisma/rls/phases.mjs` now reads `SID` for the service role);
- `ItemLink_kinds_known` learns `crm-person`, `crm-company` and `crm-deal`
  (Phase 1 had them in `src/lib/links.ts`, but the database refused them).

`app.security_manifest` is unchanged. Stored without new columns: the
learned model is a `CrmScoreRule` of objectKind `deals-model` (its JSON in
`condition`); a manager's forecast call is a `CrmForecastSnapshot` with
`periodLabel` `call:<period>`; signals are `CrmSuggestion` rows with source
`SIGNAL` (kind `CREATE_TASK`, `payload.key` raises each one once);
round-robin turns come from `CrmWorkflow.runCount`.

### Workflows (module 6)

- The model, pure and shared by the builder and the engine:
  `src/lib/crm/workflows.ts` (triggers, conditions on any field including
  `custom.<fieldId>`, the 14 step types, zod schemas, `triggerMatches`,
  `conditionsHold`, `loopAllows`, `underRunCap`, merge fields).
- The engine: `src/server/crm/workflow-engine.ts`. `crmEventJob`
  (events.ts) imports it directly, so it runs wherever jobs run. Each
  workflow runs in its own transaction as its acting member (its maker
  while still an owner, admin or CRM manager, else an owner), each step in
  a savepoint, with each step's outcome in `CrmWorkflowRun.log`.
- Loop protection: steps run inside `withAutomationScope` (events.ts), so
  the events their changes emit carry `workflowId` and `depth`. A workflow
  never fires on its own change, a chain stops 3 deep, and a workflow runs
  at most 5 times an hour on one record (one SKIPPED run says so). A job
  run twice runs each workflow once (the run keeps the job's key).
- Scheduled triggers (a date comes, nothing happens for N days, an item
  stuck past its stage's limit) run in the new `crm-daily` job, once per
  date, quiet spell or stage stay.
- Steps: `src/server/crm/workflow-actions.ts`. Tasks go through the Tasks
  service (`createTask`); a project is an epic with its tasks, the item's
  owner and its linked files; Finance items are drafts for money out and
  need a treasurer's automation for money in. Slack, Discord and webhooks
  are queued as `crm-workflow-call` jobs (`src/server/crm/workflow-calls.ts`;
  address rules in `call-url.ts`: https on 443, no IP literals or private
  names, every resolved address public, Slack and Discord only at their
  own hosts, a 10 second timeout, no redirects).
- **Rewire points for outreach (Phase 2)**, one function each in
  `workflow-actions.ts`: `sendTemplateAction` (today a `DRAFT_EMAIL`
  suggestion for the owner to review; nothing sends unreviewed),
  `enrollInSequenceAction` (an ACTIVE `CrmEnrollment` the sequence runner
  picks up; never someone unsubscribed or do-not-contact) and
  `inviteToEventAction` (a member joins the event's invitees; anyone else
  gets a `DRAFT_EMAIL` with the event).
- Recipes: `src/lib/crm/recipes.ts` (12, naming pipelines, stages and
  templates by reference, resolved when switched on; starter Welcome and
  Receipt templates are made when missing). Saving, switching and recipes:
  `src/server/crm/workflows.ts`.
- Describe it in words: `src/lib/crm/describe.ts` (schema, names mapped to
  ids, the stand-in's keyword reading) and `src/server/crm/describe.ts`
  (context and prompt), through `crmGenerate`, the monthly cap and
  `AiUsage`. With no AI connected it says what connecting one adds.
- UI: the Automations tab (managers only): `crm/automations` (the list with
  on and off, Recipes, Scoring) and `crm/automations/[id]` (the builder in
  `src/components/crm/workflow-builder.tsx`, Try it, run history).
  Actions: `crm/automation-actions.ts`.

### Reports (module 7)

The CRM's reports live in Databases > Reports, not in the CRM: People,
Companies and each pipeline are databases, so their reports are saved
reports on them like any other (arranged, shared, scheduled, kept).

- Ready-made reports (`src/lib/reports/crm-ready.ts`): Deals on each
  pipeline (Won, Still open, Won over time, By stage, By owner, By type),
  People (New people by month, Going quiet with Add to Power hour, By
  relationship, By owner) and Outreach on People (Sent, Reply rate,
  Replies by plan, Best day and time, Unsubscribes). Setup makes them
  (`ensureStarterReports`, then `src/server/reports/ready.ts`), once each:
  one already there, archived too, is left alone. Reports home lists the
  ones not made yet with Make this report, and the New report walkthrough
  offers them first; that's how organizations that had the CRM before get
  them (a saved report has a maker and counts toward the report limits,
  so they're not made behind anyone's back, and a deleted one doesn't
  come back on its own).
- The classics open Deals and People, right under Insights
  (`src/server/crm/report-classics.ts`): People talked to (different
  people who wrote back, took a call that connected or met with you, in
  the dates picked, and their share of People), Converted (of those, the
  ones who are a member, client or partner now, or have a won deal, or
  joined from a campaign: the count, the rate and the funnel Talked to >
  Interested > Converted, Interested being met, booked or on a deal) and
  Top issues (each person's `enrichment._issue`, the five most common with
  links to the people; grouped by exact text, then by meaning with the
  organization's AI on the report page when it has a key,
  `src/server/crm/issue-groups.ts`, cached a day).
- Access: the Deals tab's Report button and the old `/crm/reports`,
  `/crm/reports/deals/<pipeline>`, `/crm/reports/people` and
  `/crm/reports/outreach` links go to the matching report (made the
  first time if it isn't there), keeping the dates.
- The widgets (`src/lib/reports/crm-widgets.ts`, computed as the viewer in
  `src/server/crm/report-widgets.ts` and `report-ready-widgets.ts`, drawn
  in `widget-bodies.tsx`): the classics and the ready-made reports' cards
  above (their numbers from `src/server/crm/crm-reports.ts`, read once per
  report), plus people reached, reply rate, time to first reply,
  follow-ups overdue, relationships going cold, pipeline velocity,
  outreach by member, campaign progress, stage-to-stage conversion, time
  in stage, conversion by source, amounts raised by source, goals.
  `SourceSummary.crm` marks a CRM source. Each can add a sentence to the
  report's built-in Insights. They read the timeline, `CrmEmailMessage`,
  campaigns and field history directly, and say so when there's nothing
  yet.

### Forecasting and goals (module 8)

`src/lib/crm/forecast.ts` (quarters and years only; weighted, categories,
a trend once 20 items closed in the four quarters before; snapshot diffs;
attainment against an even pace), `src/server/crm/forecast.ts`,
`src/server/crm/goals.ts`. The Forecast tab (`crm/forecast`): per
pipeline, money or a count, everyone's or mine; members mark Commit, Best
case, Pipeline or Left out; managers save their own call; goals (a member
or the team, a quarter or a year); and how the forecast moved (weekly
snapshots from `crm-daily`, a line, and what changed since the week
before). Goals also show on the CRM's home and as a Reports widget.

### Scoring and signals (module 9)

- Rules (`src/lib/crm/scoring.ts`, `src/server/crm/scoring.ts`): field
  conditions, or behaviour within N days (replied, met, booked, attended,
  RSVPed, a form, a call, a payment), recomputed in pages by `crm-daily`
  and written straight to `score`; starter rules in one click.
- The learned model: logistic regression in TypeScript, trained nightly
  once 200 items have closed (at least 20 won and 20 lost), one in five
  held back to say how often it's right. Open items' scores become their
  chance of winning, with the top reasons on the item's page.
- Score is a sort on People, Companies and pipelines, a Databases column
  and a Reports field.
- Signals (`src/server/crm/signals.ts`): stuck, no next step, went quiet,
  renewal coming up, stopped coming, pledge overdue, back at events,
  outreach dropped. Raised once each by `crm-daily`, expired when their
  reason goes, shown in each member's Inbox under To review and counted
  in the sidebar.

### Setup

Each pipeline gets saved views (Stuck, No next step, Mine, Best scores,
shown above its board) and its ready-made Deals report; People gets the
People and Outreach reports (`src/server/crm/starter.ts`, "Reports").

### Jobs

`crm-workflow-call` (fast, after()-eligible) and `crm-daily` (fast, 60
seconds, continues itself; scheduled once a day beside `crm-refresh`).
`crm-event` takes `workflowId` and `depth`.

### Tests

`src/lib/crm/automation.test.ts` (matching, conditions, loop protection,
recipes, scoring, the regression, forecasts, describe-it),
`src/server/crm/call-url.test.ts`, and `src/server/crm/automation.db.test.ts`
(setup's views and reports; a recipe run end to end from a real stage
move; loop protection and the cap; a dry run; scores, signals, snapshots
and a widget against the database).

### Known gaps

- Webhook addresses are kept in the workflow's JSON, which every member
  can read through RLS (the Automations tab is managers only); they should
  move to `OrgSecret`. DNS is checked just before the call, so a host that
  rebinds between the check and the connect could still slip through.
- The starter templates' merge fields (`{{first_name}}`) are a guess;
  Phase 2's renderer decides.
- Phase 4's review queue should leave out `source: SIGNAL` rows. A signal
  marked Done stays PENDING in the table (hidden by the member's Inbox
  state) until it expires.
- A goal for "the team" means the whole organization (optionally one
  pipeline); there's no grouping of members into teams.
- Periods are calendar quarters and years by UTC dates, not the
  organization's time zone.

## Phase 5 as built

Phone, quotes and the API, on `claude/crm-p5`. Every provider is the
organization's own account; with none connected the CRM still works
(calls through the phone's own dialer, logged by hand).

### Schema

One migration, `20261105140000_crm_phone_api`, columns only (no table,
policy or function, so `app.security_manifest()` is unchanged):
`CrmSettings.phone` (provider, recording policy and notice, quiet hours,
calling hours, the voicemail to drop) and `CrmSettings.webhookEvents` (the
events some active webhook listens for, rewritten with every webhook
change, so a member's change can tell whether to queue an event without
reading `CrmWebhook`, which RLS keeps from members); on `CrmQuote`, `kind`
(quote or invoice), `taxBps`, `acceptedIpHash`, `declinedAt`,
`declineReason`, `paidAt` and `financeTransactionId`. Storage kind
`crm-audio` (private, org-scoped, purged with the org).

### Integrations (`src/server/crm/phone/connect.ts`, `.../integrations/phone-panels.tsx`)

A "Calls and texts" group with Telnyx, Twilio and Deepgram cards: keys as
`OrgSecret`s through the secrets module (owners and admins, audited, owners
alerted), tested at once, the number picked from the account's own list or
typed, and the webhook addresses to paste. Twilio's save also makes the
softphone's TwiML app and signing API key in the account; that key's
secret is the integration's second secret (kind `REFRESH_TOKEN`, the only
other slot). Telnyx needs the account's public key (webhook signatures)
and, for the browser, a credential connection id; the telephony credential
is made on first use. Members never read integrations: what the CRM needs
(which provider, the number, the settings) comes from `readPhoneStatus` on
the service path, non-secret only.

### Calls (`src/server/crm/phone/calls.ts`, `live.ts`, `inbound.ts`)

- Every call is one `CrmCall` and one CALL row on the timeline (sourceKind
  `call`, so the provider's events and the member's outcome update the
  same row); `call.logged` is emitted. Log a call (outcome buttons, length,
  notes, follow-up) on person, company and item pages
  (`src/components/crm/phone/phone-section.tsx`, one line on each page), on
  Today's "Calls to make", and between dialer calls.
- The softphone (`softphone.tsx`) loads `@telnyx/webrtc` or
  `@twilio/voice-sdk` only when a call starts; the token is minted on the
  server for that member. The browser names the call row, never a number,
  so a token can only dial who the CRM says.
- Recording only after the all-party notice: Telnyx speaks it on the call
  and starts recording on `call.speak.ended`; Twilio plays it to the person
  as they answer (`<Number url>`) and records from the answer. A recording
  without `recordingConsent` is never fetched. Owners and admins can switch
  recording off for good. Recordings are fetched into `crm-audio` by
  `crm-call-audio`.
- Voicemail drop: the organization records one in Phone settings; Leave
  voicemail plays it into the call through a ten-minute signed link and
  hangs up.
- The power dialer (`/crm/calls`) works down the follow-ups due or any
  saved view of people, skipping do-not-contact and people without a
  number, with the outcome between calls and a calling-hours hint.
- Provider webhooks: `/api/crm/phone/telnyx/{orgId}` (ed25519 over
  `timestamp|body`, five-minute window) and
  `/api/crm/phone/twilio/{orgId}/{voice|notice|status|recording|sms}`
  (HMAC-SHA1 of our configured URL and the form). Signature first, then a
  per-organization rate limit, then that organization only.

### Transcription and summaries (`src/server/crm/phone/jobs.ts`, `summary.ts`)

`crm-transcribe` writes out a recording or voice note on the
organization's Deepgram key (Nova, speakers labelled), then
`summarizeTranscript` sums it up into notes and next steps through
`src/server/crm/ai.ts` (the monthly cap is checked first; usage metered).
Without AI the transcript still lands; without Deepgram nothing is sent.

### Voice notes (`voice-note.tsx`, `/api/orgs/{orgId}/crm/audio`)

Recorded in the browser (up to ten minutes, under the 4 MB upload cap),
the type taken from the bytes, stored in `crm-audio`, one NOTE row with
the audio on the timeline. Without Deepgram it says so and stays audio.
The same route plays recordings back after reading the row as the member.
CRM pages get `microphone=(self)` (`CRM_MIC_SOURCES`,
`src/lib/security/csp.ts`); connect-src gains the softphones' hosts.

### Texting (`src/server/crm/phone/texts.ts`)

Two-way SMS on the organization's number: the action writes the text and
its TEXT row, and `crm-text-send` sends it through the SMS module
(`sendOrgSms`: live in production, the sink locally and on previews).
Consent is required before the first text and records how it was given
(`CrmPerson.consent.text`); do-not-contact always wins; quiet hours hold a
text until they end. Incoming texts match the person by the last ten
digits; STOP sets consent off and do-not-contact on, START turns texting
back on (and clears only the do-not-contact a STOP set), HELP is logged.
The providers send the carriers' required replies themselves.

### Quotes and invoices (`src/server/crm/quotes.ts`, `quote-pdf.tsx`)

On an item, a company or a person: lines in cents, tax in basis points,
currency, notes, valid-until (due on an invoice), numbered per kind
(Q-0001, INV-0001) under a transaction-scoped advisory lock. Send makes
`/q/{orgId}.{secret}` (only the hash is kept; sending again makes a new
link). The recipient reads it in the organization's theme, downloads the
PDF (react-pdf, the org's colour and logo), and accepts by typing their
name (name, time and a hash of the IP with the org are kept) or declines;
past its date it can't be accepted. Acceptance moves the item to its first
won stage through `moveDeal` (a Finance deal still moves only through
Finance's rules). Copy, make an invoice from a quote, move to another
item, and mark paid (a finance role can book it as Finance income in the
active period, audited).

### Public API (`src/server/crm/api/`, `/api/crm/v1/...`)

People, companies, items, activities (read and write) and pipelines with
stages (read): list with cursor pagination and filters, get, POST, PATCH,
`trashed: true|false` instead of delete. `Authorization: Bearer
bsk_{orgId}.{secret}`; keys stored as SHA-256 with a short prefix, read or
read-and-write, last used, revoke. 300 requests a minute per key, 60 of
them writes; bad keys limited per IP. Each request is one service
transaction in the key's organization, as the organization (no member;
history source `api`). JSON errors; OpenAPI at `/api/crm/v1/openapi.json`;
a how-to on CRM settings, API keys.

### Outgoing webhooks (`src/server/crm/webhooks/`)

Events person.created, person.updated, company.created, deal.created,
deal.stage_changed, deal.closed, activity.logged, call.logged. The listener
is registered on the CRM event bus with `onCrmEvent` (like the workflow
engine), and `emitCrmEvent`'s guard now also queues when
`CrmSettings.webhookEvents` names one of the event's possible webhook
events. `logActivity` emits `activity.logged` for new rows that aren't
mirrored from the workspace. Each delivery is a `CrmWebhookDelivery` and a
`crm-webhook` job: JSON, `X-Bananasplit-Signature: t=..,v1=HMAC-SHA256(t.body)`,
https only, private and reserved addresses refused at connect (DNS
rebinding included), no redirects, a ten-second timeout, eight tries with
backoff (a 4xx stops it). Send test, the delivery log, and show or rotate
the secret on CRM settings, Webhooks. Local receivers: `http://localhost`
only off production, or with `CRM_WEBHOOKS_ALLOW_LOCAL=1` off Vercel.

### Settings and tabs

CRM settings links to Phone, API keys and Webhooks (owners and admins).
Tabs Calls and Quotes (`src/lib/crm/nav.ts`).

### Tests

`src/lib/crm/phase5.test.ts` (STOP words, consent, quiet hours, numbers,
quote totals, numbering, tokens, typed signatures),
`src/server/crm/phase5.test.ts` (Telnyx and Twilio signatures, API keys
and pagination, webhook signing, the SSRF guard, providers behind
`phoneHttp`), `src/server/crm/phase5.db.test.ts` (the API end to end, the
quote flow to won, STOP and START, webhook queueing).

### Not finished or not verified

- No real Telnyx, Twilio or Deepgram call was made (no keys here): the
  softphone, recording, voicemail drop, provider webhooks and transcription
  follow the providers' documented APIs and are tested only behind the
  seam. In particular, whether Telnyx's `speak` on a WebRTC call reaches
  both parties needs checking on a real account.
- Inbound calls to the organization's number aren't routed to members'
  browsers (outbound only).
- Audio in `crm-audio` doesn't count toward storage used.
- Texts from numbers not in the CRM are listed on Calls but can't yet be
  turned into a person in one click.

### Later (notes only)

The learned scoring model, Stripe (a payment closing an item), support
inbox and chat, a native app, predictive dialing (a gap we accept), and
e-signatures beyond a typed name.


## Phase 2 as built

Reaching out, on `claude/crm-p2`. Everything lives in `src/server/crm/outreach/`
(server), `src/lib/crm/outreach/` (pure, client-safe, tested in
`outreach.test.ts`) and `src/components/crm/outreach/`; actions are in
`src/app/app/[orgSlug]/crm/outreach/actions.ts` (`outreachAction`, the same
contract as Phase 1's `crmAction`).

### Schema

No tables changed. Migration `20261105110000_crm_outreach` adds two
SECURITY DEFINER lookups for the public side, both service-role only (RLS
cases P-CRM-03 and P-CRM-04; both are in `tests.mjs`'s definer list):

- `app.crm_public_target(kind, key)`: which organization and row a public
  key opens, ids only: `booking` (slug of an active page), `guest` (hash of a
  live, unexpired link), `self` (hash on a person not in the trash), `bcc`
  (a member's BCC token), `track` (an email's tracking token, which is also
  its `reply+{token}@` address).
- `app.crm_booking_busy(page)`: the busy cells (never rules or labels) of a
  booking page's hosts who are still members, only in that page's own
  organization context.

It also widens the `InboxItemState_itemKey_known` check to allow `crm:` keys
(the follow-up queue's rows, snoozed from the CRM's home or the Inbox alike).
`app.security_manifest()` was not redefined. Kept without a table: owner
routing is a `CrmView` row (`objectKind` `routing`); a campaign's form is in
its `channel` (`form:{formId}`); a bulk send is a campaign with `channel`
`bulk`.

### Email out: one function

`sendFromMailbox` (`mailbox.ts`) is the only way CRM mail leaves. Today it
sends from the organization's own verified Resend sender ("Ada at Robotics
Club" <hello@robotics.org>), or, for one-to-one and sequence mail, the
platform sender on the organization's behalf. Bulk mail refuses the platform
sender. `memberMailbox()` is the seam for the email connections project: it
returns null now; when it returns a member's Gmail or Outlook, every caller
sends from it unchanged. `EMAIL_DELIVERY` applies (locally, the sink).

`queueEmail` (`send.ts`) writes the message (`QUEUED`), its pending timeline
row (private to the sender until it goes) and a `crm-send` job. The job
(`deliver`) checks do-not-contact, unsubscribes, bounces and the daily cap
again, renders it (a tracking pixel at `/api/crm/t/{token}/o`, links through
the signed redirect `/api/crm/t/{token}/c`, the member's signature, and for
sequence, campaign and bulk mail a footer plus `List-Unsubscribe` and
`List-Unsubscribe-Post`), sends it outside any transaction, and marks it
`SENT` with its timeline row. Opens are shown as approximate; replies,
clicks and bookings lead. `src/server/email/transport.ts` gained optional
`headers`.

### Email in: one function

`ingestEmail(source, message)` (`inbound.ts`) takes every way in: `bcc`
(log+{token}@{CRM_INBOUND_DOMAIN}), `reply` (the Reply-To of mail we sent)
and later `gmail`, `outlook`, `imap`. It dedupes on Message-ID, threads by
In-Reply-To and References, matches people by address and companies by work
domain, logs only mail with known people or company domains, respects the
mailbox's share mode (NONE logs nothing, METADATA who and when, FULL the
message) and never-log list, suggests unknown people from their signature as
`CrmSuggestion` rows (Outreach, Your mail: Add or Dismiss), pauses sequences
on an out-of-office until the return date, stops them on a real reply (and
marks the campaign, tells the member with `CRM_REPLY`, emits
`email.replied`), and on a bounce flags the address
(`consent.email.bounced`), stops sequences and emits `email.bounced`.

`/api/crm/inbound` takes the parsed message from a Cloudflare Email Worker,
with `Authorization: Bearer {CRM_INBOUND_SECRET}` (24 characters or more).

**Setup, once per deployment.** The Worker lives in the repo at
`workers/crm-inbound/` (`src/index.js`, `package.json` with `postal-mime`,
`wrangler.toml` with a placeholder `INBOUND_URL` and no secrets). Its
README has the exact steps: add the domain to Cloudflare, turn on Email
Routing, deploy the Worker (`wrangler secret put INBOUND_SECRET`, set
`INBOUND_URL` to `https://<app>/api/crm/inbound`), point the catch-all rule
at it, then set `CRM_INBOUND_DOMAIN` (for example `in.bananasplit.app`) and
`CRM_INBOUND_SECRET` (the same value) on the app. The folder is outside the
app's TypeScript, lint and tests. The Worker accepts mail the app took or
can never take (2xx, 400, 413) and rejects the rest (a wrong secret, 429,
503, 5xx), so a bad setup bounces mail back to the sender instead of
losing it. `src/app/api/crm/inbound/route.db.test.ts` drives the route the
way the Worker does: a reply that stops a sequence, a bounce, and requests
without the secret.

Without `CRM_INBOUND_DOMAIN`, Reply-To is the member's own address and no
BCC address is offered.

### The queue, cadences, the Inbox

`followUpQueue` (`queue.ts`) gives one row per person with every reason (a
reply waiting, a sequence step, a follow-up due, new from a form or a
booking, your campaign share, keep-in-touch lapsed, going cold), mine or
everyone's, less what the viewer snoozed. It is the first card on the CRM's
home (`QueueSection`), with email, text (disabled until Telnyx or Twilio is
connected; then an `sms:` link), call (`tel:`, then the log dialog), log and
snooze; and the member's Inbox rows (kind `crm`, `inbox.ts`; cold and
cadence rows stay on the home). Keep in touch per person (the person page)
or for a whole list (Campaigns, with Undo). The daily `crm-outreach-daily`
job (`daily.ts`, queued by `/api/cron/task-digest`) brings lapsed cadences
back by setting their follow-up to today, writes campaign conversions and
expires old mail suggestions.

### Templates, sequences, campaigns, bulk

- Merge fields (`src/lib/crm/outreach/merge.ts`): person, company, history
  (last event, events attended, last talked, last gift) and the sender, with
  fallbacks (`{{first_name|there}}`); every send is previewed first.
- Sequences: email, to-do, call, LinkedIn and text steps; delays; a send
  window in the organization's timezone; the per-mailbox daily cap
  (`CrmSettings.dailySendCap`, set in Settings); stop on reply, booking,
  unsubscribe, bounce and do-not-contact; one `crm-sequence` job per step.
  Steps other than email become open `SEQUENCE_STEP` rows in the sender's
  queue with a `CRM_FOLLOW_UP` notification (not Tasks: the task service
  needs a member session, which a job doesn't have).
- Lists are people views (`lists.ts`). Campaigns (`campaigns.ts`) take a
  list, a goal, a due date and a way in (a template, a sequence, an event's
  RSVP page, a form, calls), split it among members (owners first), notify
  each (`CRM_ASSIGNED`), and count contacted, replied, booked and converted
  (an RSVP to its event, an answer to its form, or an item won). Members
  preview and edit each message of their share and send from their own
  mailbox; anyone moves people between members or splits what's left again.
- Bulk email (`bulk-email.ts`): owners, admins and CRM managers; the sender
  check (the organization's own domain verified in Resend, which means SPF
  and DKIM) must pass; up to 2,000 a send, merged per person at send time,
  sent 25 a turn by the heavy `crm-bulk` job.

### Booking, forms, handover, partners, self-update, giving

- Booking pages (`booking.ts`, `/book/{slug}`): the hosts' busy hours plus
  the meetings they're in or host, weekdays 9 to 5 in the organization's
  timezone, notice and days ahead, round-robin by recent bookings. A booking
  makes a Bananasplit meeting, finds or adds the person, logs the meeting
  with the same `event` source the mirror uses, optionally opens an item,
  stops sequences that stop on booking, marks campaigns booked, notifies
  the host, confirms to the guest and emits `meeting.booked`.
- Forms to the CRM (`intake.ts`, called from `/f/{slug}` after each answer):
  the form's Settings set the destination (a person, or a person and an
  item, with each question matched to a field), deduped on email, filling
  only empty fields, the answers on the timeline, and routing (CRM Settings:
  in turn, or rules then in turn) with `CRM_ASSIGNED`; emits
  `form.submitted`. Share has an embed snippet: a button that opens the form
  in a small window (forms can't be framed: every page sends
  `X-Frame-Options: DENY`).
- Handover (`handover.ts`, `/crm/handover`): `memberLeft` runs from
  `untieDepartingMember` (pauses their sequences, takes them off booking
  pages, tells managers with `CRM_HANDOVER`); `chartHoldersChanging` runs
  in the chart's publish (tells a position's new holder, or the managers
  when nobody holds it); a manager hands one member's people, companies,
  items, campaign shares and sequences to a member or a position in one
  step; a brief per contact; everyone with no owner, a departed owner or an
  open position, given an owner in one step.
- What we owe them (`partners.ts`): deliverables on an item, optionally a
  Task (a finished task counts as delivered), and guest links (`/g/{token}`,
  the hash stored, derived so it can be copied again, revocable) showing the
  agreement, the promises and a recap from the events linked to the item or
  its company (their check-ins and sign-ups).
- Self-update (`self-update.ts`, `/c/{token}`): name, email, title,
  workplace and phone, written to field history; offered in RSVP
  confirmations (`registered`, `promoted`) and form receipts when the person
  is in the CRM; members turn it on or off on the person page.
- Giving (`giving.ts`): Finance income whose counterparty is the person or
  their company (finance roles only, as in Finance), won items in donor,
  grant and deal pipelines, recurring when the same payer gives at a
  steady interval, and hours at events from their check-ins.

### Never step on each other

`conflictFor` (`send.ts`): another member emailed, called, met or texted
them in the last two weeks, has them in a sequence, or has them in their
campaign share. Compose and enrolling ask first; the person page shows who
owns them, who talked to them last, and the warning.

### Pages

Outreach (Templates, Sequences, Booking pages, Bulk email, Your mail),
Campaigns (lists and campaigns), Handover; sections on the person, company
and item pages and on the CRM's Settings; the queue on the CRM's home and in
the Inbox; public `/book`, `/g`, `/c` and `/u` (unsubscribe, one button;
`/api/crm/u/{token}` takes the one-click POST). Every public route finds its
organization first and is rate-limited.

### Jobs

`crm-send` (fast), `crm-bulk` (heavy), `crm-sequence` (fast) and
`crm-outreach-daily` (fast, once a day).

### Tests

`src/lib/crm/outreach/outreach.test.ts` (pure),
`src/server/crm/outreach/outreach.db.test.ts` (sending, conflicts, a reply,
an out-of-office, a bounce, unsubscribing, a sequence step, a booking,
cadences, a handover with its brief, guest and self-update links), and
P-CRM-03 and P-CRM-04 in `prisma/rls/phases.mjs`.

### Known gaps

- Gmail, Outlook and IMAP are the email connections project; their
  `ingestEmail` sources and `memberMailbox` are ready for it.
- Booking reads the hosts' Bananasplit availability and meetings, not their
  Google free/busy, and uses fixed hours (weekdays 9 to 5).
- Sequence to-do steps are queue rows, not Tasks.
- The sidebar's Inbox count doesn't include CRM rows yet (the Inbox does).
- Texting is a disabled button (or an `sms:` link once a phone provider is
  connected); Phase 5 builds it.
- AI drafts aren't in compose (Phase 4).

## Integration as built

The five phases wired together on `claude/crm`. Where two phases had each
written the same thing, one stayed and the other now calls it.

### Hand-offs

| What | Now |
|---|---|
| AI drafts | `deliverDraft` (drafts.ts) saves an unsent DRAFT `CrmEmailMessage` for the person (`saveDraft` in outreach/send.ts, `CrmEmailMessage.personId`). The member who asked sees it in compose at once, on its preview; an agent's or a connected app's also waits in Review, where Open in compose picks up the same draft. Sending it (`composeEmail` with `draftId`) discards the draft and marks the suggestion accepted. Drafts are never sent by anything but a member's Send. |
| Workflow email | `sendTemplateAction` and `inviteToEventAction` render with outreach's merge renderer (`renderFor`) and go through `queueEmail` and `crm-send` from the record owner's name: do-not-contact, unsubscribes, bounces, the daily cap (`CrmEmailMessage.workflowId` counts) and waking hours (`AUTOMATION_WINDOW`, 8 AM to 9 PM any day, the organization's timezone) all apply, with the unsubscribe footer. A step set to "Owner reviews first" (`params.review`) leaves an unsent draft and a Review suggestion instead. Invites to people outside the organization email the event's RSVP link (outreach's `inviteLink`). |
| Workflow sequences | `enrollInSequenceAction` calls outreach's `enroll` from the owner's mailbox, conflicts respected. |
| Starter templates | One list, `src/lib/crm/outreach/starters.ts`, in outreach's merge fields (`{{first_name|there}}`, `{{my_first_name}}`); Outreach makes the everyday three, a recipe makes the one it names. |
| Merge renderers | One syntax and one renderer: outreach's `renderMerge`. Emails use its person fields; workflow text (task titles, notices, Slack and Discord, Finance descriptions, project names) uses the same `{{field}}` / `{{field\|fallback}}` syntax over the record's fields (`WORKFLOW_MERGE_FIELDS`: name, title, company, stage, pipeline, amount, owner, days, link, workflow). See "Gaps closed". |
| Sequence steps | To-do steps make real Tasks (as the sequence's maker, else the sender, owned by the sender, linked to the person, due that day), through the Tasks service in a system transaction (`actAs`, system-actor.ts, which the workflow engine uses too). Text steps send through Phase 5's `queueText` when the person agreed to texts; otherwise, and for calls and LinkedIn, an open step waits in the sender's queue saying why. Call steps are on the dialer and Calls to make (`openCallSteps`), first; logging the call (`logCall` with `stepId`) closes the step. |
| The queue's buttons | Text opens Phase 5's thread in a window (`TextDialog`, `textThreadAction`); Call is Phase 5's softphone or the phone's dialer then Phase 5's call log (`CallPerson compact`). Phase 2's own call logger is gone; "Call and log" on the person page is gone (the Calls section has it). |
| One review queue | Email-sourced new people are `CREATE_PERSON` suggestions with Phase 4's payload (`proposeChange`); Outreach, Your mail lists them filtered (`listQueue` with `source: "EMAIL"`) and accepts through `acceptSuggestion`. Signals (`source: SIGNAL`) stay out of Review (`REVIEW_WHERE`); they're the Inbox's To review rows. |
| Inbox | The sidebar count adds the member's follow-up queue rows and one `crm:review` row for Review suggestions assigned to them (`crmReviewRow`), less what they snoozed or finished; the Inbox lists the same row and Home's Today strip reads the same count. |
| Refresh timing | Form answers (`formToCrm`), RSVPs (`registerGuest`), a member's own RSVP (`setOwnRsvp`) and check-ins (`setRegistrationCheckIn`) call `queueCrmRefreshFor`: a `crm-refresh` keyed by the source (`m:response:{id}` and so on, so a burst merges into one pending job) that finds the people on the service path and mirrors only their timelines. |
| Finance deals | A new item in the Deals pipeline makes its Finance partner (from the company) and deal through Finance's `createSponsorshipRecord` (also Finance's own action), in the active period, at the stage's status. It needs a finance role, a company and an amount. |
| Custom columns | Sort in Databases: by number, date, choice order or text, up to 5,000 rows ordered in memory, then just the page loaded (keyset export too). |
| Workflows private | Migration `20261105160000_crm_workflows_private`: `CrmWorkflow` and `CrmWorkflowRun` are readable only by owners, admins and CRM managers. A member's change knows whether to queue an event from `CrmSettings.workflowTriggers` (kept by every save, switch and delete). RLS P-CRM-05 and P-CRM-06. Nothing member-facing reads workflows (the Automations pages are managers only). |
| Outgoing calls | Slack, Discord and webhook steps use the outgoing webhooks' guarded transport: the address is checked in the connection's own DNS lookup, so it's the address connected to. One blocked-address list. |
| Time zones | Forecasts count a close on its day in the organization's timezone; goals count over their period's local days; signal dates and the renewal year too. |
| Unknown texters | Calls lists one row per number not in the CRM with Add as person: their texts move onto the new person's timeline (a STOP among them is kept). |
| Booking hours | A host who set their availability is bookable whenever it doesn't say they're busy, 8 AM to 11 PM any day; one who never set it, weekdays 9 to 5. One-off dates hold too (see "Gaps closed"). |

### "That change is not allowed" on forms

Not the CRM's: `src/lib/pins/pages.ts` has had "form" in `PIN_KINDS` since
forms got their own titles in Recently visited, but the `Pin_kind_known`
and `RecentVisit_kind_known` checks never learned it. Opening any form page
recorded the visit, the check refused it (23514), and the page's visit
action failed with "That change is not allowed." (pinning a form did too).
`Form.crmDestination` was fine: `Form`'s grants are table-wide.

### Migrations

`20261105160000_crm_workflows_private` (policies, `CrmSettings.workflowTriggers`
with a backfill), `20261105170000_crm_integration` (`CrmEmailMessage.workflowId`
and `personId`, an index) and `20261105180000_pin_form_kind` ('form' in the
Pin and RecentVisit kind checks). Then `20261105190000_crm_thread_delete`
(the thread DELETE policy, and `app.security_manifest()` without
`CrmEmailThread:DELETE` in its allowlist) and
`20261105200000_crm_booking_dates` (`app.crm_booking_busy` returns dates).

### Found and fixed in the browser walkthrough

The story ran end to end on the seeded organization: an interest form
answered on `/f` made the person; the "Someone fills in the interest form"
recipe added the item, gave it an owner, queued the welcome (in waking
hours; it landed in the mail sink), set the follow-up and made the task; a
reply posted to `/api/crm/inbound` stopped the sequence and showed on the
timeline; the stand-in summed the person up and drafted a follow-up into
compose; the quote was accepted on `/q` and the item moved to Joined (won).
On the way:

- A workflow's later steps didn't see the owner an earlier step assigned,
  so "a task for the owner" was refused ("Every task needs an owner") and
  the welcome went from the wrong member; the run log said only "Something
  went wrong" for the Tasks service's own refusals.
- Adding a texter as a person failed for members (the timeline rows had no
  maker, which their row rules require).
- Email that came in read as "Email, {member}" on the timeline; it now says
  "Email in, to {member}".
- The quote's "Email it" was a `mailto:`; it opens compose now, so it's
  tracked and on the timeline.
- The public quote had its status and number as a label above the title.
- The booking page editor and Your mail spilled past a phone's width; every
  two-column grid on the CRM's pages now keeps to it.
- Report source cards cut database names off; CRM rows in Reports now carry
  "Added", so suggested counts don't read an Expected date most rows lack.
- Enter didn't make a new sequence; signature and merge-field examples named
  a club.

### Gaps closed

- **Booking honors one-off dates.** A host's availability stores one-off
  dates as "One date you can't make" rules (all day, or some hours), in
  `UserAvailability.rules`; there are no "available instead" overrides.
  Migration `20261105200000_crm_booking_dates` makes `app.crm_booking_busy`
  also return `dates` (upcoming date rules as `{date, start, end}`, never
  the label). `bookingSlots` drops a host's all-day date entirely and,
  for a ranged one, the hours it covers that date on top of the weekly
  busy cells; other hosts on the page stay bookable. P-CRM-03 covers the
  function; `src/lib/crm/integration.test.ts` and
  `src/server/crm/integration.db.test.ts` the slots.
- **Workflow text uses the emails' merge fields.** `renderMessage`
  (src/lib/crm/workflows.ts) renders through `renderMerge` with the
  workflow's own field list. Old `{name}` tokens are translated at read
  time (`readWorkflow`, `toMergeSyntax`; only the workflow's own keys, so a
  literal `{draft}` stays) rather than by a data migration, and rewritten
  as `{{name}}` on the next save; saving refuses an unknown field. Recipes,
  the describe-it defaults and prompt, and the builder (its hint and an Add
  a field menu on each text) use `{{...}}`.
- **Deleting an email thread is for owners, admins and CRM managers.**
  Migration `20261105190000_crm_thread_delete` narrows `CrmEmailThread`'s
  app_user DELETE policy and redefines `app.security_manifest()` without
  `CrmEmailThread:DELETE` in the tenant-only allowlist (the policy names
  `is_org_admin`, so it isn't a tenant-only write; T27i dropped it too).
  No screen deletes a thread; discarding a draft and undoing an accepted
  draft still work for members, marking the draft discarded when the
  thread can't go (`dropThread`, send.ts). RLS P-CRM-07.
- **Forms' interest template** asks "How did you hear about us?" (a friend
  or colleague, one of our events, social media, our website, email or a
  newsletter, Other) instead of a school year; the application asks for
  "Your email", response notes say "owners and admins only", and the
  responses assistant's prompt and a CRM mailbox example no longer say
  student, officers or club.

### Still open

- The person and item pages render slowly in a background browser pane (the
  server answers in about a third of a second; the reveal waits on the
  pane), so hidden-pane screenshots are unreliable. Visual checks were done
  at desktop and phone width on Today, People, a person, Calls, booking and
  the public pages.
- Outside the CRM and Forms, school wording remains in starter content:
  the Databases templates (`src/lib/databases/templates.ts`, a "First
  year" option) and the availability editor's examples ("Midterm", "a
  class, a lab").

### Tests

`src/server/crm/integration.db.test.ts`, `src/server/forms/forms.db.test.ts`,
`src/lib/crm/integration.test.ts`, `src/server/databases/sources/crm-sort.test.ts`,
`src/lib/crm/automation.test.ts`, `src/server/crm/automation.db.test.ts`,
`src/lib/forms/forms.test.ts`, and P-CRM-03, P-CRM-05, P-CRM-06 and
P-CRM-07 in `prisma/rls/phases.mjs`.

## Deals, not sponsorships

Bananasplit is for organizations (companies, nonprofits, teams), and
professional CRMs (HubSpot, Pipedrive, Zoho, Attio, Twenty) call money a
partner commits a **deal** moving through a pipeline of stages. So
everything people read says deals and partners:

- The ready-made pipeline is **Deals** (items are deals, "New deal"), and
  the setup answer reads "Partners and deals". Its template id stays
  `sponsors` (`CrmPipeline.template`, recipes' `@pipeline:sponsors`).
- The "Sponsor contact" relationship type is gone: the same answer already
  made **Partner**, and Finance's synced contacts are tagged `partner`.
- Finance › Deals is at `/finance/deals`; `/finance/sponsorships`
  redirects there (a permanent redirect, so old links and pins work).
  A Sponsor row is a **partner** on screen, a Sponsorship row a **deal**,
  and the `SPONSORSHIP` transaction kind reads "Deal". A CRM item in the
  Deals pipeline makes its Finance deal.
- What we owe them stays: promises and deliverables, on any deal or
  partnership. The "A new sponsor commits" recipe is "A partner commits to
  a deal"; the "Sponsorship ask" starter email is "Partnership ask".

What keeps its old name, on purpose: the `Sponsor` and `Sponsorship`
models and tables, `SponsorshipStatus` and `SponsorshipType`, the
`SPONSORSHIP` transaction kind, the finance audit actions
(`SPONSORSHIP_CREATE` and so on), the `sponsorships` plan feature and
Finance widget keys, the `sponsor` search hit type, and the server files
(`sponsorships-actions.ts`, `sponsorship-status.ts`, `sponsor-sync.ts`).
All are stored or keyed values nobody reads; renaming them would need a
schema migration and buy nothing on screen. Finance's spreadsheet import
still recognizes "sponsor" in a sheet as a deal.

Migration `20261105210000_crm_deals_not_sponsorships` (data only, no
schema or security change) renames pipelines and their databases still
called "Sponsorships", turns "sponsor" people into "partner" (and folds the
type into Partner in each organization's relationship types, views,
workflow conditions and score rules), and renames the untouched starter
email and recipe workflow.

## Redesign

The CRM is two tabs now (see "One list" below): Today (`/crm`) and People
(`/crm/people`, with People, Companies and Board as its view switch),
plus Settings (the round button in the header) and Setup. Deals and
Outreach were tabs until 2026-11-03. Reports are in Databases > Reports
("Reports (module 7)"). `src/lib/crm/nav.ts` holds the two tabs; People
stays lit on the older pages it now holds (`also`) while they redirect.

Every CRM tab page is laid out like Tasks: `CrmHeader` (the "CRM" title,
the split create button New person with New company, New deal and Import a
spreadsheet in its menu, then the round settings button) with a
`CrmToolbar` under it (the tab switch, the page's round buttons, Filters
holding every picker, a spacer and the search pill). No stat strips.
Both live in `src/components/crm/chrome/`.

Buttons on rows and cards are ambient buttons
(`src/components/ambient/ambient-button.tsx`): they show only when the
state calls for one, do the job in place, say why on the same line, leave
when it's done, and there are at most two on anything.

### The overlay contract

Whatever opens (a person, company, deal, Power hour, Done on its own, Ask,
New, a goal) opens as one kind of centered card over the page you're on,
named by one search param (`src/lib/crm/overlay.ts`):

| `?open=` | Card |
| --- | --- |
| `person:<id>`, `company:<id>`, `deal:<id>` | the record |
| `power` | Power hour |
| `log` | Done on its own |
| `ask` | Ask |
| `new:person`, `new:company`, `new:deal` | New |
| `goal`, `goal:<id>` | a goal (not built yet) |
| `merge:<idA>,<idB>` | Merge two people (or two companies) |

| `plan:sequence:<id>`, `plan:campaign:<id>` | a follow-up series, a split list or a group email |
| `plan:email`, `plan:split` | a new one-email or split-a-list plan |

- **Opening and closing.** `useCrmOpen()` (client) gives the open card,
  `hrefFor(open)`, `setOpen(open)` (a push, so Back closes it) and
  `close()` (a replace that removes `open` and keeps the rest of the URL).
  Rows link with `hrefFor`, so a card opens over the list you had.
- **Record links.** `crmRecordHref(orgSlug, kind, id)` is for links from
  outside the CRM: `/crm/people?open=person:<id>`,
  `/crm/people?view=companies&open=company:<id>`,
  `/crm/people?view=board&open=deal:<id>`; `crmPlanHref` is
  `/crm/settings/automations?open=plan:<type>:<id>`. Inside the CRM, `useCrmRecordHref(orgSlug)`
  sets `open` on the current page when it renders overlays
  (`rendersOverlays`), else falls back to `crmRecordHref`. The old
  `people/[personId]`, `companies/[companyId]` and `items/[itemId]` pages
  redirect to those URLs.
- **Rendering.** Each page that shows cards renders, once, after its own
  content: `<CrmOverlays shell={shell} orgSlug={orgSlug} searchParams={sp} />`
  (`src/components/crm/overlays/crm-overlays.tsx`, a server component). It
  parses `open`, loads that card's data in its own transaction and renders
  it, keyed by the `open` value. Add the page's path to `rendersOverlays`
  when it starts rendering them.
- **Adding a card kind.** Write a server loader taking
  `OverlayProps<"kind">` (`shell`, `orgSlug`, `open`, `searchParams`) that
  returns a client card, and add it to `CRM_CARDS` in
  `crm-overlays.tsx`. A kind with no entry opens nothing.
- **The frame.** Cards are built on `CrmCard`
  (`src/components/crm/card/crm-card.tsx`): Tasks' task dialog at 680px
  with a fixed header (`DialogHead`, the header every centred popup shares:
  `avatar`, `title` and `subtitle` on the left, the black Close in the
  corner with the round `actions` and an optional "…" `menu` under it),
  `tabs` drawn as the pill segment with `tabsAside` beside it (a deal's
  stages; children can be a function of the tab), a scrolling body and an
  optional fixed `foot`. `CrmAvatar` and `CrmCardButton` go with it; `RecordActions` with
  `menu` draws history, merge and trash as the round "…".

### What's built

- **Today** (`src/server/crm/today.ts`, `src/components/crm/today/`): one
  list grouped as Replies, Due today, To approve and Calls, from the
  follow-up queue, stuck deals and deals with no next step, the review
  queue, duplicates and the viewer's call steps. Each row carries at most
  two ambient buttons with the reason beside them; a done row shrinks to a
  line, with Undo where there is one (a held send, an accepted
  suggestion). The bar is in Tasks' order: Mine and Everyone's as round
  buttons, Filters (picks a group), then search. Goals, Coming up
  (meetings in the next week) and Done on its own (the latest five with
  when, the week's count, See all opens `?open=log`;
  `src/components/crm/today/today-log.tsx`) sit on the right. Power hour
  is one light strip; Snooze hides it
  until 2 PM, or 8 AM the next day, where the member is
  (`src/lib/crm/power-hour.ts`, an `InboxItemState` row keyed
  `crm-power-hour`), with Undo.
- **Person card**: header with Call (when there's a number) and "…",
  tabs Overview (the next step with Done and Push, then two likely next
  steps; the kept brief; the latest thing with Reply when they wrote and
  nobody answered; money their company pledged with Remind), Timeline,
  Deals and Details (the record fields). One composer at the foot cycles
  Email, Text (when the phone is set up) and Note; an email is queued ten
  seconds out with Undo (cancelEmail), a text or note waits ten seconds in
  the card (closing sends it); `/` lists templates, the member's booking
  link and a voice note; a red line names who else reached them lately.
- **Power hour card**: the Today rows that are people, replies first; the
  draft waiting for each (or a blank one); the foot has who's next on the
  left and Skip (J), Snooze a week (S) and Send (E) on the right; a send
  waits ten seconds with Undo in a toast.
- **Done on its own** (`src/server/crm/on-its-own.ts`): automation and
  sequence mail (Undo while it's still waiting), fields an automation or
  the system changed (Undo puts the record back, while nothing changed it
  since), an automation's other steps, and what was held back (Send anyway
  for a draft an automation held for review). Kinds with no real undo show
  no button.
- **People** (`/crm/people`, `src/server/crm/people-view.ts`,
  `src/components/crm/people/`, pure parts in `src/lib/crm/people-view.ts`):
  People and Companies are round buttons (`?view=companies`; the old
  `/crm/companies` redirects there). Filters holds Lists (`?list=`: Everyone,
  Follow-ups due, Going cold, New this week, Look like duplicates, then the
  organization's own lists, each with its count, and In the trash), Owner
  and Relationship. "{list} {count}" sits over one table: relationship as a
  tinted pill with a dot, strength as four bars, last talked, and the next
  step as one ambient button with its reason beside it (Merge a likely
  duplicate, Reply to someone who wrote, Follow up when it's due, Check in
  when it's gone quiet, Add a next step when someone you've talked to has
  none; otherwise the next step in words). Picking rows brings the
  selection bar: Start a deal (`?open=new:deal&with=person:<ids>`), Add to
  list, Change owner, Email them (a list of exactly them, opened as the
  one-email card over People with `?open=plan:email&to=<list>`), and "…"
  with Add to a follow-up series, Merge (two picked), Export
  (`/crm/export?ids=`) and Move to trash, each with Undo. Deals joined
  People on 2026-11-03: see "One list". A CRM with
  nobody in it shows "Nobody here yet": bring in members and event guests,
  a spreadsheet (Import), or one person (New).
- **Lists** are CrmViews. One made of filters holds whoever matches; a
  hand-picked one (Add to list) stores `{ col: "people", op: "in", value:
  [ids] }`, and every reader (People, bulk email, the dialer) honours it
  (`viewIds` in `src/server/crm/outreach/lists.ts`).
- **Company card** (`src/components/crm/cards/company-card.tsx`): Overview
  (the soonest next step among the company, its people and its open deals,
  with Open; what they are; money; the open deal; someone nobody has talked
  to in 60 days with "Ask {who knows them} for an intro"), People (Add a
  person here opens New with the company filled in), Deals and Details.
- **Merge card** (`?open=merge:<a>,<b>`): the two side by side with a pick
  per field (the record whose name you keep is kept; the other side's
  picks are written over it after `mergePeople`), what both share and what
  moves. Keep both turns the suggestion down (or writes one turned down),
  so the scan never pairs them again. `/crm/review` redirects to People's
  "Look like duplicates" list.
- **New card**: Person, Company and Deal as a switch. For a person, paste
  an email signature or a card photo (or drop one) and the organization's
  own AI reads it (`readContact`, nothing proposed or kept; the image route's
  `purpose=fill`); with no AI connected, a pasted signature is read without
  it (`parseSignature`). A line under the name says who's already here, with
  Open (`likelyExisting`, scored like the duplicate scan). It's built like
  New task and New event from the shared `ui/form-dialog.tsx` pieces: New
  task's window, header and foot, New event's kind cards for Person,
  Company and Deal (switching keeps what was typed), the name first and
  focused, the rest as labelled fields in pairs with selects for
  Relationship, Owner, Pipeline and Stage. Owner isn't asked in a Personal
  space. A deal takes company, people, amount, close date, pipeline and
  stage. Enter or Ctrl+Enter creates and opens the new card;
  Ctrl+Shift+Enter (Create and open another) keeps it blank for the next.
  One email to a list and Split a list (`plan:email`, `plan:split`) use the
  same window; Ctrl+Enter sends, plain Enter doesn't. `/crm/scan` opens it.
- **Deal card** opens centered with `?open=deal:<id>` over whatever page
  you're on: People's board, a person's or company's Deals tab, Today.
  `/crm/deals` redirects to People's board ("One list").

### Notes and tasks

- **Notes tab** on the person and company cards
  (`src/components/crm/card/notes.tsx`): the NOTE entries of the record's
  timeline, newest first (a company's include its people's, each naming
  who it's about). No second store: a note is a `CrmActivity` of kind NOTE.
  Notes is its own tab rather than part of Timeline because it's the list
  you come back to change, and each note can become a task. Whoever wrote
  a note, or an owner or admin (the row-level rules decide), can change
  it or delete it, with Undo. New notes come from the card's composer
  (Note); the company card now has the composer too, with Note and Task.
- **Make it a task** on any note, and the composer's **Task** channel
  ("Marcus doesn't like the new export, for Kristine"): the
  organization's AI (`runCrmAi`, feature `crm.task`, a fast model)
  writes a task from the note and the record (`draftNoteTask` in
  `src/server/crm/note-task.ts`, pure rules in `src/lib/crm/note-task.ts`):
  a title, a description that names them and quotes the note, an
  assignee (a member the text names wins; else the model's pick from the
  members with their org chart titles and responsibilities; else the
  record's owner; else the writer), a due date when the note implies one,
  a priority. It shows as an editable preview in the card
  (`task-preview.tsx`) with Create task. Without an AI key it's read
  plainly from the note and says AI can write it once a key is added in
  CRM settings > AI. Create task makes a real task in Tasks
  (`createTask`, `confirmFlagged`), links it to the record (an
  `ItemLink`, so its linked panel opens the card) with "Open {name} in the
  CRM" (`?open=person:<id>`) at the foot of the description, and logs
  "Task created for {name}" on the record's timeline (the link's own
  row; the nightly mirror keeps that wording). Undo trashes the task and
  the row.
- **Biggest issue** (`src/server/crm/issue.ts`, `src/lib/crm/issue.ts`):
  one line per person, kept on the person's enrichment as
  `_issue: { text, at, model, sources }` (sources are the `CrmActivity`
  ids it came from; Reports counts the top issues across people from it).
  A note (written, changed or deleted), a reply, an incoming text or a
  call queues the crm-ai job `issue:{personId}` (`issue-queue.ts`, 15
  seconds out so a burst merges); it asks the model (`crm.issue`, metered
  and capped like the rest) only when the digest of what it reads
  (`_issueSeen`) changed. Overview shows it with where it came from;
  click to change it, X clears it (Undo). A member's own line stays
  until something new comes in, and stays when the AI then finds nothing.
  With none yet and something to read, "Find it" asks now.

## One list

Built 2026-11-03 on `claude/crm-onelist`. People and Deals were the same
list seen two ways, and Outreach was a third place to look for the same
people. Now the CRM is two tabs, **Today** and **People**, and People is
the one list of everyone you deal with.

- **The view switch** (round buttons in People's toolbar, like Tasks'):
  People (the table), Companies (the table) and Board (`?view=board`:
  one pipeline's deals by stage, drag to move, `DealBoard` from
  `src/components/crm/pipeline-view.tsx`; each card names its person and
  company). Report sits beside the switch on the board and opens that
  pipeline's Deals report in Databases > Reports
  (`/crm/reports/deals/<pipeline>`).
- **Deal columns.** The People and Companies tables show Stage and Deal
  value: the row's open deal, or the most advanced one when there are
  several, with "+1" for the rest (`rowDeal` in
  `src/lib/crm/people-view.ts`). The stage links to the deal's card.
- **The next step keeps the deal's reasons** (`rowNext`): after Merge and
  Reply, Send the quote (a drafted, declined or expired quote; opens the
  deal card on its quote), then a due follow-up, then the deal's next
  step when it's late (Follow up) or missing (Add a next step), both
  opening the deal's card, then Check in. Otherwise the person's next step
  in words, else the deal's.
- **Filters** holds Lists, Owner and Relationship as before, plus
  Pipeline (when there's more than one), Stage, Deal type and Open, won
  or lost (`?pipeline=`, `?stage=`, `?type=`, `?show=`;
  `peopleDealFilters`). On the tables a deal filter narrows to people (or
  companies) with a matching deal (`ListQuery.deals`, `dealFilterWhere`
  in `src/server/crm/deals-tab.ts`); a stage alone means that stage
  whatever its kind, otherwise open deals unless Won, Lost or all is
  picked. On the board, Lists and Relationship narrow through the deal's
  people and Owner is the deal's owner.
- **The heading** reads "{list} {count}"; with a deal filter on, or on
  the board, also "$X in open deals" (or won, lost, in deals).
- **Search** covers people, companies and deal names (a person or
  company matches through its deals' titles; the board also matches the
  deal's people).
- **Create** stays New person (New company on Companies), with New
  company, New deal and Import in its menu.

### Where things moved

| Was | Now |
| --- | --- |
| `/crm/deals` (list, board, filters) | `/crm/people?view=board`, with `pipeline`, `stage`, `owner`, `type`, `show`, `q`, `open` and `tab` carried over (`dealsRedirectHref`, `src/lib/crm/redirects.ts`) |
| A deal's link (`crmRecordHref`) | `/crm/people?view=board&open=deal:<id>` |
| A pipeline's link (`crmPipelineHref`) | `/crm/people?view=board&pipeline=<id>` |
| Outreach's plans | Follow-up series (sequences) are a card in CRM settings > Automations, each row opening its plan card over Settings; split lists and group emails are the card under it, with Split a list |
| A plan's link (`crmPlanHref`, `/crm/outreach?open=plan:...`, `/crm/outreach/sequences/<id>`, `/crm/campaigns/<id>`) | `/crm/settings/automations?open=plan:<type>:<id>`; a member who can't open Automations gets the card over People instead |
| One email to many (`/crm/outreach/bulk?list=`, `plan:email`) | People's Email them: the same one-email card over People (`?open=plan:email&to=<list>`), approval rules unchanged |
| Putting someone in a sequence | Add to a follow-up series: the person card's "…" and the selection bar's "…" (`src/components/crm/people/series-dialog.tsx`, `enroll`) |
| Outreach's Templates, Your mail | CRM settings > Templates, > You (`?view=templates`, `?view=mail` and `/crm/outreach/mail` redirect there) |
| `/crm/outreach`, `/crm/outreach/sequences`, `/crm/campaigns` | People; the two lists go to Automations |

CRM settings sections render the CRM's cards now (`CrmSettingsFrame`'s
`overlays`, and `rendersOverlays` covers `/crm/settings/<section>`).
Removed as unused: `deals-list.tsx`, `deals-toolbar.tsx`, Outreach's
`plans-view.tsx`, `mail-settings.tsx`, `outreach-header.tsx`,
`campaigns.tsx`, `sequences.tsx`, `person-section.tsx` and
`person-controls.tsx`. The server code (`src/server/crm/outreach/`,
the actions in `crm/outreach/actions.ts`) stays.

Tests: `src/lib/crm/redirects.test.ts` (the redirect mapping, the deal
filters, the row's deal and its next step), the nav case in
`src/lib/crm/crm.test.ts`, `src/lib/crm/overlay.test.ts`.

Not done: no browser walkthrough yet; the board shows one pipeline at a
time (Pipeline in Filters picks it); "$X" sums in the first pipeline's
currency.

## Personal CRM

Built 2026-11-03 on `claude/crm` (152a250e). Every account's Personal space
(Organization kind `PERSONAL`, one member) can add the CRM and run it for
one person: people, companies, deals and outreach, nobody else sees it.

- **Plan.** `crm` is in `PERSONAL_PLUS_EXTRAS` (`src/lib/billing/features.ts`),
  next to integrations, themes and AI, so Personal Plus and a new
  account's trial have it. Personal Free sees the add-on card and the
  sidebar links locked (See plans), and every action refuses with "The CRM
  comes with Personal Plus." (`requireCrm` uses `featureRefusal`).
- **Where it lives.** Personal's sidebar (`PERSONAL_NAV`,
  `src/components/shell/nav-config.ts`) ends with Integrations and, once
  added, CRM under it. Integrations and apps offers the CRM as Personal's
  one add-on (`ADD_ON_INFO.crm.personal`, `personalAddOns()`); adding Forms
  or Finance there is refused ("That add-on is for organizations.").
- **Access.** `CrmAccess.personal` (`src/server/crm/access.ts`). The owner
  is admin and manager. Who sees what, CRM managers, lead routing (only the
  daily send cap is left) and Handover (redirects to People) don't show.
  The org chart is empty, so nothing is owned by a role.
- **Setup.** `setupKindsFor(true)` (`src/lib/crm/templates.ts`): Clients,
  Partners and deals, Mentors and guests, Press, venues and vendors,
  Grants, Donors. No members or alumni, and no Member relationship type.
  Bring in is only the people who RSVP'd to your event pages, or a file.
- **Databases.** `LISTED_DEFINITIONS` lists the CRM's People, Companies and
  pipelines in Personal's Databases (not the built-in club ones), so the
  CRM's integrations (email in, calls and texts, meetings) feed them as an
  organization's do.
- **Integrations for one person.** Email, Google Calendar, video calls,
  calls and texts, Claude, other AI models and the CRM's data connectors
  (Tavily, Hunter, Prospeo) are offered. Team chat (Slack, Discord, GroupMe),
  the website build hook and the website's Supabase export are not
  (`ORG_ONLY_APPS`, `integrations/panels.tsx`). The Supabase export fills
  an organization's built-in check-in, sign-up and ballot databases, which
  Personal doesn't list. The CRM's public API works in Personal too.
- **Tests.** `src/server/crm/personal.db.test.ts` (Plus sets up with its
  own answers, people and deals, the databases listed, Free refused), the
  Personal sidebar cases in `nav-config.test.ts`, the templates cases in
  `src/lib/crm/crm.test.ts`.
- **Not built.** A database fed straight from a Google Sheet or a CSV link.
  Pages written for a team (record owner pickers, "Mine and Everyone's" on
  Today, the redesign's cards) still show their team controls with one
  name in them. The redesign session carries the Personal rules into the
  new Settings and Setup.

- **Company and deal cards** are a plain first cut (facts, people, deals,
  timeline, details) until their own designs land; **New** makes a person,
  company or deal and opens its card. `/crm/deals` lists the pipelines for
  now.

### Settings and setup

- **CRM settings** is one page per section, `/crm/settings/{section}`
  (`src/lib/crm/settings-sections.ts`): the CRM header titled "CRM
  settings" with no create button, the Admin panel's list card on the left
  (`CrmSettingsNav`) and the section's `SettingsCard`s on the right
  (`CrmSettingsFrame`). Sections are server components in
  `src/components/crm/settings/sections/`. You, Templates and Booking link
  are every member's; Automations, Sending, Deal stages and types, Fields,
  AI and Import and export are for owners, admins and CRM managers; Phone
  and texts, Team and access and API and webhooks for owners and admins.
  `/crm/settings` opens Automations (or You). A Personal space has no Team
  and access (so no who sees what, CRM managers or lead routing; handover
  goes to People) and is offered its own ready-made pipelines.
- **Pages under a section**: one automation at
  `/crm/settings/automations/{id}` (`new?describe=` fills the steps from
  the describe box's sentence) and one booking page at
  `/crm/settings/booking/{id}`. `/crm/automations`, `/crm/outreach/booking`
  and the old `/crm/settings/webhooks` redirect.
- **Kept on CrmSettings**: `sending` (the hours group mail goes out,
  weekends, the unsubscribe line; `readSending` in
  `src/lib/crm/settings-prefs.ts`, applied in `send.ts`'s prepare once set)
  and `autonomy` (how much it may do alone). "Emails and texts from plans
  and automations" is locked at Suggest with its reason in place of the
  switch (`TRUST_ITEMS[].locked`; `readAutonomy` ignores a stored value):
  see "Nothing sends unapproved". Merges, signature changes and stage
  moves keep their level but don't read it yet.
- **Sending is paused** (`SendingPausedBanner` in
  `src/components/crm/settings/sending-paused.tsx`, one line on any page):
  the spending cap reached, or bulk email with no verified sender; a
  warning when a week's group email bounces 5% or more. Sending lists what
  bounced or didn't go in the last two weeks.
- **Import and export**: a dropped spreadsheet shows its column matches
  and comes in with one button; a finished import keeps its skipped rows,
  and each is fixed in place (an email added) or left out
  (`fixImportRow`, `letRowGo`). Export everything is one zip
  (`/crm/export?kind=all`, `&notes=1` adds the timeline).
- **First-time setup** (`/crm/setup`, `src/components/crm/setup.tsx`):
  what you mostly reach out to (picked for you), then 1 Bring people in (a
  spreadsheet beside members, event guests and form answers; in a Personal
  space only the people who RSVP'd), 2 Who looks after them (Split evenly,
  By relationship, Leave them for now: `planOwners` in
  `src/lib/crm/setup-owners.ts`, which also sets the routing for new
  people; not in a Personal space), 3 Connect, if you like (opens AI or
  Phone after setup). The summary pill sits next to Set up the CRM.

- **Outreach** (`/crm/outreach`; `src/server/crm/outreach/plans.ts`,
  `src/lib/crm/outreach/plans.ts`, `src/components/crm/outreach/plans-view.tsx`):
  one grid of plans, whatever each is underneath: a sequence (steps over
  days), a campaign that splits a list among members, or a bulk send (one
  email to a list, a one-step plan). Each plan shows its first steps on a
  coloured band, its status, who it's for, where it stands and at most two
  ambient buttons (Start it, See the replies, Do my N). Filters picks a
  status; search matches names and who. The header's create is New plan
  (a draft sequence, opened as its card), with One email to a list and
  Split a list among members in its menu. Templates and Your mail are the
  bar's other round buttons (`?view=templates`, `?view=mail`); your
  booking link closes the grid. `/crm/campaigns(/[id])`,
  `/crm/outreach/sequences(/[id])`, `/crm/outreach/bulk` and
  `/crm/outreach/mail` redirect there, with the plan's card open where
  there's an id. Booking pages stay at `/crm/outreach/booking` until they
  move into Settings.
- **Plan card** (`src/components/crm/cards/plan-card.tsx`,
  `overlays/plan.tsx`): Steps (Email, Wait, Text, Task, Call, edited in
  place, waits drawn as their own steps and folded into the next step's
  delay on save; Shorten on a text over 160 characters; a note and "Take
  out the dashes" when an email trips `emailTells`), Who (plain-language
  chips with "+" offers, how many match today, who's in it, who's left out
  and why: asked not to be contacted, unsubscribed, bounced, no address,
  already in another plan, with Include anyway for the last), Results
  (sent, opened, replied as bars; who replied, with Reply when nobody
  answered) and Settings (name, send from their owner or you, most sent a
  day, stop when they reply, the send window). The foot says where it
  stands, with Pause or Start; Start switches it on and puts in everyone
  the audience picks out. A sequence's audience, sender, daily cap and
  let-in-anyway list are kept under `plan` in its `sendWindow` JSON (no new
  columns); the step job honours the plan's cap. A campaign's card shows
  its steps as set, its list, each member's share (Write to my N or Start
  for my N, Add the N new, Skip), results and Mark done or Run again.
- **Ask** (`src/components/crm/cards/ask-card.tsx`; `src/server/crm/tell.ts`,
  `src/lib/crm/ask-intent.ts`): one box, "Ask or tell the CRM". A question
  goes to `askCrm` and comes back with a small table and, when People's
  own filters show the same people, Open these N people. A change ("Move
  Harbor Light to Committed and give it to Kristine") is read by
  `tellCrm` into a stage, an owner, an amount, a next step or a follow-up
  date, queued as review-queue suggestions and shown as before and after;
  Apply accepts them, Cancel rejects them, Undo undoes and drops them; a
  preview left undecided is dropped when the card closes. A pasted chat
  goes to `readConversation` and its suggestions come back as checkboxes
  with Add N people. Enter on a question, a change or a sentence in any
  tab's search pill (or Ctrl/Cmd+Enter on anything) opens Ask with it.
- **Public booking page** (`/book/<slug>`): the organization's name and
  logo, then one card with who you're meeting and how long, a month
  calendar of open days, that day's times, a short form, Book, and a
  booked state with Pick again.

## Nothing sends unapproved

Built 2026-11-03 on `claude/crm-inbox`. No email or text leaves the CRM
unless a person pressed Send for it (or pressed Start on the plan it opens).
Everything else waits as a draft in the sender's compose, with a To approve
row on Today (Send, Don't send), a place in Power hour and a `CRM_REVIEW`
line in their Inbox. Send goes through `composeEmail` with the draft, which
keeps it the plan's or the automation's (its thread, footer and daily cap)
and closes the To approve row. Don't send (`rejectSuggestion`) throws the
draft away.

| Path | Before | Now |
| --- | --- | --- |
| Automation "Send a template" (`workflow-actions.ts`) | Sent from the owner's mailbox unless the step said review or Automations said Suggest | Always a draft for the owner; the step's review switch is gone from the builder |
| Automation "Invite to an event", someone outside the organization | Emailed the RSVP link | A draft with the link for the owner; members still just join the invitees |
| Automation "Enroll in a sequence" | First email went on its own | Enrolled with no `enrolledById`, so even the first email is a draft |
| Plan or sequence, first step, a person pressed Start / Enroll / their share | Sent | Still sent: pressing it is the OK (`approvedByStart`) |
| Plan or sequence, every later email step | Sent when due | A draft when due; the rest of the plan waits while it waits, and the next wait counts from when it was sent; a reply, booking or bounce withdraws it |
| Plan or sequence, later text step | Texted on the organization's number | A to-do in the sender's queue with the words ready (send from the card) |
| Follow-up agent (`agents.ts`) | Drafts only | Unchanged |
| Booking confirmation to the guest (`booking.ts`) | Sent | Kept: the receipt for what the guest just did, to them alone |
| Form receipts, RSVP confirmations (outside the CRM) | Sent | Kept: the same kind of receipt |
| One-to-one email, Power hour, a text from the card, bulk email, a campaign share, Send later | A person pressed Send (Send later included) | Unchanged |
| Quotes and invoices | Sent only from Send; no reminders exist | Unchanged |
| CRM settings > Automations, "How much it may do alone" | Emails could be Suggest, Do and tell me, Just do it | Locked: "Always waits for you: nothing goes out until a person sends it." |

Tests: `src/server/crm/approval.db.test.ts` (a plan's later steps, an
automation's enrollment, Don't send, a reply withdrawing a draft, the
locked setting), the first case of `integration.db.test.ts` (an
automation's template), `src/lib/crm/settings.test.ts`.

## The CRM in the Inbox

Built 2026-11-03 on `claude/crm-inbox` (`src/server/crm/inbox-notify.ts`).
What comes into the CRM for someone is a line in their Inbox's Updates,
under one CRM chip, linked to the card (`crmRecordHref`, `?open=`):

| What | Type | Who | Where it's written |
| --- | --- | --- | --- |
| Someone new (a person, company or deal) from anywhere but an import: a form, a booking, email, texts, the API, an automation, a member adding them for you | `CRM_NEW` (`CRM_DEAL` for a deal) | The owner, else the managers; never whoever added them | crm-event listener |
| A form answer from someone already in the CRM | `CRM_NEW` | Owner, else managers | crm-event listener |
| Given to you (owner changed) | `CRM_ASSIGNED` (`CRM_DEAL` for a deal) | The new owner | crm-event listener; People's Change owner writes one line itself |
| A deal won or lost | `CRM_DEAL` | Owner, else managers | crm-event listener |
| An import finished | `CRM_NEW` | Whoever started it, one line | `runImportTurn` |
| A new member joined | `CRM_NEW` | The managers | invitation accept and join code |
| A reply | `CRM_REPLY` | The member it answers | `ingestEmail` (as before) |
| A booking | `CRM_BOOKED` | The host | `book` |
| A quote or invoice opened, accepted or declined | `CRM_DEAL` | The deal's owner, else whoever made it, else managers | `/q/{token}` |
| A draft or change waiting for your OK | `CRM_REVIEW` | Its assignee | `proposeChange` |
| Mail that didn't go; what an automation held back | `CRM_REVIEW` | The sender; the automation's member | `send.ts` `markFailed`, `runWorkflowOn` |
| Sending paused (the spending cap, no sender) | `CRM_REVIEW` | The sender and managers, once a day | `markFailed` |

- **Bursts are one row.** A second line of the same group for the same
  member within 30 minutes, while the first is unread, rewrites that row
  ("3 new people in the CRM", the latest name under it). Rewriting needs
  the service path; a member's own action adds a row instead. Something
  already said about a record in the last ten minutes (a routed form
  answer, a booking) isn't said again.
- **Events.** `emitCrmEvent` now also queues a `crm-event` job when the
  Inbox could want it (`inboxMayWant`, then `inboxWants` in the caller's
  transaction), so a member's edits to their own records still queue
  nothing, and a bulk edit's batch never does.
- **Email copies.** The notify-email job reads each member's preference as
  for any type. `CRM_NEW` is off until they turn it on (`DEFAULT_OFF_TYPES`).
- **Migration** `20261106090000_crm_inbox_kinds` adds `CRM_NEW`,
  `CRM_BOOKED` and `CRM_DEAL` to `NotificationType`.
- **Not yet.** A quote opened by the sender themselves counts as opened.
  Text sends that fail don't write a line. A bring-in (members, event
  guests) is quiet like an import but writes no summary line yet.

## The CRM in the rest of the app

Every link into the CRM from outside its pages goes through
`src/lib/crm/href.ts` (`crmRecordHref`, `crmTodayHref`, `crmApprovalsHref`,
`crmPeopleHref`, `crmNewHref`, `crmDealsHref`, `crmSettingsHomeHref`,
`crmPipelineHref`), so a page that moves changes in one place.

- **Retired pages.** `/crm/queue` (Review) goes to Today's To approve
  (`?show=approve`); `/crm/items/new` opens the New deal card;
  `/crm/pipelines/<id>` keeps its params on the way to Deals (`?new=1`
  opens New deal). The rules are pure, in `src/lib/crm/redirects.ts`.
- **Search.** The palette's search has a CRM group and a CRM filter:
  people (name, title, company, any address), companies and deals, kinds
  `crm-person`, `crm-company` and `crm-deal` (the link kinds, so the
  Linked panel's picker links them too), each opening its card. Only
  where the space added the CRM and its plan has it, Personal spaces
  included; the database decides whose records a member sees (OWN
  access). A Finance partner hit opens its CRM company when it has one.
- **Palette pages.** CRM today, To approve, CRM people, CRM companies,
  CRM deals and CRM settings; Finance's Deals reads "Finance deals".
- **Pins and Recently visited.** `crm` is a section in
  `src/lib/pins/pages.ts`: Today (with `?show=`), People (with `?view=`
  and `?list=`), Deals, settings sections and the smaller pages. A
  record's old page isn't kept (it redirects to its card).
- **New menu.** New person, New company and New deal open the New card;
  so do the People, Companies and Deals databases' New buttons.
- **Tasks are next steps.** An open task linked to a person, company or
  deal (ItemLink) is its next step: People's cell shows it in words
  ("Send the deck, Nov 12", "today", "3 days late") instead of Add a next
  step or Check in, and Today leaves the deal out of "no next step". A
  sooner follow-up, a reply or a due follow-up still comes first.
  Completing or trashing the task clears it. Pure rules in
  `src/lib/crm/task-steps.ts`, the reads in `src/server/crm/task-steps.ts`
  (as the viewer, so a private task they can't see doesn't count).
- **Links back in** (`src/server/crm/outside-links.ts`, nothing when the
  CRM isn't there for the viewer): Finance's deals screen links a deal to
  its CRM deal and a partner to its company (else the person with its
  contact's email), with Open in CRM in their menus; a meeting's
  attendees who are CRM people (by account, else email) link to their
  card, and the CRM people it was with who aren't members (a booking's
  guest, anyone it's logged on or linked to) are listed under Invited
  with Open in CRM; a member's page in People has Open in CRM when they
  are a CRM person.
- **Connected apps.** The CRM tools' links are the cards (`recordUrl`),
  Deals for a pipeline, To approve for what's queued, and a saved list's
  own `?list=`; their words say deals and To approve.
- **Home.** Waiting on you adds two rows when there's something: replies
  waiting (the member's own people who wrote back) and things to approve
  (the Inbox's `crm:review`, so Snooze and Done there apply), each opening
  Today on its group.
- **Tests.** `src/lib/crm/redirects.test.ts`, `src/lib/crm/task-steps.test.ts`,
  the CRM cases in `src/lib/pins/pages.test.ts` and
  `src/components/command-palette/catalog.test.ts`, and
  `src/server/crm/crm-links.db.test.ts` (search scoped by access, add-on
  and plan; task steps; Finance and member links).

## Safety fixes

Built 2026-11-03 on `claude/crm-safety` (migration
`20261106120000_crm_send_approval`: `CrmEmailMessage.approval` and
`approvedById`, `CrmTextMessage.approvedById`, backfilled for what was
already approved; no policy changes). Tests:
`src/server/crm/safety.db.test.ts` and `safety.test.ts`.

**Approval is checked when mail leaves, not only when it's queued.** Every
outgoing email records who said it may go: `send` (a person pressed Send:
compose, a draft, a campaign share, bulk), `start` (a plan's first email,
by whoever pressed Start) or `receipt` (a booking confirmation, untracked,
to the guest alone). The send job (`prepare` in `send.ts`,
`approvalProblem`) checks it again just before it goes: the approver is
still a member, a `start` is the enrollment's first email and Start could
approve it. Anything else (an automation's email queued before approvals,
like "Welcome, Theo") becomes a draft in its sender's To approve instead.
Texts the same way: `crm-text-send` holds a text nobody approved
(status `held-for-ok`) and tells its sender.

**Drafts are sent once.** Send claims the draft in one statement, so Today,
Power hour, the card and two tabs can't all send it; a draft withdrawn by
a reply, booking or bounce, thrown away or already sent is refused in
words. The draft and its To approve row close when the email actually
leaves; Undo (`cancelEmail`) gives the draft back as it was, and the plan
doesn't move on. The ten seconds for Undo are counted on the server
(`holdSeconds`), and the composer and Today send what they're holding when
the tab is hidden or left.

**Start.** Pressing Start (or Enroll) approves a plan's first email only
when it goes from the one pressing it, or they made the plan, or they're
an owner, admin or CRM manager (`startMayApprove`). Otherwise, as with a
member starting someone else's plan "from each person's owner", each
owner's first email is a draft for that owner. The first email is written
and frozen when Start is pressed (status `SCHEDULED` until its step runs),
so later edits to the plan or template don't change it. A running plan is
its maker's: only they, owners, admins and CRM managers may edit or
archive it (`assertMayEditPlan`; the database still lets any member
update, as before).

**Email in.** The Worker reads the Authentication-Results Cloudflare adds
(only under its own name, `AUTHSERV_ID`, the topmost one) and sends a
verdict: pass when DMARC passed, or DKIM or SPF passed for the From
domain. The app takes only a sender that checked out as who it says:
an unverified From with a member's address is never logged as their own
email, and mail coming in acts only for its checked sender (their timeline,
their sequences, their issue). Cc'd contacts are never touched by someone
else's mail; a Cc'd stranger may still be suggested. A bounce found by
address alone needs a checked sender. `/api/crm/inbound` drops mail past
20 an hour per reply address and 60 an hour per sender. Replies fold into
one Inbox row ("3 new replies") like the CRM's other lines, and a reply
queues a biggest-issue refresh at most once an hour per person. Check on
a real message that Cloudflare's results reach the Worker: if they don't,
every sender reads as unverified and replies are ignored.

**The biggest issue** reads only entries everyone who can see the person
can see (`everyViewerSees` in `issue.ts`): never a private one, and with
members seeing only their own records, only entries by the person's owner
(and whoever added them). Notes-to-task reads that same stored line, and
on a company it takes only notes on the company or its own people. Undo on
"Make it a task" removes only the task that note made.

**Events.** A bulk edit's events carry its batch, and the Inbox leaves
those records to the edit's own line; an event queues a job only when a
switched-on workflow's trigger type could match it (`eventCouldTrigger`),
a webhook listens or the Inbox could want it.

**Merging.** Any member may merge two records they can both see. The merge
keeps what Undo needs on its timeline row (`meta.undo`: the moved
addresses, timeline links, deals, enrollments, campaign places, calls,
texts, jobs and the kept record's values before, including the fields
picked on the Merge card). Undo in the merge toast (`undoMergeAction`,
`undoMerge`) puts both back, for 7 days, by whoever merged or an owner or
admin. Relation links in databases stay on the kept record. When both were
in the same plan, the duplicate's enrollment stops instead of running
twice.

**Input.** The deal, goal, People, reports and plan actions check their
input with zod (`checkInput` in `crm/run.ts`).

