# Forms

Forms replaces the Polls section. It is one place for quick polls, applications, sign-ups and feedback.

## What a form is

- `Form` holds the questions (JSON, validated by `src/lib/forms/questions.ts`) and the settings: who can answer, one each, anonymous, review, notify, closing time, response cap.
- Every form owns a club database (`DatabaseDefinition`, kind `CUSTOM`, visible to owners and admins by default). A "Response" column names each row. Each question that takes an answer is a column, kept in step as questions are renamed, reordered or given new choices. A removed question keeps its column, so no answer is lost.
- Answers use the existing field types: choices are select choices (an "Other" answer becomes a new choice), checkboxes are multi-select, yes or no is a checkbox, ratings and scales are numbers, a ranking is the choices in order (one per line), uploads are links to the file in Files.
- `FormResponse` holds who answered (unless anonymous) and the review: status (New, Accepted, Waitlisted, Declined), a 1 to 5 rating and officers' notes. Owners and admins only.

## Answering

- `/f/{slug}`, one question per screen, in the club's theme. Letter keys pick choices, Enter goes on, the arrows go back and forth. Skip rules (`logic`) only jump forward, so a form can't loop. Hidden fields read the link's query (`?source=instagram`).
- Access: anyone with the link (no sign-in), members only, or signed in and one each. The public submit (`src/server/forms/public.ts`) runs on the service path after checking the form is open, the person may answer, and every answer fits its question and its column. Rate-limited per address, with a honeypot.
- Uploads (`POST /f/{slug}/upload`) are stored in the club's Files, in the folder made with the form, credited to the form's creator, and counted toward storage (`confirmFits` in the row's transaction).

## Quick polls

- Members only: a question poll (`Poll`), exactly as before. That keeps live counts, the anonymity the database enforces, and members adding options. Its page is `/forms/polls/{id}`.
- Anyone with the link (owners and admins): a one-question form (`kind = QUICK_POLL`) that can show its results after answering.
- Create copies the link either way.

Question polls were not copied into forms. Their anonymity is enforced by RLS on `PollVote`, and a copy into a database record could not keep that promise. They are listed in Forms and work as they did. The old `/calendar/polls` pages forward into Forms.

## Running a form

`/forms/{id}`, for owners and admins:

- Build: the questions, a live preview, and the settings of the one you're on.
- Settings: everything saves on change.
- Share: the link and a QR code.
- Responses:
  - Table: the columns.
  - Review: one at a time, with Accept, Waitlist or Decline and Undo, plus stars and notes.
  - Summary: a chart per question.
  - Ask Claude: questions about the response set, through the club's AI connection.
