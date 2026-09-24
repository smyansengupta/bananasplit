# Tasks: setup

One task board per organization. Every task has **one accountable owner**, a
due date and a status; anyone else on it is a collaborator ("also
involved"). Leads hand work down their reporting line, break it into
subtasks, and post a Sunday update. Assignments, mentions, due-date
reminders and the daily digest go out by email.

## For an org

### 1. Decide how mail leaves your org (once)

Assignment, mention, reminder and digest email uses the org's sender
(**Settings > Integrations > Email sender**) or the platform fallback; with
neither, members get in-app notifications only and nothing is emailed. See
`docs/features/platform-services.md`. Every message links to the task at
`/app/{org}/tasks/{taskId}`; someone who is signed out signs in and lands on
that task.

### 2. Turn on the task defaults you want

**Settings** (owners and admins) holds two rules, both off by default:

| Setting | What it does |
|---|---|
| `taskRequireOwner` | A new top-level task must name an owner (requests in an intake queue are exempt: triage assigns them). |
| `taskRequireDueDate` | A new top-level task must have a due date. |
| `reminderLeadDaysDefault` | How many days before the due date the reminder goes out (1 by default). Each person can override it in their profile. |

The Claude Builders Club turns both rules on ("one task board, every task
has one owner and a due date") through **Settings > Bootstrap CBC
workspace**, which also creates the Design Requests intake queue and the
"Needs President" and "Design" labels. Running it twice changes nothing.

### 3. Publish an org chart (for hand-down rules and the Team view)

Hand-down rules and the Team view read the published chart
(**Org Chart > Publish**). Without one, everything still works: every
assignment is recorded as outside the chart and nothing is flagged, and the
Team view falls back to one lane per member.

## Day to day

### Views

| View | What it shows |
|---|---|
| **My Tasks** | Everything you own or are involved in, grouped Overdue / Blocked / Today / This week / Later / No date, plus what you finished in the last 7 days. |
| **Board** | The kanban: Not started, In progress, **Blocked**, Completed. Completed shows the last 14 days, with a link to older ones. Dragging into Blocked asks what it's blocked on. |
| **Table** | Every task, 50 a page, with filters (search, status, owner, involving, label, due range, **Blockers**, **Flagged**), hideable columns including Owner and Creator, and bulk status, owner and delete. |
| **Calendar** | Due dates for the month; drag an event to move its date, or drag an undated task onto a day. |
| **Team** | A swimlane per person down your reporting line (owners and admins can pick any position or the whole chart), with open hires, advisors and an unpositioned bucket. |
| **Sunday update** | The weekly helper (below). |
| **Requests** | The intake queue (below). Hidden until an org has one. |

The view you pick is remembered per person, so you land on your own default
next time. The **Blockers** filter (blocked plus overdue, org-wide) is the
exec-sync agenda.

Deep links other sections use:

- `?view=table&owner={userId}&status=open` — that person's open tasks (the
  Org Chart side panel). `status=open` means not completed.
- `?view=table&assignee={userId}` — tasks involving that person, as owner or
  collaborator (the People pages).
- `/app/{org}/tasks/{taskId}` — one task's own page (every email link).

### Who can change a task

Editing a task — title, description, status, due date, labels, project,
owner, collaborators, subtasks — is open to its **creator**, its **owner**,
anyone **involved**, a **chart manager of the owner** (anyone above them in
the published chart), the triage owner of its queue, and **owners and
admins**.

Everyone else gets the **self-assign carve-out**: any member may add or
remove **themselves** as a collaborator on any task they can see, and take
ownership of a task that has no owner. Nothing else — no title, status or
due-date edits, and never removing somebody else's ownership.

### Handing work down

Assigning someone is classified against the published chart:

| Relation | Meaning | Flagged |
|---|---|---|
| Self | You assigned yourself | no |
| Handed down | They report to you (at any depth) | no |
| Peer | Neither of you is above the other | no |
| **Above your level** | They are your manager, or sit higher in another line | **yes** |
| Outside the chart | No published chart, or one of you holds no position | no |

Assigning above your level is allowed, but the app asks you to confirm,
marks the assignment **Flagged** on the card, the row and the dialog, and
says so in the email. The person it was assigned to, or an owner or admin,
clears the flag with **Acknowledge**.

### Subtasks, comments and mentions

A lead breaks a task into subtasks, each with its own inline owner and due
date; subtasks appear in My Tasks, the Team view, the calendar and reminders
with their parent as a breadcrumb. Comments support markdown. Typing `@` in
a description or comment opens a member picker; the server keeps only real
members and notifies the newly mentioned, never you. Mentions in code blocks
are left as text.

### The Design Requests intake queue

An intake queue lets **anyone** file a request while **one triage owner**
runs it. Owners and admins set one up in **Requests > Queue settings**:
pick a project, name the triage owner, and set the default due window (5
days for CBC's Design Requests).

- Anyone creates requests; each gets the default due date.
- Only the triage owner (or an owner or admin) sets a request's priority and
  owner, from the queue list or the dialog.
- The triage owner is notified and emailed whenever a request is filed.

### Sunday updates

**Sunday update** drafts each person's week from their tasks: **done this
week**, **what's next** (due within 7 days or in progress) and **blocked**,
with the reason. Weeks run Monday 00:00 to Sunday 23:59 in the org's
timezone.

- **Copy as text** gives a plain-text update to paste into Slack.
- **Post update** saves it (with an optional note) as that week's record.
- Owners, admins and whoever holds the top of the chart see **who hasn't
  posted**. The leads expected to post are everyone holding a filled,
  non-advisor position below the top of the published chart (without a
  chart: members with a title).
- A lead who hasn't posted gets a reminder on Sunday at 18:00 their time.

### Email and notification preferences

| Email | When |
|---|---|
| Assigned | You became a task's owner or collaborator (self-assignment sends nothing). One message lists every task of a bulk assignment. |
| Mentioned | Someone @mentioned you in a description or comment. |
| Commented | Someone commented on a task you own or are on (off by default). |
| Due reminder | The lead time before the due date, at 09:00 your time. |
| Daily digest | Your chosen hour (08:00 by default), if you turn it on. |
| Sunday update reminder | Sunday 18:00, if you're a lead who hasn't posted. |

Each person controls these in their profile's notification settings (older
accounts are upgraded to the new shape as they are read). Collaborators only
get due-date reminders if they opt in; the owner always does.

Reminders are never cancelled when a task changes. Moving a due date,
changing the owner or completing the task simply makes the old reminder do
nothing when it comes due: the worker re-checks that the task is still open,
that its due date is unchanged and that the recipient is still its owner (or
an opted-in collaborator). Moving a date away and back re-uses the same
pending reminder, so nobody gets two.

## For the platform operator

| What | Where |
|---|---|
| Reminders, digests, Sunday reminders | Job kinds `task-reminder`, `task-digest` and `weekly-update-reminder`, drained by `/api/cron/jobs` |
| Digest and Sunday-reminder scheduling | `GET /api/cron/task-digest` with `CRON_SECRET`, hourly (Vercel Pro cron, or the `Jobs pinger` GitHub workflow on Hobby, which calls it every 15 minutes) |
| Daily fallback | `GET /api/cron/task-digest?mode=daily` (in `vercel.json`) schedules the next 24 hours at each person's local hour, so a daily-cron-only deployment still sends on time |
| Deep links | `NEXT_PUBLIC_APP_URL` must be the app's real origin: it builds every link in task email |

Both trigger modes are idempotent (one key per person per local date or
week) and can run side by side. The crons only enqueue; nothing is sent
until the job drain runs. `/api/cron/task-digest` fails closed without
`CRON_SECRET`.

## Local development

`pnpm db:seed` loads the Claude Builders Club board: tasks with one owner
and a due date each, a blocked task, subtasks handed down from Oliver to
Alex and Smyan, a flagged above-level assignment, comments with a mention,
the Design Requests queue and last week's Sunday updates.

Mail goes to `.data/mail/` (open the `.html` files). Email from a click is
sent when the request finishes; reminders, digests and Sunday reminders wait
for a drain:

```
pnpm jobs:drain            # run everything due once
pnpm jobs:drain --watch    # keep draining every 5 seconds
```

To schedule digests and Sunday reminders locally, call the cron the way
Vercel does:

```
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/task-digest
```
