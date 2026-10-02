# AI imports

Two ways to skip typing things in, using whichever AI model the club has
connected:

1. **Action items into tasks and events.** Paste a to-do list or meeting
   notes (Tasks › **Paste a list**, or a note's **…** › **Make tasks from
   this note**). The model proposes tasks with owners, helpers, due dates
   and priorities, plus calendar events for meetings with a time.
2. **A screenshot into calendar events.** Drop, paste (Ctrl+V) or pick a
   screenshot of an invite, an email, a calendar entry or a flyer
   (Calendar › **From a screenshot**, owners and admins). The model reads
   the title, date, times, timezone, place, details and any video link.
3. **Past money records into Finance** (Finance › **Import**, owners and
   treasurers): a spreadsheet's columns and categories, or the records in a
   PDF, a photo or pasted history. See `finance-setup-and-import.md`.

In both, **nothing is created until a person reviews it.** Every proposed
row can be edited, unchecked or switched between task and event, and
creating goes through the normal task and event actions, so permissions,
assignment rules, notifications, Google Calendar sync and the activity log
work exactly as if each one had been typed by hand.

## Which model

`src/server/ai/connections.ts` lists what the club can use, best first:

| Connection | Where it's set | Who pays |
|---|---|---|
| Claude (the club's key and model) | Settings › Integrations › Claude API | the club's Anthropic account |
| Another model (OpenAI, Gemini, OpenRouter, Mistral, Groq, Together, DeepSeek, xAI) | Settings › Integrations › Other AI models | the club's account with that provider |
| Claude (the platform's key) | `ANTHROPIC_API_KEY` on the server (`AI_IMPORT_MODEL` picks the model, default Claude Sonnet 5) | the platform |
| Local stand-in (no AI) | `AI_STANDIN=1`, never on Vercel | nobody: splits lines, for trying the flow |

When more than one is available, the import box offers a picker. The other
providers all speak the OpenAI chat-completions protocol at a **fixed
address in code** (`src/lib/ai/vendors.ts`): an admin picks a vendor from a
list and never types a URL, so the server only ever calls those hosts. The
model id is free text (validated); **Test connection** reads the vendor's
model list (free, no model is run) and checks the id is there.

## How a request is made (`src/server/ai/generate.ts`)

- One request, no tools, capped output tokens, a 50 s timeout (routes allow
  60 s), redirects refused.
- The answer must match a zod schema: Claude's structured outputs, or a
  strict `json_schema` response format for the others (JSON mode with the
  schema in the prompt for a vendor without strict schemas). It is
  validated again on the server and cleaned up (`src/lib/ai/*.ts`
  `normalize…`): unknown members dropped, dates and times checked, lengths
  capped, at most 100 items or 20 events.
- Errors are short and say what to do ("Claude rejected the API key. An
  owner or admin can update it…"); they never contain the input.

## Security and privacy

- **Prompt injection.** What members paste or upload is untrusted data. The
  text travels inside `<items>…</items>` (a closing tag in the text is
  defused), and the system prompt says never to follow instructions inside
  it and to note any it ignored. With no tools and a fixed answer schema,
  the most a manipulated model can do is propose wrong rows, which a person
  sees before anything happens. Owner and helper keys it returns are only
  accepted if the server handed them out.
- **What leaves Bananasplit.** For action items: the pasted text, today's
  date and the club's timezone, and the member roster as `m1: Name
  (Title)` (opaque keys; never user ids, emails or roles). For a
  screenshot: the image (shrunk in the browser to at most 1600 px) and the
  date and timezone. The import box says which provider it goes to and
  whose account.
- **What's kept.** Nothing from the request: not the text, not the image,
  not the model's answer. Each read writes one org audit row
  (`ai.action_items_read`, `ai.calendar_screenshot_read`) with the
  connection, the model and sizes (characters or bytes, item counts), never
  the content.
- **Keys.** Club keys are integration secrets like every other one:
  envelope-encrypted in `OrgSecret`, write-only in Settings, decrypted only
  for the request that uses them, outside any transaction, never logged or
  returned. Members can use the imports without being able to read the
  integration rows; they only ever see labels.
- **Who can do what.** Any member can import action items (they create
  tasks with their own rights; assigning above their level asks for the
  usual confirmation). Screenshots into events need `events.write` (owners
  and admins), checked in the route and again by the event action. Only
  owners and admins connect or change models; only owners remove them.
- **Limits.** 20 AI reads per member per hour and 120 per club per hour
  (`checkRateLimit`), 20,000 characters per paste, 4 MB per upload (checked
  by its bytes: PNG, JPEG, WebP or GIF only).

## API

| Route | Who | Body | Answer |
|---|---|---|---|
| `POST /api/orgs/{orgId}/ai/action-items` | members | `{ text, connection? }` | `{ items, notes, members, readBy, canCreateEvents, rules, timezone, today }` |
| `POST /api/orgs/{orgId}/ai/calendar-screenshot` | `events.write` | multipart `file`, `connection?` | `{ events, notes, readBy, timezone, members }` |
| `POST /api/orgs/{orgId}/ai/finance-import` | `finance.manage` | `{ mode: "sheet", sample }`, `{ mode: "text", text }`, or multipart `file` (PDF or picture); `connection?` | `{ mapping, labels, notes, readBy }` or `{ kind, rows, budget, notes, readBy }` |

Both are same-site only (`isCrossSite`), signed-in, and answer 404 to a
non-member, 409 `{ code: "no-connection" }` when nothing is connected, 429
when rate-limited, and the model's own short error otherwise. Creating
uses `createTasksFromImport` (tasks) and `createEvent` (events), both
Server Actions.

## Files

- `src/lib/ai/vendors.ts`, `action-items.ts`, `calendar-shot.ts`,
  `types.ts`: vendors, answer schemas, clean-up, shared types (client-safe).
- `src/server/ai/connections.ts`, `generate.ts`, `imports.ts`,
  `route-context.ts`: connections, the model call, prompts, the roster.
- `src/app/api/orgs/[orgId]/ai/*`: the two routes.
- `src/components/ai/*`: the two dialogs, the model picker, the calendar
  button.
- Settings: `settings/integrations/ai-model/`, `saveAiModel` and
  `aiModelConnectionTest` in `src/server/integrations/`.
- Migration `20261006120000_ai_model_integration` adds the
  `OPENAI_COMPATIBLE` integration type (nothing else changes).
