# The First Ambient Workplace

What Bananasplit is working towards, and how to judge what to build next.
The home page leads with it (`src/components/marketing/sleek/`); this is
the idea behind that headline.

## What it means

**Ambient:** technology that works in the background and comes to you,
instead of waiting for you to open it.

**Ambient workplace:** a workspace that runs a team's admin on its own. It
takes in work from wherever it happens, keeps everything current without
anyone updating it, does the routine follow-through, and reaches people only
for decisions.

> Your team's work keeps itself up to date. It listens where you already
> work, handles the busywork, and texts you only when something needs you.

## The goal

**Nobody on the team should need to open the app to keep it current.**

Today Bananasplit is a very good place to put work. Ambient means it keeps
the work current itself. Most of what the home page shows still happens
because someone opened the app and did it, and texting, the heart of the
pitch, is not live yet: the iMessage step in onboarding exists, the texting
service behind it does not.

**North-star metric: the hands-off rate.** The share of updates to a
workspace (tasks made, meetings moved, notes filed, receipts logged,
statuses changed) that happened without anyone opening the app. A
traditional tool sits near 0%. The target is above 50%.

## Principles

1. **It comes to you.** Default to telling people, not waiting for them to
   look.
2. **No typing things in twice.** If it already exists in an email, a
   meeting, a text or a chat, capture it from there.
3. **Ask only for decisions.** People approve the work; they don't do it.
4. **Everything visible, everything undoable.** Every automatic action says
   who or what did it, and can be reversed.
5. **The dashboard is a window, not a job.** People open it to look, never
   because it's out of date.

The test for any feature: **does it remove a reason to open the app?**

## What to build, in order

| #   | Capability               | What it means                                                                                                                                                                                                           | Where we are                                                                                  |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Two-way texting          | iMessage and SMS that take actions ("move standup to 10") and answer questions ("what's left in the ads budget?"), confirm what changed, and take photo receipts.                                                       | Not live: onboarding's iMessage step only. The foundation for 2, 4 and 5.                     |
| 2   | It comes to you          | A morning brief by text; nudges for a deadline at risk, a budget over, someone blocked, an unanswered poll, low RSVPs; quiet hours and per-person settings.                                                             | The weekly pulse and the finance digest are the seeds; make them personal, timely and texted. |
| 3   | Work that updates itself | Meeting follow-through (Granola notes on the meeting, action items as tasks with owners, the follow-up drafted); email threads that move their tasks; stale-work detection; automatic status where the signal is clear. | Notes and inbox-to-tasks exist; follow-through and status do not.                             |
| 4   | Approvals by reply       | Paybacks, schedule changes and AI-drafted updates approved by replying "yes".                                                                                                                                           | Approvals live in the app only.                                                               |
| 5   | It follows through       | Chases overdue items with the person responsible (with your OK), collects weekly updates and writes the summary, confirms RSVPs, reminds no-shows.                                                                      | Reminders exist; chasing does not.                                                            |
| 6   | Team memory              | Knows who "Maya", "the launch" and "the budget" are across texts, docs and meetings, shared with Claude and ChatGPT through the connectors.                                                                             | Connectors exist; shared memory does not.                                                     |
| 7   | Trust controls           | A feed of what it did on its own, with undo; how much it may do alone (suggest, do and tell me, or just do it), per person and per kind of action.                                                                      | The audit log is the start. Needed before 4 and 5 act on their own.                           |

**First three to ship:** two-way texting (the page leads with it), the
morning brief and nudges (the fastest way to feel ambient, on top of the
pulse and digest), and meeting follow-through from Granola (the most visible
"it did that on its own").
