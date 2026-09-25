# Tasks: setup

One task board per organization, **open by default**: every member sees
every task. A task can be marked **private**, and then only the people on it
(plus owners and admins) can see it at all.

Every task has **one accountable owner**, a due date and a status; anyone
else on it is a collaborator ("also involved"). Leads hand work down their
reporting line, break it into subtasks, and post a Sunday update.
Assignments, mentions, due-date reminders and the daily digest go out by
email.

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

| Setting                   | What it does                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `taskRequireOwner`        | A new top-level task must name an owner (requests in an intake queue are exempt: triage assigns them).                |
| `taskRequireDueDate`      | A new top-level task must have a due date.                                                                            |
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

## Who can see a task

The board is open on purpose: a club works better when anyone can find out
what is happening without asking. **Private** is the opt-in exception, for
the handful of things that are not everybody's business yet — succession,
a pay-style conversation, an unannounced partnership.

| Visibility                        | Who can read the task                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| **Everyone** (`ORG`, the default) | Every member of the organization.                                                            |
| **Private** (`PRIVATE`)           | Its **owner**, its **collaborators**, its **creator**, and org **OWNER/ADMIN**. Nobody else. |

### The database enforces it, not the app

The app_user `SELECT` policy on `Task` carries the rule, so a query that
forgot it returns nothing rather than leaking. The same predicate guards
the `UPDATE` and `DELETE` policies (you cannot blind-write a private task by
guessing its id) and the policies on everything that hangs off a task:
`TaskComment`, `TaskMention`, `TaskActivity`, `TaskAssignee`, `TaskLabel`
and the `Notification` rows that point at it. Writing INTO a private task is
guarded too, so nobody can drop a comment, a mention or a collaborator into
a thread they cannot see.

Two consequences worth knowing:

- Opening `/app/{org}/tasks/{id}` for a task you cannot see is a plain
  **404** — the same answer as a task that does not exist.
- Counts differ per viewer. "Oliver: 4 open" means four that _you_ can see.
  The Week view says so when you are looking at somebody else's work.

### Subtasks

**A subtask always has its parent's visibility.** You cannot make one
subtask of a private task public, or vice versa: the parent decides for the
whole tree, and a database trigger keeps them equal in both directions
(a new or re-parented subtask takes the parent's flag; changing the parent's
flag pushes down to the children).

A subtask can still be handed to somebody who is not on the parent — that is
the point of handing work down. They see the subtask and not the parent, and
the parent breadcrumb simply does not render for them, because RLS filters
the relation too.

### Mentions

**On a private task you can only mention people who can already see it.**
The `@` picker offers only the audience, and the panel says so. A hand-typed
mention of anybody else is kept as plain text: no mention row, no
notification, no email. To mention somebody, add them as a collaborator
first — then they can see the task, which is the honest version of what a
mention means.

Making an open task private re-runs its stored mentions through the new
audience, so somebody mentioned while it was open stops being mentioned on
it, and their notification is already out of reach.

### Who can change the flag

**The task's owner, its creator, or an OWNER/ADMIN.** Not a collaborator:
otherwise adding one person to a private task would hand them the power to
publish it. Collaborators can still edit everything else.

Requests filed into an **intake queue are always open** — a queue nobody can
see is not a queue.

### Email, notifications and the Sunday update

- Assignment, mention and comment mail only ever goes to people on the task,
  so it is inside the audience by construction. The renderer re-checks at
  send time anyway, and drops a message whose task went private (or whose
  recipient came off it) between the click and the drain.
- The **daily digest** filters the one section that reaches past your own
  tasks: a report's private blocker is not their manager's business unless
  the manager is on it or is an admin.
- The **Sunday update** is the interesting case. A posted update is stored as
  text and read by the whole club, so a private title would be republished
  into the open the moment you hit Post. Private items therefore **appear in
  your draft** — it is your week, and you can see them — marked _"private,
  not posted"_, and are **left out of what is posted and copied**. The
  composer says how many were held back. Put them in the note yourself if you
  want to.

### In the interface

Privacy is never a hidden setting:

- A **lock** sits before the title in every layout — the week, the board, the
  table, the calendar, the team lanes — and cards carry a **dashed edge**,
  which nothing else in the workspace uses.
- The task panel has a labelled **Everyone / Private** control next to owner
  and due date, and when a task is private it lists **who can see it** by
  name and face.
