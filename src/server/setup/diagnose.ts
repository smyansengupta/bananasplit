import type { SetupStepId } from "./catalog";

/**
 * A failed connection test already comes back with a specific, sanitized
 * reason (src/server/integrations/providers, src/server/sync/connection).
 * The reason says what went wrong; this says what to do next, in the words
 * of the step the officer is standing in.
 *
 * Matching is on the reason text, which is our own copy from a small fixed
 * set, never a raw driver message: those are collapsed into the fallback.
 * The reason is shown verbatim next to the fix, so a message we have not
 * seen before is never swallowed.
 */

export interface Diagnosis {
  /** The reason from the test, verbatim. */
  reason: string;
  /** One sentence: the next thing to change. Null when nothing specific fits. */
  fix: string | null;
  /** Which field to send them back to, when one field is clearly at fault. */
  field: string | null;
}

interface Rule {
  match: RegExp;
  fix: string;
  field?: string;
}

const RULES: Record<SetupStepId, Rule[]> = {
  data: [
    {
      match: /refused the (password|role name or password)/i,
      fix: "Run the ALTER ROLE line from step 3 again in the Supabase SQL editor, then paste that exact password here. A password with a quote or a backslash in it is the usual culprit.",
      field: "password",
    },
    {
      match: /no suite export|contract_version\(\) is missing|suite_export/i,
      fix: "supabase/suite-export.sql has not been applied to this project yet, or it was applied to a different one. Run it in the SQL editor for the project whose ref you entered above.",
      field: "projectRef",
    },
    {
      match: /missing a grant|may not run/i,
      fix: "The role exists but lost its grants. Re-run the whole of supabase/suite-export.sql — it is safe to run twice.",
    },
    {
      match: /pooler host was not found|Check the region and (the )?(aws-0\/aws-1 )?prefix/i,
      fix: "The host is built from the region and the prefix, so one of those two is wrong. Open Connect, Session pooler in Supabase and read them straight off the connection string.",
      field: "poolerRegion",
    },
    {
      match: /did not answer|took too long/i,
      fix: "The project may be paused — a free Supabase project pauses after a week of inactivity. Open the dashboard, resume it, and test again.",
    },
    {
      match: /certificate could not be verified/i,
      fix: "This one is for whoever runs the platform, not for you: Supabase may have changed its root certificate, which then has to be set as SUPABASE_ROOT_CA_PEM on the deployment. Send them this message.",
    },
    {
      match: /export is version/i,
      fix: "Your website is on a different version of the export contract than Bananasplit. Pull the latest supabase/suite-export.sql from the website repository and run it again.",
    },
    {
      match: /project ref is the 20|Pick the project's region|Fill in the project ref/i,
      fix: "One of the four fields above is still empty or malformed. The project ref is exactly 20 lowercase letters.",
      field: "projectRef",
    },
  ],
  calendar: [
    {
      match: /revoked or expired/i,
      fix: "Someone removed Bananasplit's access in the Google account's security settings, or the OAuth app is still in Testing mode, where refresh tokens die after a week. Press Connect again.",
    },
    {
      match: /Connect Google Calendar first/i,
      fix: "Nothing is stored yet. Press Connect and finish the Google sign-in.",
    },
    {
      match: /Choose calendars from the list/i,
      fix: "The calendar list is stale. Press Test and refresh calendars, then pick again.",
    },
  ],
  claude: [
    {
      // Named, not bare "rejected this API key": Resend's message says the
      // same words, and a rule that matched both would hand an officer the
      // wrong instructions.
      match: /Claude rejected this API key/i,
      fix: "The key is wrong, revoked, or from a different account. Make a fresh one at console.anthropic.com under API keys and paste it here.",
      field: "apiKey",
    },
    {
      match: /not allowed to list models/i,
      fix: "This key is scoped too narrowly. Create a standard API key on the workspace rather than a restricted one.",
      field: "apiKey",
    },
    {
      match: /cannot use .*Pick another default model/i,
      fix: "The key works. Your workspace just is not enabled for that model — pick a different default from the list below and save again.",
      field: "model",
    },
    {
      match: /rate-limited/i,
      fix: "Nothing is wrong with the key. Wait a minute and press Test connection again.",
    },
    {
      match: /doesn't look like a Claude API key/i,
      fix: "Claude keys start with sk-ant-. Copy it again from API keys in the Anthropic console — it is shown once, so create a new one if it has scrolled away.",
      field: "apiKey",
    },
    {
      match: /answered 4\d\d|answered 5\d\d/i,
      fix: "Anthropic refused the call. A 400 or 403 usually means the workspace has no credit or has hit its spend limit; check Billing in the console.",
    },
  ],
};

const SHARED: Rule[] = [
  {
    match: /timed out/i,
    fix: "The service did not answer within ten seconds. Try once more; if it keeps timing out, the service is probably having a bad day.",
  },
  {
    match: /not set up yet/i,
    fix: "Save a credential first — the test needs something to test.",
  },
];

export function diagnose(step: SetupStepId, reason: string): Diagnosis {
  for (const rule of [...RULES[step], ...SHARED]) {
    if (rule.match.test(reason)) {
      return { reason, fix: rule.fix, field: rule.field ?? null };
    }
  }
  return { reason, fix: null, field: null };
}
