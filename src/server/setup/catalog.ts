import type { IntegrationProvider } from "@/generated/prisma/enums";

/**
 * The guided setup (C1): what each step connects, what it unlocks, exactly
 * where the credential comes from, and what it costs the club to say yes.
 *
 * This module is pure data. No server-only import, no database, no secret:
 * the step panels are client components and render this copy directly.
 * Everything that touches a credential goes through
 * src/app/app/[orgSlug]/setup/actions.ts -> src/server/integrations/service
 * -> src/server/secrets.
 *
 * Order is time-to-value, not alphabet: the website data source is first
 * because it is the only step that fills empty screens, and it is the one
 * whose result screen has something to show.
 */

export const SETUP_STEP_IDS = ["data", "calendar", "email", "claude"] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export function isSetupStepId(value: string): value is SetupStepId {
  return (SETUP_STEP_IDS as readonly string[]).includes(value);
}

/** One numbered instruction. `code` is shown as a copyable line under it. */
export interface CredentialStep {
  text: string;
  code?: string;
}

export interface SetupStepDefinition {
  id: SetupStepId;
  provider: IntegrationProvider;
  /** The settings sub-page that owns this integration for the long term. */
  settingsSegment: string;
  title: string;
  /** One line under the title: what this step IS. */
  summary: string;
  /** What the club gets that it did not have. Concrete, not a feature list. */
  unlocks: string[];
  /** An honest estimate for someone who has the credential to hand. */
  minutes: number;
  /** What someone has to do elsewhere before this step can succeed at all. */
  prerequisite: string | null;
  /** Where the credential comes from, click by click. */
  where: CredentialStep[];
  /**
   * What saying yes actually costs or exposes. Never marketing: the access
   * granted, the money spent, the thing that will surprise them later.
   */
  consequences: string[];
  /** What the club loses by skipping. Shown on the skip control. */
  ifSkipped: string;
}

