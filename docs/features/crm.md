# CRM add-on: plan

Status: Phase 1 built on `claude/crm` (see "Phase 1 as built" at the
end); phases 2 to 6 are plan. Source material: the CRM teardown PDF (seven
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

**It's for any organization reaching out to people, not just sales or
sponsors.** The same CRM runs:

| Who you're reaching | Example pipeline (ready-made, renameable) |
|---|---|
| New members, volunteers, applicants | Interested, Reached out, Talked, Applied, Joined |
| Donors and funders | Identified, Asked, Pledged, Received, Thanked |
| Sponsors and partners | Prospect, Committed, Invoiced, Received (today's Sponsorships) |
| Speakers, guests, judges, mentors | Invited, Confirmed, Briefed, Done, Thanked |
| Alumni and past members | Keep in touch (no stages, just a cadence) |
| Press, venues, vendors | Contacted, Quoted, Booked |
| Clients and customers | Lead, Qualified, Proposal, Won or Lost |
| Grants | Researching, Drafting, Submitted, Awarded or Declined |

So the words on screen follow the organization: a pipeline names what it
tracks ("an applicant", "a donation", "a sponsorship"), amounts are
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

## What we already have and will reuse

| Need | Already in Bananasplit | Where |
|---|---|---|
| Add-on switch, add-on page | `ADD_ONS`, `OrgSettings.addOns`, `/integrations/crm` placeholder | `src/lib/addons.ts` |
| Custom fields and field types | Custom databases: fields, JSONB values with a GIN index, CSV import | `DatabaseField`, `DatabaseRecord`, `src/lib/databases/fields.ts` |
| Bringing people in | Forms that write every response to a database, no sign-in needed | `Form`, `FormResponse`, `docs/features/forms.md` |
| Sponsors and a sponsorship pipeline | `Sponsor`, `Sponsorship` (Prospect to Received), linked to Finance | Finance |
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
| `CrmPerson` | The heart of it. Name, emails, phones, socials, title, company, owner, relationship type (member prospect, donor, sponsor contact, alumni, speaker, client, custom), source, last contacted, next follow-up, keep-in-touch cadence, score, unsubscribe and consent flags, custom fields. Linked to an existing `Contact` and/or `User` when the email matches, so check-ins, RSVPs and membership show on their page. |
| `CrmCompany` | The other side when it's a group: a business, school, foundation, venue, another organization. Name, domain, size, industry, owner, custom fields. On screen, "Company". |
| `CrmPipeline`, `CrmStage` | Any number of pipelines from the templates above or from scratch. Each names what it tracks ("applicant", "donation"). A stage has an order, an optional likelihood, a "stuck after N days" limit and an Open/Won/Lost kind with renameable labels. |
| `CrmDeal` | One thing moving through a pipeline (an application, a pledge, a sponsorship, a booking). Stage, owner, people with roles, optional amount and expected date, optional forecast category (Pipeline, Best case, Commit), won/lost reason, next step, custom fields. Called by its pipeline's own word on screen; `CrmDeal` is only the table name. |
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

**Moving Sponsors in.** Sponsorships become one of the ready-made pipelines,
not the point of the CRM. Existing `Sponsor` rows become companies (their
contact name and email become people) and `Sponsorship` rows become items
in a **Sponsorships** pipeline (Prospect, Committed, Invoiced, Received,
Declined, Written off). Marking one Received still records the Finance
transaction, as today, and Finance keeps its sponsorship totals by reading
the CRM. Organizations that never had sponsors never see this pipeline.

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
  sponsor spreadsheet, form responses, an alumni list), match its columns
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
What's likely to come in: money (donations, sponsorships, client work) and
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
- Guest links: a sponsor or partner opens a private page with their own
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
| Partners and sponsors can't be let in safely, so updates live in email | Common | Guest links: a sponsor sees their own agreement, deliverables and recap, nothing else |
| Zapier glue that breaks quietly; sales to delivery hand-off breaks | Widespread | One system: a closed item can start a project (tasks, owner, files) automatically |
| Mobile apps are a cut-down shadow; nobody uses them | Widespread | Phone-first "today" view, card and badge scanning at events, voice notes |
| Weeks of setup and consultants | Widespread | Pick what kind of organization you are; fields, pipelines, forms and reports are made for you |
| Switching CRMs loses the timeline, not just the contacts | Common | Importers that keep notes and activity from HubSpot, Salesforce and Pipedrive exports; export includes the timeline |
| No undo for bulk edits or wrong stage moves | Narrow | Undo on every bulk action; restore any record to an earlier point from its field history |
| Nonprofits: donors, volunteers, events and grants need separate tools or workarounds | Common | Donations, recurring gifts, volunteer hours and grants on the person, through Finance and the ready-made pipelines |
| Student organizations: sponsor history lives in personal inboxes and dies every leadership change; no product serves them | Common; no product found | Role ownership, handover, and records that fill from the workspace |
| Slow pages (Salesforce admits Lightning is slow) | Common | Server-side filters, cursor pagination, a seeded load test of 100,000 people, keyboard shortcuts |

**Relationships owned by a role.** A person, company or pipeline can be
owned by an org-chart position ("Sponsorship lead", "Volunteer
coordinator") as well as a member. When the member in that position
changes, the relationships follow the position, the new person gets the
handover briefs, and the timeline stays. Bananasplit already has the org
chart, so this costs us little and no standalone CRM can do it.

**Paste any conversation.** A screenshot or pasted text of a WhatsApp,
LinkedIn, Instagram or text thread: AI (the org's key) finds the person and
the next step, and it lands in the review queue. Bananasplit already turns
calendar screenshots into events the same way.

**Organization setup in one step.** On adding the CRM: "What do you mostly
reach out to?" (members and volunteers, donors, sponsors and partners,
clients, all of these). It creates the pipelines, fields, intake forms,
saved views and a starter report, and offers to bring in existing people
from Bananasplit (members, check-ins, form responses, sponsors) and from a
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
prompt ("Is this a good sponsor fit for a robotics team? Yes, Maybe, No",
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
3. **It knows the money.** Sponsorships, donations, dues and invoices from
   Finance on each person and company: pledged versus received, lifetime
   total, which budget it funds, and the renewal created automatically from
   the end date. Mainstream CRMs leave this to a separate tool.
4. **What we owe them, tracked.** For sponsors and partners, the promises
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
    donors, sponsors, partners, speakers, press, alumni, clients, grants,
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
  can see who already knows a sponsor before writing cold.
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
   from workspace touchpoints, Finance on people and companies, Sponsors
   moved into the Sponsorships pipeline, the add-on page rewritten from
   "Coming later" to real feature rows.
2. **Reaching out.** The follow-up queue, keep-in-touch cadences, lists and
   campaigns split among members, templates and mail merge, 1:1 email
   (member's own mailbox when connected, the org's sender until then),
   tracking, invites to events and forms, booking links, sequences with
   stop-on-reply, bulk email with unsubscribe and sender checks, Forms to
   CRM, embeds, owner routing, the BCC logging address, handover when
   members change roles, "what we owe them" for sponsors and partners with
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
like sponsorships today: a `crm` entry in `PLAN_FEATURES` set to `SOCIETY`,
and `crm` added to `ADD_ONS`. A 14-day trial includes it, as it includes
everything on Team Advanced.

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
People, Companies and pipeline databases, and the saved views. Finance
sponsors bring the Sponsorships pipeline even when not picked, and move in
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
| Sponsorships | `syncDealFromSponsorship`, `dropDealForSponsorship`, `companyForSponsor`, `sponsorshipsPipeline` (sponsor-sync.ts); `moveSponsorsIn` (sponsors.ts). Finance's `setSponsorshipStatus` now lives in `src/server/finance/sponsorship-status.ts` |
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
- A sponsorship's amount and date edited in the CRM need a finance role,
  as in Finance; its stage moves only through Finance's rules.
- The intake forms and starter report from setup come with Forms to CRM
  (Phase 2) and the CRM's own widgets (Phase 3).


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

**Setup, once per deployment.** Set `CRM_INBOUND_DOMAIN` (for example
`in.bananasplit.app`) and `CRM_INBOUND_SECRET` on the app. In Cloudflare,
add the domain, turn on Email Routing, add a catch-all rule that sends to a
Worker, and deploy this Worker with `INBOUND_URL`
(`https://<app>/api/crm/inbound`) and `INBOUND_SECRET` set:

```js
// npm i postal-mime
import PostalMime from "postal-mime";

export default {
  async email(message, env) {
    const parsed = await PostalMime.parse(message.raw);
    const headers = {};
    for (const h of parsed.headers) headers[h.key.toLowerCase()] = h.value;
    const res = await fetch(env.INBOUND_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.INBOUND_SECRET}` },
      body: JSON.stringify({ from: message.from, to: [message.to], headers, text: parsed.text ?? "", html: parsed.html ?? null }),
    });
    if (!res.ok && res.status >= 500) message.setReject("Try again later");
  },
};
```

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
  grant and sponsor pipelines, recurring when the same payer gives at a
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
