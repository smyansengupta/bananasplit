# AI connectors: privacy and terms additions (DRAFT)

> **DRAFT FOR LEGAL REVIEW. NOT FINAL, NOT PUBLISHED.** Written by the
> engineering side on 2026-11-01 from how the feature works, for counsel to
> review, change and approve. It is not legal advice. Nothing here is on
> the site: the privacy policy (`src/app/privacy/page.tsx`) is unchanged,
> and there are no published Terms of Service yet (`TERMS_HREF` in
> `src/lib/brand/links.ts` is `"#"`).

The directories need both pages live before review: Claude's listing asks
for a privacy policy URL, and ChatGPT's for a privacy policy and a terms of
service URL (`ai-connectors-launch.md`).

## The facts the text relies on

Check these with engineering before relying on any sentence below.

- **What an AI app receives.** Only results of the tools the member's AI
  app calls while the member uses it: what the member could see in
  Bananasplit, as that member. That can include other people's content the
  member can see: names, titles and roles, notes, comments, task and event
  details, database rows, poll results, and member emails where the
  organization shows emails to that member. Nothing is sent to an AI app
  on its own initiative; the app asks, as the member.
- **What an AI app can change.** Only if the member chose "Read and make
  changes" when connecting: create and update tasks, comment on tasks,
  RSVP, add and update rows in databases the space made, post the member's
  own weekly update, vote in polls, and create private notes. No tool
  deletes, sends email or messages, shares or publishes anything, or
  touches settings, members, roles, money or the audit log.
- **The AI app is the member's choice and its provider's responsibility.**
  Bananasplit doesn't choose, run or pay for the model. What the AI app's
  provider (Anthropic, OpenAI, Cursor, Microsoft and others) does with the
  data it receives is governed by the member's agreement with that
  provider. They are not Bananasplit's AI Service Providers in section 5 of
  the current policy.
- **WorkOS** (WorkOS, Inc.) runs the sign-in authorization for AI apps
  (OAuth: client registration, consent screen, tokens). When a member
  connects an app, Bananasplit sends WorkOS the member's Bananasplit user
  id, email address and name. WorkOS keeps a user record with them, the
  apps the member authorized, and the consent choices. WorkOS also sees
  the AI app's registration details and the usual request metadata (IP
  address, browser). It does not receive the member's Bananasplit content.
- **What Bananasplit stores.** For each connected app: which app (its
  client id and name), the WorkOS user id, the consent id, read or change,
  which space, when it was connected and last used, and when it was
  disconnected. Each change an app makes is in the organization's audit
  log, with the app's name. Rate-limit counters hold hashed keys only.
  Tokens are never stored or logged.
- **Retention.** A connection record stays until the account is deleted
  (it is kept, marked disconnected, after Disconnect, so the app can't use
  an old token). Audit entries stay with the organization's audit log
  (counsel: confirm the retention period stated for it). WorkOS keeps its
  records under its own terms until the user is deleted there; account
  deletion must also delete the WorkOS user.
- **Controls.** A member disconnects any app (or all) on their profile; a
  password reset disconnects all of them. An organization's owners and
  admins can turn AI apps off for the organization, which refuses every
  app's access to it at once.

## Privacy policy additions

Section numbers are the current page's. Wording follows the page's own
voice ("we", "you", "Services").

**Summary of key points** (a new bullet):

> **Do we share your information with AI apps you connect?** Only if you
> connect one. If you connect an AI app such as Claude or ChatGPT to
> Bananasplit, that app receives the information it asks for while you use
> it, limited to what you can see in Bananasplit. Learn more about
> [AI apps you connect](#aiapps).

**1. What information do we collect?** (after "Personal information you
disclose to us"):

> **AI app connections.** If you connect an AI app to your account, we
> record which app you connected, the choices you made when connecting it
> (which spaces it may use, and whether it may only read or may also make
> changes), and when you connected it and last used it.

**2. How do we process your information?** (a new list item):

> **To provide AI app connections you choose.** If you connect an AI app,
> we process your information to authorize that app, to answer the
> requests it makes on your behalf, and to record the changes it makes in
> your organization's audit log.

**3. When and with whom do we share your personal information?** (two new
list items):

> **AI apps you connect.** If you connect an AI app (for example Claude,
> ChatGPT, Cursor or Visual Studio Code) to your account, we share with
> that app the information it requests on your behalf, limited to what you
> can see in the Services. This can include content other members of your
> organizations created and that you can see, such as names, notes, tasks,
> events and, where your organization shows them to you, email addresses.
> The app's provider processes that information under its own terms and
> privacy notice, not ours. You can disconnect an app at any time from
> your profile, and an organization's administrators can turn off AI apps
> for their organization.
>
> **Service providers for AI app sign-in.** We use WorkOS, Inc. to
> authorize AI apps you connect. When you connect one, we share your name,
> email address and account identifier with WorkOS, which stores them with
> the list of apps you have authorized.

**5. Do we offer artificial intelligence-based products?** (a new
sub-section, `id="aiapps"`):

> **AI apps you connect.** Separately from our own AI Products, you can
> connect a third-party AI app to your Bananasplit account using the Model
> Context Protocol. The AI app, and the AI model behind it, is chosen and
> provided by you and its provider, not by us, and is not one of our AI
> Service Providers. The app can read only what you can see in the
> Services, acting as you, and can make changes only if you allowed that
> when you connected it. It cannot send email or messages, share or
> publish content, or change settings, members or finances. We do not
> control how the app's provider uses the information the app receives;
> review its terms and privacy notice before connecting it.

**7. How long do we keep your information?** (a new paragraph):

> We keep a record of each AI app you connected for as long as you have an
> account, including after you disconnect it, so that the app can no longer
> use access it was given before. Changes an AI app made are kept in your
> organization's audit log.

**10. What are your privacy rights?** (a new paragraph, near "Withdrawing
your consent"):

> **Disconnecting AI apps.** You can disconnect any AI app you connected,
> or all of them, at any time from your profile in the Services. The app
> loses access at once. Resetting your password also disconnects all of
> them.

## Terms of Service additions

There are no published Terms yet, so these are clauses to include when they
are written.

> **Connected AI apps.** The Services let you connect third-party AI
> applications ("AI Apps") to your account. An AI App acts on your behalf:
> it can access what you can access in the Services and, if you allow it,
> make changes as you. You are responsible for the AI Apps you connect and
> for what they do with your account, as if you had done it yourself. Your
> use of an AI App is governed by your agreement with its provider; we do
> not provide, control or endorse any AI App, and we are not responsible
> for its output, its availability, or how its provider handles
> information it receives.
>
> **Other people's content.** When you connect an AI App, content other
> members shared with you in an organization can be sent to that App when
> it acts for you. Connect an AI App only where your organization allows
> it and in line with its rules. An organization's administrators may turn
> AI Apps off for the organization at any time.
>
> **Limits and changes.** We may limit how often an AI App may access the
> Services, refuse access to an AI App that misuses them, and change or
> remove the tools we offer to AI Apps. AI-generated content and changes an
> AI App makes are provided "as is"; check them before relying on them.

## Questions for counsel

- Does sharing with an AI app the _member_ chose count as a "sale" or
  "sharing" under US state laws (section 12)? Our view from the facts: the
  member directs it, and we receive nothing in return.
- Does the organization (as a controller of its members' content) need
  terms of its own allowing members to connect AI apps, given admins can
  switch it off and it is on by default?
- WorkOS's DPA and data location, and whether WorkOS belongs in a
  published subprocessor list.
- Whether the summary should name example AI apps by name.