export const SETUP_STEPS: readonly SetupStepDefinition[] = [
  {
    id: "data",
    provider: "SUPABASE_SOURCE",
    settingsSegment: "data-source",
    title: "Club website data",
    summary:
      "Read check-ins, signups and ballots from the Supabase project behind your club website.",
    unlocks: [
      "Attendance, Signups, Ballots and People stop being empty",
      "Reports start working: attendance over time, retention, stamp cards",
      "New check-ins arrive every hour on their own",
    ],
    minutes: 5,
    prerequisite:
      "Someone with access to the website's Supabase project has to run one SQL file there first. It takes a minute, and step 1 below is exactly that.",
    where: [
      {
        text: "Open your club website's repository and copy the whole of supabase/suite-export.sql.",
        code: "supabase/suite-export.sql",
      },
      {
        text: "In Supabase, open the project, then SQL Editor, then New query. Paste the file and press Run. Run the four checks printed at the foot of that file: all four must pass.",
      },
      {
        text: "Still in the SQL editor, give the reader role a long random password. Copy it somewhere safe first: you paste it below once and never see it again.",
        code: "alter role cbc_suite_reader with password '<a long random password>';",
      },
      {
        text: "At the top of the Supabase dashboard press Connect, then open Session pooler. The connection string holds everything else: the 20 letters after postgres. are the project ref, and the host names the prefix (aws-0 or aws-1) and the region.",
        code: "postgres://postgres.abcdefghijklmnopqrst@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
      },
      { text: "Fill the four fields below and paste the password." },
    ],
    consequences: [
      "The portal signs in as cbc_suite_reader, a role that may call six export functions and nothing else. It cannot select from your tables, and it cannot read the room codes that gate check-in.",
      "It is read-only in both directions: nothing in this portal is ever written back to your website.",
      "Do not add suite_export to Settings, API, Exposed schemas in Supabase. That would put a roster reader behind your website's public key.",
      "The password is encrypted before it is stored and is never shown again, here or anywhere else.",
    ],
    ifSkipped:
      "Attendance and Signups stay empty until you import a CSV or add rows by hand. You can connect the website later without redoing anything.",
  },
  {
    id: "calendar",
    provider: "GOOGLE_CALENDAR",
    settingsSegment: "google-calendar",
    title: "Google Calendar",
    summary: "Mirror the sessions you schedule here onto the club's Google calendar.",
    unlocks: [
      "Sessions created here show up on the club calendar automatically",
      "Events already in Google can be brought in, after you review them",
      "Officers see one calendar instead of two",
    ],
    minutes: 2,
    prerequisite: null,
    where: [
      {
        text: "Press Connect below. Sign in with the Google account that owns the club's calendars — for most clubs that is the club's own Gmail, not your personal account.",
      },
      {
        text: "Google asks for two permissions: manage the events this app creates, and see the list of your calendars. Both are required; there is no narrower pair.",
      },
      {
        text: "Come back here and choose which calendar public events go to, and optionally a second one for internal events.",
      },
    ],
    consequences: [
      "The portal writes only to the calendar you pick, and only events it created itself. It cannot read, edit or delete anything else on that account — Google enforces this, not us.",
      "Public events go to the calendar you choose for public. Internal events go to the internal calendar, or nowhere if you leave that blank.",
      "Disconnecting revokes the access at Google. Events already mirrored stay on the calendar; they stop updating.",
      "Signing in with a personal account means the club's calendar leaves when you do. Use the club account.",
    ],
    ifSkipped:
      "Sessions live only in this portal. The calendar page still works, and the public events feed still works; nothing appears on Google.",
  },
  {
    id: "email",
    provider: "EMAIL_RESEND",
    settingsSegment: "email",
    title: "Email sender",
    summary: "Send reminders, digests and invitations from your club's own address.",
    unlocks: [
      "Task reminders and the weekly digest reach people's inboxes",
      "Invitations come from your club, not from a platform address",
      "Replies go to an address your officers actually read",
    ],
    minutes: 10,
    prerequisite:
      "This is the one step you cannot finish in a sitting. Verifying a domain means adding DNS records, and DNS can take anywhere from ten minutes to a few hours to spread.",
    where: [
      {
        text: "At resend.com, open Domains and press Add Domain. Use a subdomain you use for nothing else, so a bounce problem never touches your main domain.",
        code: "mail.yourclub.org",
      },
      {
        text: "Resend shows a table of DNS records: SPF, DKIM and a return path. Add every one of them at whoever hosts your DNS. On Netlify that is Domains, your domain, DNS records. Add a DMARC record too while you are there.",
      },
      {
        text: "Wait until Resend shows the domain as Verified. Refreshing does not speed it up. Come back to this step when it is green.",
      },
      {
        text: "In Resend open API Keys, Create API Key, and give it Full access — the domain check has to read your domain list, which a sending-only key cannot do.",
      },
      {
        text: "Copy the key. Resend shows it exactly once. Paste it below with the from name and address.",
        code: "re_xxxxxxxxxxxxxxxxxxxxxxxx",
      },
    ],
    consequences: [
      "Test connection will fail until the domain shows Verified in Resend. That failure is the DNS not being ready yet, not a broken key — the error will tell you which.",
      "Resend bills your club, not the platform. Their free tier covers a club's volume comfortably.",
      "Until a verified sender exists, org mail either goes out from the platform address on your behalf or not at all. The step says which applies to you.",
      "Once your sender verifies, mail switches to it and the platform fallback turns itself off.",
    ],
    ifSkipped:
      "Members get in-app notifications only, or mail from the platform address. Invitations still go out either way.",
  },
  {
    id: "claude",
    provider: "CLAUDE",
    settingsSegment: "claude",
    title: "Claude API key",
    summary: "Read an org chart out of a slide, a PDF or a screenshot.",
    unlocks: [
      "Upload last year's org chart and get positions and people, not a picture",
      "Re-run it each semester instead of retyping the board",
    ],
    minutes: 3,
    prerequisite: null,
    where: [
      { text: "At console.anthropic.com, sign in with the account your club pays on." },
      {
        text: "Open Settings, then Workspaces, and create a workspace for the club. This keeps the club's spend separate from anything else on the account, and lets you put a monthly limit on it. Optional, but do it.",
      },
      { text: "Open API keys, press Create Key, and attach it to that workspace." },
      {
        text: "Copy the key. The console shows it once. Paste it below.",
        code: "sk-ant-api03-…",
      },
    ],
    consequences: [
      "Reading one document is one Claude API call, billed to your club's own Anthropic workspace. At Claude Opus 5 that is a few cents a document; Sonnet and Haiku cost less and are in the list below.",
      "Nothing here runs on a schedule and nothing else in the portal calls Claude. You are billed when somebody presses Import on an org chart, and at no other time.",
      "The document you upload is sent to Anthropic's API to be read.",
      "Set a monthly spend limit on the workspace. A key with no limit is a key with no limit.",
    ],
    ifSkipped:
      "The org chart still works — you build it by hand instead of uploading a document. Nothing else changes.",
  },
];

export function setupStep(id: SetupStepId): SetupStepDefinition {
  const step = SETUP_STEPS.find((s) => s.id === id);
  if (!step) throw new TypeError(`unknown setup step ${id}`);
  return step;
}

export function stepIdForProvider(provider: IntegrationProvider): SetupStepId | null {
  return SETUP_STEPS.find((s) => s.provider === provider)?.id ?? null;
}

/** The honest total for a club with every credential already in hand. */
export const SETUP_TOTAL_MINUTES = SETUP_STEPS.reduce((n, s) => n + s.minutes, 0);
