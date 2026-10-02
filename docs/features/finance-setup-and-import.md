# Finance: setup guide, widgets and imports

Three ways into a club's money, all for owners and treasurers (the only
roles that see it; the database enforces the same rule):

1. **Finance › Set up** walks a club through its money in about five minutes.
2. **The dashboard** is each treasurer's own board of widgets, with a gallery
   to add more.
3. **Finance › Import** brings in past records: spreadsheets, bank, card and
   Venmo exports, PDFs, photos and old budgets. The club's AI model can read
   the messy ones.

Everyone else who opens a finance page is told who manages the money and what
they can do (ask to be paid back; an admin can choose a treasurer), instead of
an error. `FinanceAccessGate` renders it in place of the page: a thrown
`ForbiddenError` reaches a production browser only as "Something went wrong",
because Next.js hides server error details there. Finance's own `error.tsx`
shows the error's digest so it can be found in the server logs.

## The setup guide (`/finance/setup`)

| Step | Saves | Done when |
|---|---|---|
| Your money year | `createBudgetPeriod` / `updateBudgetPeriod` | an active period exists |
| What you have now | `setStartingBalance`: one reconciled ADJUSTMENT called "Starting balance" in the active period (signed; 0 removes it) | it exists, or the period has transactions |
| Your budget | `saveBudgetLines`: renames, amounts, additions; removes a line only if no transaction uses it | any category has money allocated |
| Who handles money (optional) | `changeMemberRole(…, "TREASURER")` for a member (owners and admins) | the club has a treasurer |
| Past records (optional) | the import below, embedded | the period has transactions |
| Your dashboard (optional) | `saveBoardAction("finance")` | this member saved a board |

Progress is derived from the books (`src/lib/finance/setup.ts`,
`loadSetupState`), never stored. Until the first three are done the dashboard
shows a banner with what's left; it can be hidden in that browser.

## Widgets

The dashboard is the shared `WidgetBoard`: **Add widget** opens the gallery
(there's also a tile at the end of the board), and each widget's menu resizes,
moves or removes it. New in this change: *Left to spend*, *Where money came
from*, *Reimbursement requests*, *Shortcuts* and *Finance setup*
(`src/lib/finance/widgets.ts`, bodies in `finance-widgets.tsx`).

## Importing past records (`/finance/import`)

**Spreadsheets are read in the browser.** CSV, TSV and pasted rows
(`sheet.ts`) and Excel workbooks (`xlsx.ts`: no library beyond `fflate`; only
the workbook, sheet, string and style parts are inflated, with a size cap) never
leave the computer. Only the rows the treasurer imports are sent, through the
import action.

**Columns are guessed** (`mapping.ts`): header words first (a bank's
"Description" beats its "Details", and a *Balance* column is never read as an
amount), then the values (a column of dates, a column of amounts, the longest
text). The sign rule follows the sheet: signed amounts read like a bank (negative
is money out), separate money in and money out columns, a type column
(Income/Expense, Credit/Debit), or an all-positive list that's spending unless
its header says income. Dates take US, day-first and ISO forms, month names,
Excel date numbers, and dates without a year (the most recent one). Amounts
take `$1,234.56`, `(12.00)`, `- $25.00`, `1.234,56` and the like, always as
integer cents (`values.ts`).

**Or the AI model reads it** (`POST /api/orgs/{orgId}/ai/finance-import`,
`src/server/ai/finance-import.ts`), using the same connections as the other
AI imports (see `ai-imports.md`):

- *A spreadsheet*: the model sees the first 32 and last 6 rows and each text
  column's distinct values (`sample.ts`), and answers with the column mapping
  plus a category and kind for those values. The browser applies that to every
  row, so a 2,000-row ledger is one short request.
- *A PDF, a photo or pasted text* (a Venmo history, a statement): the model
  lists the records, up to 300. PDFs need Claude or a vendor that accepts files.

Same rules as the other AI imports: the material is wrapped as untrusted data
(its tags can't be closed from inside), no tools, a strict answer schema
re-checked on the server (labels only for values that were sent), 20 reads per
member and 120 per club per hour, and an audit row with sizes only
(`ai.finance_import_read`).

**Review, then import.** Every row is editable (date, description, amount,
in or out, type, category), totals and balance lines are left out, and rows
already in the books (same day, amount and direction) are unticked. Each row
goes into the budget period covering its date; dates outside every period get
new, inactive periods shaped like the club's own (school year, semester or
calendar year, never overlapping an existing one), and missing categories are
created at $0 (both can be turned off). Rows can be marked reconciled.

`importFinanceRecords` (`src/server/finance/import.ts`) writes up to 1,000 rows
per call, one database transaction each. Rows are the importer's, with status
NOT_APPLICABLE (money that already moved, so nobody is owed it). Each row gets
a finance audit entry tagged with the import's batch id, and one org audit row
records the counts. **Undo this import** finds the rows by that batch id and
deletes them the usual way (voided as "Deleted", unlocking reconciled ones).

A budget sheet (category and planned amount) updates categories by name on the
chosen period, adding the rest (`importFinanceBudget`).

## Files

- `src/lib/finance/import/`: `values.ts`, `sheet.ts`, `xlsx.ts`, `mapping.ts`,
  `plan.ts`, `sample.ts` (all client-safe and unit-tested)
- `src/lib/ai/finance-sheet.ts`, `src/server/ai/finance-import.ts`,
  `src/app/api/orgs/[orgId]/ai/finance-import/route.ts`
- `src/server/finance/import.ts`, `src/server/finance/setup.ts`,
  `src/app/app/[orgSlug]/finance/{import,setup}-actions.ts`
- `src/components/finance/import/*`, `src/components/finance/setup/*`,
  `src/components/finance/finance-access.tsx`
- Tests: the `*.test.ts(x)` beside each, `finance-import.db.test.ts` (real
  roles and policies).