- The toolbar's **Filter** menu has a visibility section: everything I can
  see / **Private only** / open to the club. It is also a URL parameter,
  `?visibility=private`.

## Day to day

### One workspace, five layouts, two destinations

There used to be seven tabs side by side. Five of them draw the same tasks in
different shapes; the other two are pieces of work you do. So the five are
**layouts** of one filtered question, sharing one toolbar, and the other two
became **destinations** in the header.

| Layout       | What it is good at                                                                                                                                                                                           | Key |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| **Week**     | What is owed and by when: Overdue / Today / Tomorrow / Next 7 days / Later / No due date, plus what was finished this week. The first thing you see.                                                         | `1` |
| **Board**    | Moving work along: Not started, In progress, **Blocked**, Completed. Dragging into Blocked asks what it's blocked on. Completed shows the last 14 days.                                                      | `2` |
| **Table**    | Filtering and bulk editing: 50 a page, sortable, hideable columns, bulk status, owner and delete.                                                                                                            | `3` |
| **Calendar** | Due dates on a month. Drag an event to move its date, or drag an undated task onto a day.                                                                                                                    | `4` |
| **Team**     | A lane per person down your reporting line (owners and admins can pick any position or the whole chart), with open hires, advisors and an unpositioned bucket. Each lane header has **New task for {name}**. | `5` |

| Destination       | What it is                                                                  |
| ----------------- | --------------------------------------------------------------------------- |
| **Requests**      | The intake queue (below). Hidden until an org has one.                      |
| **Sunday update** | The weekly composer (below). Carries a dot until you have posted this week. |

The toolbar above the layouts is the same in all five:

- **Scope** — _Mine_, _My team_ (only if you have reports) or _Everyone_.
- **Search** — by title; `/` focuses it from anywhere, Enter applies it.
- **Filter** — status, visibility, label, project.
- Active filters show as removable pills with **Clear all**.

All of it lives in the URL, so a filtered view is a link you can paste into
Slack and the Back button does the obvious thing. Switching layout keeps the
filters, and the layout you used last is remembered per person.

**Blocked is not a bucket in the Week.** A blocked task still has a due date,
and hiding it in a bucket of its own is how a blocker survives three weeks
unnoticed. It sits in its real week with its reason showing, and the count
line at the top (`3 overdue · 2 due today · 1 blocked · 1 flagged`) filters to
just those in one click. The **Blockers** filter (blocked plus overdue,
org-wide) is the exec-sync agenda.

Keyboard: `1`–`5` switch layout, `/` focuses search, `c` starts a task.

Deep links other sections use, all unchanged:

- `?view=table&owner={userId}&status=open` — that person's open tasks (the
  Org Chart side panel). `status=open` means not completed.
- `?view=table&assignee={userId}` — tasks involving that person, as owner or
  collaborator (the People pages).
- `?view=mine` — your week (now the Week layout with the scope set to Mine).
- `/app/{org}/tasks/{taskId}` — one task's own page (every email link).

### Who can change a task

Editing a task — title, description, status, due date, labels, project,
owner, collaborators, subtasks — is open to its **creator**, its **owner**,
anyone **involved**, a **chart manager of the owner** (anyone above them in
the published chart), the triage owner of its queue, and **owners and
admins**. Visibility is narrower: see _Who can change the flag_ above.

Everyone else gets the **self-assign carve-out**: any member may add or
remove **themselves** as a collaborator on any task they can see, and take
ownership of a task that has no owner. Nothing else — no title, status or
due-date edits, and never removing somebody else's ownership.

### Who can change the project list

**Owners and admins only.** Projects are org-wide structure: everyone sees
the same list in the project filter, one of them can be the intake queue,
and the Claude Builders Club set comes from **Bootstrap CBC workspace**. So
creating, archiving and unarchiving a project, and turning one into an
intake queue, all need the same permission. Every member still files tasks
into any project and filters by it. Ask an owner or admin for a new project.

### Handing work down

Assigning someone is classified against the published chart:

| Relation             | Meaning                                              | Flagged |
| -------------------- | ---------------------------------------------------- | ------- |
| Self                 | You assigned yourself                                | no      |
| Handed down          | They report to you (at any depth)                    | no      |
| Peer                 | Neither of you is above the other                    | no      |
| **Above your level** | They are your manager, or sit higher in another line | **yes** |
| Outside the chart    | No published chart, or one of you holds no position  | no      |

