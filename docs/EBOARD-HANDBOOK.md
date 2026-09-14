# E-board handbook

This is for the humans running the club, not for developers — it's what next
year's e-board needs that isn't in the code. See `CONTRIBUTING.md` /
`docs/ARCHITECTURE.md` for the technical side, and `RUNBOOK.md` for
deployment/restore procedures.

## Roles

- **OWNER** — full control, including inviting/removing members and changing
  roles. Usually the club president or whoever set the org up.
- **ADMIN** — org management (members, labels, most content) but not finance.
- **TREASURER** — finance access (transactions, budget, sponsorships,
  reimbursements) plus ordinary member access everywhere else. Not a rung on
  the admin ladder — a treasurer who isn't also an admin can't manage
  members.
- **MEMBER** — everything else: their own tasks, notes, expense submissions.

## Treasurer handoff (do this every time the role changes hands)

1. **Reconcile the current budget period** before handoff, not after. The
   outgoing treasurer should mark all pending expenses (Submitted/Approved)
   resolved one way or another — reimbursed, rejected, or explicitly left
   open with a note why — so the incoming treasurer starts from a clean
   state, not an unexplained backlog.
2. **Verify the closing balance** against the club's actual bank/SGA
   statement. The app's balance is a derived ledger, not a bank feed — it's
   only as correct as what got entered. Reconcile monthly, not just at
   handoff (see "Ongoing habits" below).
3. **Reassign the `TREASURER` role** in Settings → Members to the incoming
   treasurer, and remove it from the outgoing one if they're leaving the
   e-board entirely.
4. **Rotate anything the outgoing treasurer had access to** that isn't
   role-based in-app: if they ever had the Vercel/Neon account password, the
   Blob storage token, or the Google Cloud project access, rotate or
   transfer it. Losing a graduating treasurer's access is the single most
   common way these tools go stale.
5. **Start a new budget period** for the new fiscal year/semester from
   Finance → Budget → New period, with real allocation numbers from the
   funding award — don't inherit last year's guesses.

## Ongoing habits (these are habits, not features)

- **Reconcile monthly** against the official statement (bank, SGA, Campus
  Activities — whatever your club's real system is). An unreconciled ledger
  nobody checks is worse than no ledger, because people trust it anyway.
- **Decide records retention up front.** Student government audits often
  reach back one to three years — decide how long receipts and transactions
  are kept, and don't quietly let it drift.
- **Nothing sensitive goes in the app.** No bank account numbers, no routing
  numbers, no card numbers, no images of checks. The app *records that*
  reimbursement happened; it doesn't execute payment. If someone asks to
  "just put my Venmo in my profile," that's a deliberate decision to make,
  not something to add by accident.
- **Sponsorship money often has strings.** Corporate sponsorships routed
  through the university can raise tax/contract questions — loop in your
  student activities office before invoicing a company, not after.

## Ownership and continuity

Decide this in writing, now, while everyone involved is still around to ask:

- Who owns the Vercel account (and pays for it, if it's ever upgraded off
  the free tier)?
- Who owns the Neon (database) account?
- Who owns the Google Cloud project the OAuth client lives in?
- Who owns the domain, if you have a custom one?
- Who gets paged (or just gets the email) when something breaks and the
  original student developers have graduated?

This is the most common way small student-built tools die — not a bug, but
nobody left holding the accounts. One conversation now is cheaper than
reconstructing access later.

## Getting a new e-board member started

1. An OWNER or ADMIN invites them from Settings → Members with their school
   email and a role.
2. They accept the invite by signing up (or signing in with Google) using
   that same email — the pending invite shows up automatically on their
   onboarding screen.
3. Point them at this document and at the app itself; there's no separate
   training environment, but a `MEMBER` account can't see or touch finance
   data, so it's safe to let new members explore.