Assigning above your level is allowed, but the app asks you to confirm,
marks the assignment **Flagged** on the card, the row and the panel, and
says so in the email. The person it was assigned to, or an owner or admin,
clears the flag with **Acknowledge**.

The **Team** layout is the place to do this: each lane header carries
**New task for {name}**, which opens the composer with that person already
set as owner.

### Subtasks, comments and mentions

A lead breaks a task into subtasks, each with its own inline owner and due
date; subtasks appear in the Week, the Team view, the calendar and reminders
with their parent as a breadcrumb. Comments support markdown. Typing `@` in
a description or comment opens a member picker; the server keeps only real
members (and, on a private task, only the audience) and notifies the newly
mentioned, never you. Mentions in code blocks are left as text.

### The Design Requests intake queue

An intake queue lets **anyone** file a request while **one triage owner**
runs it. Owners and admins set one up in **Requests > Queue settings**:
pick a project, name the triage owner, and set the default due window (5
days for CBC's Design Requests).

- Anyone creates requests; each gets the default due date.
- Only the triage owner (or an owner or admin) sets a request's priority and
  owner, from the queue list or the panel.
- The triage owner is notified and emailed whenever a request is filed.
- Requests are always visible to the whole org.

The **Requests** button in the header shows how many are still waiting for
an owner.

### Sunday updates

**Sunday update** drafts each person's week from their tasks: **done this
week**, **what's next** (due within 7 days or in progress) and **blocked**,
with the reason. Weeks run Monday 00:00 to Sunday 23:59 in the org's
timezone.

- **Copy as text** gives a plain-text update to paste into Slack.
- **Post update** saves it (with an optional note) as that week's record.
- Private tasks are shown in the draft and left out of both, as described
  above.
- Owners, admins and whoever holds the top of the chart see **who hasn't
  posted**. The leads expected to post are everyone holding a filled,
  non-advisor position below the top of the published chart (without a
  chart: members with a title).
- A lead who hasn't posted gets a reminder on Sunday at 18:00 their time.

### Email and notification preferences

| Email                  | When                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Assigned               | You became a task's owner or collaborator (self-assignment sends nothing). One message lists every task of a bulk assignment. |
| Mentioned              | Someone @mentioned you in a description or comment.                                                                           |
| Commented              | Someone commented on a task you own or are on (off by default).                                                               |
| Due reminder           | The lead time before the due date, at 09:00 your time.                                                                        |
| Daily digest           | Your chosen hour (08:00 by default), if you turn it on.                                                                       |
| Sunday update reminder | Sunday 18:00, if you're a lead who hasn't posted.                                                                             |

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

| What                                  | Where                                                                                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reminders, digests, Sunday reminders  | Job kinds `task-reminder`, `task-digest` and `weekly-update-reminder`, drained by `/api/cron/jobs`                                                                                                   |
| Digest and Sunday-reminder scheduling | `GET /api/cron/task-digest` with `CRON_SECRET`, hourly (Vercel Pro cron, or the `Jobs pinger` GitHub workflow on Hobby, which calls it every 15 minutes)                                             |
| Daily fallback                        | `GET /api/cron/task-digest?mode=daily` (in `vercel.json`) schedules the next 24 hours at each person's local hour, so a daily-cron-only deployment still sends on time                               |
| Deep links                            | `NEXT_PUBLIC_APP_URL` must be the app's real origin: it builds every link in task email                                                                                                              |
| The visibility predicate              | `app.can_read_task(taskId)` (migration `20260924140000_c4_task_visibility`). Jobs run as app_service, which sees the whole org on purpose and filters in code — see `src/server/tasks/visibility.ts` |

Both trigger modes are idempotent (one key per person per local date or
week) and can run side by side. The crons only enqueue; nothing is sent
until the job drain runs. `/api/cron/task-digest` fails closed without
`CRON_SECRET`.

## Local development

`pnpm db:seed` loads the Claude Builders Club board: tasks with one owner
and a due date each, a blocked task, subtasks handed down from Oliver to
Alex and Smyan, a flagged above-level assignment, comments with a mention,
the Design Requests queue, last week's Sunday updates, and **three private
tasks** — Jackson's "Spring exec transition plan" (with Oliver on it, and a
subtask that inherits the flag) and Oliver's "1:1 notes and growth plan for
Alex". Sign in as `kristine@example.edu` to see the board without them.

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
