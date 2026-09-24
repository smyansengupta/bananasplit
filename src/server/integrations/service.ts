import {
  IntegrationProvider,
  IntegrationStatus,
  Prisma,
  type Role,
} from "@/generated/prisma/client";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { can, requirePermission } from "@/lib/auth/permissions";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";
import { displayName } from "@/server/email/escape";
import { testEmail } from "@/server/email/templates";
import { transportFor } from "@/server/email/transport";
import { enqueueJob } from "@/server/jobs/enqueue";
import { sanitize } from "@/server/jobs/sanitize";
import {
  getSecret,
  removeSecret,
  setSecret,
  testIntegration,
  type IntegrationTestResult,
  type SecretActor,
} from "@/server/secrets";

import {
  PROVIDERS,
  claudeConfigSchema,
  emailSenderConfigSchema,
  googleCalendarConfigSchema,
  providerInfo,
  supabaseConfigSchema,
  toIntegrationDto,
  type IntegrationDto,
} from "./catalog";
import {
  refreshAccessToken,
  listWritableCalendars,
  revokeGoogleToken,
  GoogleApiError,
} from "./google";
import {
  domainOfAddress,
  isNetlifyHookUrl,
  claudeConnectionTest,
  testNetlifyHook,
  testResendDomain,
  testSupabase,
} from "./providers";

/**
 * Settings > Integrations: the operations behind the pages' actions.
 *
 * - Every operation checks the permission first (permissions.ts): ADMIN+ to
 *   save, replace and test (integrations.write), OWNER to remove
 *   (integrations.remove). Google connect and disconnect are ADMIN+.
 * - Secrets go only through src/server/secrets (setSecret, testIntegration,
 *   removeSecret: service path, audited, owners alerted). Config-only edits
 *   run on app_user (withOrgTx), where RLS makes OrgIntegration admin-only.
 * - Network checks never run inside a transaction (testIntegration's shape).
 * - Results carry only ok, a message or a sanitized reason: never a secret.
 */

export type IntegrationResult = { ok: true; message?: string } | { ok: false; error: string };

export interface OrgActor extends SecretActor {
  userId: string;
  role: Role;
}

/** The session user's role in the org, checked by the database (non-members get NotFoundError). */
export async function resolveActor(orgId: string): Promise<OrgActor> {
  return withOrgTx(orgId, async (ctx) => ({ userId: ctx.userId, role: ctx.role }));
}

/** Every integration of the org as a DTO (OWNER/ADMIN; RLS hides the rows from others). */
export async function loadIntegrations(orgId: string): Promise<IntegrationDto[]> {
  const rows = await withOrgTx(orgId, ({ db }) =>
    db.orgIntegration.findMany({
      where: { organizationId: orgId },
      select: {
        provider: true,
        status: true,
        secretLast4: true,
        lastVerifiedAt: true,
        lastError: true,
        config: true,
        updatedAt: true,
        connectedBy: { select: { name: true } },
      },
    }),
  );
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDERS.map((p) => toIntegrationDto(p.provider, byProvider.get(p.provider) ?? null));
}

function fail(error: string): IntegrationResult {
  return { ok: false, error };
}

function fromTest(result: IntegrationTestResult, okMessage: string): IntegrationResult {
  return result.ok ? { ok: true, message: okMessage } : { ok: false, error: result.reason };
}

/** Merges non-secret config into an existing integration (app_user, admin-only RLS). */
async function updateConfig(
  orgId: string,
  actor: OrgActor,
  provider: IntegrationProvider,
  patch: Record<string, unknown>,
  extra: Prisma.OrgIntegrationUpdateInput = {},
): Promise<boolean> {
  requirePermission(actor, "integrations.write");
  return withOrgTx(orgId, async ({ db }) => {
    const row = await db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider } },
      select: { id: true, config: true },
    });
    if (!row) return false;
    const config = { ...((row.config as Record<string, unknown> | null) ?? {}), ...patch };
    for (const [k, v] of Object.entries(config)) if (v === undefined) delete config[k];
    await db.orgIntegration.update({
      where: { id: row.id },
      data: { config: config as Prisma.InputJsonObject, ...extra },
    });
    await writeOrgAuditLog(db, {
      organizationId: orgId,
      action: "integration.config_changed",
      targetType: "OrgIntegration",
      targetId: row.id,
      diff: { provider, keys: Object.keys(patch) },
    });
    return true;
  });
}

// ---------------------------------------------------------------- Claude

export async function saveClaude(
  orgId: string,
  actor: OrgActor,
  input: { apiKey?: string; model?: string; fallbacks?: boolean },
): Promise<IntegrationResult> {
  requirePermission(actor, "integrations.write");
  const parsed = claudeConfigSchema.safeParse({ model: input.model, fallbacks: input.fallbacks });
  if (!parsed.success) return fail("Choose one of the listed models.");
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    if (!/^sk-ant-[A-Za-z0-9_-]{10,}$/.test(apiKey))
      return fail("That doesn't look like a Claude API key (sk-ant-…).");
    await setSecret({
      orgId,
      actor,
      provider: "CLAUDE",
      kind: "API_KEY",
      value: apiKey,
      config: parsed.data,
    });
    return fromTest(
      await testIntegration({ orgId, actor, provider: "CLAUDE", test: claudeConnectionTest }),
      "Saved. The key works and can use the default model.",
    );
  }
  if (!(await updateConfig(orgId, actor, "CLAUDE", parsed.data)))
    return fail("Add an API key first.");
  return { ok: true, message: "Default model saved." };
}

// ---------------------------------------------------------------- Email sender (Resend)

async function clearPlatformFallbackOnVerify(orgId: string, actor: OrgActor): Promise<boolean> {
  return withSystemOrgTx(orgId, { userId: actor.userId }, async ({ db }) => {
    const settings = await db.orgSettings.findUnique({
      where: { organizationId: orgId },
      select: { platformMailFallback: true },
    });
    if (!settings?.platformMailFallback) return false;
    await db.orgSettings.update({
      where: { organizationId: orgId },
      data: { platformMailFallback: false, updatedById: actor.userId },
    });
    await writeOrgAuditLog(db, {
      organizationId: orgId,
      action: "integration.mail_fallback_changed",
      targetType: "OrgSettings",
      targetId: orgId,
      diff: { to: false, reason: "verified org sender connected" },
    });
    return true;
  });
}

/** The domain check; a verified sender switches org mail to it and clears the platform fallback. */
export async function checkEmailDomain(orgId: string, actor: OrgActor): Promise<IntegrationResult> {
  const result = await testIntegration({
    orgId,
    actor,
    provider: "EMAIL_RESEND",
    test: testResendDomain,
  });
  if (!result.ok) return fail(result.reason);
  const cleared = await clearPlatformFallbackOnVerify(orgId, actor);
  return {
    ok: true,
    message: cleared
      ? "The domain is verified. Org email now goes out from your sender (the platform fallback is off)."
      : "The domain is verified. Org email now goes out from your sender.",
  };
}

export async function saveEmailSender(
  orgId: string,
  actor: OrgActor,
  input: { fromName: string; fromAddress: string; replyTo?: string; apiKey?: string },
): Promise<IntegrationResult> {
  requirePermission(actor, "integrations.write");
  const parsed = emailSenderConfigSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the sender fields.");
  const config = { ...parsed.data, replyTo: parsed.data.replyTo };
  const apiKey = input.apiKey?.trim();

  // A new from-domain must be verified again before mail is routed to it.
  const current = await withOrgTx(orgId, ({ db }) =>
    db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider: "EMAIL_RESEND" } },
      select: { config: true },
    }),
  );
  const previousAddress = (current?.config as { fromAddress?: string } | null)?.fromAddress;
  const domainChanged =
    !previousAddress || domainOfAddress(previousAddress) !== domainOfAddress(config.fromAddress);
  const reset = domainChanged
    ? { domain: undefined, domainStatus: undefined, domainVerifiedAt: undefined }
    : {};

  if (apiKey) {
    if (!/^re_[A-Za-z0-9_]{8,}$/.test(apiKey))
      return fail("That doesn't look like a Resend API key (re_…).");
    await setSecret({
      orgId,
      actor,
      provider: "EMAIL_RESEND",
      kind: "API_KEY",
      value: apiKey,
      config: { ...config, domain: null, domainStatus: null, domainVerifiedAt: null },
    });
    return checkEmailDomain(orgId, actor);
  }
  const updated = await updateConfig(
    orgId,
    actor,
    "EMAIL_RESEND",
    { ...config, ...reset },
    domainChanged ? { status: IntegrationStatus.DISCONNECTED } : {},
  );
  if (!updated) return fail("Add a Resend API key first.");
  return domainChanged
    ? checkEmailDomain(orgId, actor)
    : { ok: true, message: "Sender details saved." };
}

/**
 * Sends a test email from the org's own sender to the ACTING user's own
 * address (never an arbitrary recipient). 5 per hour per org.
 */
export async function sendTestEmail(orgId: string, actor: OrgActor): Promise<IntegrationResult> {
  requirePermission(actor, "integrations.write");
  const limited = await checkRateLimit(rateLimitKey("test-email", orgId), 5, 60 * 60);
  if (!limited.allowed) return fail("Too many test emails. Try again in an hour.");
  const identity = await getUserIdentity(actor.userId);
  if (!identity) return fail("Your account has no email address.");
  const org = await withOrgTx(orgId, ({ db }) =>
    db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
  );

  const outcome: { transport: "live" | "sink" | "off" } = { transport: "off" };
  const result = await testIntegration({
    orgId,
    actor,
    provider: "EMAIL_RESEND",
    test: async ({ secret, config, signal }) => {
      if (!secret) return { ok: false, reason: "Add a Resend API key first." };
      const from = config.fromAddress;
      if (typeof from !== "string" || !from)
        return { ok: false, reason: "Set a from address first." };
      const name = displayName(typeof config.fromName === "string" ? config.fromName : org.name);
      const sent = await transportFor(secret).send(
        {
          from: `"${name}" <${from}>`,
          to: identity.email,
          replyTo: typeof config.replyTo === "string" ? config.replyTo : undefined,
          ...testEmail({ orgName: org.name, senderLabel: `${org.name}'s own sender (${from})` }),
        },
        { signal },
      );
      outcome.transport = sent.transport;
      // Only a real Resend send proves the domain; the local mail sink does not.
      return sent.transport === "live"
        ? {
            ok: true,
            config: {
              domain: domainOfAddress(from),
              domainStatus: "verified",
              domainVerifiedAt: new Date().toISOString(),
            },
          }
        : { ok: true };
    },
  });
  if (!result.ok) return fail(result.reason);
  const where =
    outcome.transport === "live"
      ? `Sent to ${identity.email}.`
      : outcome.transport === "sink"
        ? "Written to the local mail sink (.data/mail/): this environment never sends real mail."
        : "Email delivery is switched off here (EMAIL_DELIVERY=off).";
  return { ok: true, message: `Test email: ${where}` };
}

/** OWNER-only: keep org mail on the platform sender (or stop) while no verified sender exists. */
export async function setPlatformMailFallback(
  orgId: string,
  enabled: boolean,
): Promise<IntegrationResult> {
  return withOrgTx(orgId, async (ctx) => {
    requirePermission(ctx, "mail.fallback.write");
    await ctx.db.orgSettings.update({
      where: { organizationId: orgId },
      data: { platformMailFallback: enabled, updatedById: ctx.userId },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: orgId,
      action: "integration.mail_fallback_changed",
      targetType: "OrgSettings",
      targetId: orgId,
      diff: { to: enabled },
    });
    return {
      ok: true as const,
      message: enabled ? "Platform fallback on." : "Platform fallback off.",
    };
  });
}

// ---------------------------------------------------------------- Supabase data source

export async function saveSupabase(
  orgId: string,
  actor: OrgActor,
  input: {
    projectRef: string;
    poolerRegion: string;
    poolerPrefix: string;
    roleName?: string;
    password?: string;
  },
): Promise<IntegrationResult> {
  requirePermission(actor, "integrations.write");
  const parsed = supabaseConfigSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Check the connection fields.");
  const password = input.password?.trim();
  if (password) {
    await setSecret({
      orgId,
      actor,
      provider: "SUPABASE_SOURCE",
      kind: "DB_PASSWORD",
      value: password,
      config: parsed.data,
    });
  } else if (
    !(await updateConfig(orgId, actor, "SUPABASE_SOURCE", parsed.data, {
      status: IntegrationStatus.DISCONNECTED,
    }))
  ) {
    return fail("Add the database password first.");
  }
  return fromTest(
    await testIntegration({
      orgId,
      actor,
      provider: "SUPABASE_SOURCE",
      kind: "DB_PASSWORD",
      test: testSupabase,
    }),
    "Saved. Connected read-only and found the website export functions.",
  );
}

// ---------------------------------------------------------------- Netlify build hook

export async function saveNetlifyHook(
  orgId: string,
  actor: OrgActor,
  hookUrl: string,
): Promise<IntegrationResult> {
  requirePermission(actor, "integrations.write");
  const url = hookUrl.trim();
  if (!isNetlifyHookUrl(url)) {
    return fail("Paste the build hook URL from Netlify: https://api.netlify.com/build_hooks/…");
  }
  await setSecret({
    orgId,
    actor,
    provider: "NETLIFY_BUILD_HOOK",
    kind: "HOOK_URL",
    value: url,
    // A syntactically valid hook is usable; "Trigger a test build" proves it.
    status: IntegrationStatus.CONNECTED,
  });
  return { ok: true, message: "Build hook saved. Use “Trigger a test build” to check it." };
}

// ---------------------------------------------------------------- Google Calendar

async function testGoogle(orgId: string, actor: OrgActor): Promise<IntegrationResult> {
  let reauth = false;
  const result = await testIntegration({
    orgId,
    actor,
    provider: "GOOGLE_CALENDAR",
    kind: "REFRESH_TOKEN",
    test: async ({ secret, signal }) => {
      if (!secret) return { ok: false, reason: "Connect Google Calendar first." };
      try {
        const tokens = await refreshAccessToken(secret, signal);
        const calendars = await listWritableCalendars(tokens.accessToken, signal);
        return { ok: true, config: { calendars } };
      } catch (error) {
        if (error instanceof GoogleApiError && error.code === "invalid_grant") {
          reauth = true;
          return { ok: false, reason: "Google access was revoked or expired. Connect again." };
        }
        throw error;
      }
    },
  });
  if (reauth) {
    await withSystemOrgTx(orgId, { userId: actor.userId }, ({ db }) =>
      db.orgIntegration.updateMany({
        where: { organizationId: orgId, provider: "GOOGLE_CALENDAR" },
        data: { status: IntegrationStatus.NEEDS_REAUTH },
      }),
    );
  }
  return fromTest(result, "Google Calendar works. The calendar list is up to date.");
}

export async function saveGoogleCalendars(
  orgId: string,
  actor: OrgActor,
  input: { publicCalendarId?: string | null; internalCalendarId?: string | null },
): Promise<IntegrationResult> {
  requirePermission(actor, "integrations.write");
  const parsed = googleCalendarConfigSchema.safeParse(input);
  if (!parsed.success) return fail("Choose calendars from the list.");
  const dtos = await loadIntegrations(orgId);
  const google = dtos.find((d) => d.provider === "GOOGLE_CALENDAR");
  const calendars = (google?.config.calendars as { id: string }[] | undefined) ?? [];
  const ids = new Set(calendars.map((c) => c.id));
  for (const id of [parsed.data.publicCalendarId, parsed.data.internalCalendarId]) {
    if (id && !ids.has(id)) return fail("Choose calendars from the list (refresh it with Test).");
  }
  if (
    !(await updateConfig(orgId, actor, "GOOGLE_CALENDAR", {
      publicCalendarId: parsed.data.publicCalendarId || null,
      internalCalendarId: parsed.data.internalCalendarId || null,
    }))
  ) {
    return fail("Connect Google Calendar first.");
  }
  return { ok: true, message: "Calendars saved." };
}

/**
 * Disconnect (OWNER/ADMIN): the connection stops at once (DISCONNECTED, so
 * no sync runs) and a google-revoke job is queued; that job (calendar
 * builder) revokes the grant at Google if it still can and settles pending
 * event mirrors. Disconnect also revokes inline first (best effort, no
 * transaction open) and, once the grant is revoked, deletes the stored
 * refresh token when the actor may remove secrets (OWNER). For an ADMIN the
 * revoked, now useless token stays encrypted until an OWNER removes it.
 */
export async function disconnectGoogle(orgId: string, actor: OrgActor): Promise<IntegrationResult> {
  requirePermission(actor, "integrations.write");
  let revoked = false;
  try {
    const token = await getSecret({ orgId, provider: "GOOGLE_CALENDAR", kind: "REFRESH_TOKEN" });
    if (token) await revokeGoogleToken(token, AbortSignal.timeout(10_000));
    revoked = true;
  } catch (error) {
    console.warn(`[integrations] inline Google revoke failed (the job retries): ${sanitize(error)}`);
  }

  const done = await withSystemOrgTx(orgId, { userId: actor.userId }, async ({ db }) => {
    const row = await db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider: "GOOGLE_CALENDAR" } },
      select: { id: true, config: true },
    });
    if (!row) return false;
    await db.orgIntegration.update({
      where: { id: row.id },
      data: {
        status: IntegrationStatus.DISCONNECTED,
        config: {
          ...((row.config as Record<string, unknown> | null) ?? {}),
          disconnectedAt: new Date().toISOString(),
        } as Prisma.InputJsonObject,
      },
    });
    await enqueueJob(db, {
      orgId,
      kind: "google-revoke",
      key: row.id,
      payload: { integrationId: row.id },
    });
    await writeOrgAuditLog(db, {
      organizationId: orgId,
      action: "integration.disconnected",
      targetType: "OrgIntegration",
      targetId: row.id,
      diff: { provider: "GOOGLE_CALENDAR", revokedInline: revoked },
    });
    return true;
  });
  if (!done) return fail("Google Calendar is not connected.");

  if (revoked && can(actor, "integrations.remove")) {
    await removeSecret({ orgId, actor, provider: "GOOGLE_CALENDAR", kind: "REFRESH_TOKEN" });
    return { ok: true, message: "Disconnected. Access was revoked at Google and the token deleted." };
  }
  return {
    ok: true,
    message: revoked
      ? "Disconnected. Access was revoked at Google."
      : "Disconnected. Access at Google is being revoked.",
  };
}

/**
 * "Import existing events": queues a DRY RUN of the calendar builder's
 * google-import job (nothing is written until someone applies it from the
 * calendar's Sync page). OWNER/ADMIN.
 * TODO(integration): replace with requestGoogleImport(ctx, "dry-run") from
 * src/server/google-calendar/requests.ts and show its SyncPanel here.
 */
export async function requestGoogleImportDryRun(orgId: string): Promise<IntegrationResult> {
  return withOrgTx(orgId, async (ctx) => {
    requirePermission(ctx, "integrations.write");
    const row = await ctx.db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider: "GOOGLE_CALENDAR" } },
      select: { id: true, status: true },
    });
    if (!row || row.status !== IntegrationStatus.CONNECTED) {
      return { ok: false as const, error: "Connect Google Calendar first." };
    }
    await enqueueJob(ctx.db, {
      orgId,
      kind: "google-import",
      key: `${row.id}:dry-run`,
      payload: { integrationId: row.id, mode: "dry-run" },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: orgId,
      action: "calendar.google_import_requested",
      targetType: "OrgIntegration",
      targetId: row.id,
      diff: { mode: "dry-run" },
    });
    return {
      ok: true as const,
      message: "Import dry run queued. Review and apply it from Calendar > Sync.",
    };
  });
}

// ---------------------------------------------------------------- Test and remove (all)

export async function testProvider(
  orgId: string,
  actor: OrgActor,
  provider: IntegrationProvider,
): Promise<IntegrationResult> {
  requirePermission(actor, "integrations.write");
  switch (provider) {
    case "CLAUDE":
      return fromTest(
        await testIntegration({ orgId, actor, provider, test: claudeConnectionTest }),
        "The key works and can use the default model.",
      );
    case "EMAIL_RESEND":
      return checkEmailDomain(orgId, actor);
    case "SUPABASE_SOURCE":
      return fromTest(
        await testIntegration({ orgId, actor, provider, kind: "DB_PASSWORD", test: testSupabase }),
        "Connected read-only and found the website export functions.",
      );
    case "NETLIFY_BUILD_HOOK":
      return fromTest(
        await testIntegration({ orgId, actor, provider, kind: "HOOK_URL", test: testNetlifyHook }),
        "Netlify accepted the hook: a test build has started.",
      );
    case "GOOGLE_CALENDAR":
      return testGoogle(orgId, actor);
  }
}

/** OWNER-only: deletes the secret(s); the integration shows as disconnected. */
export async function removeProvider(
  orgId: string,
  actor: OrgActor,
  provider: IntegrationProvider,
): Promise<IntegrationResult> {
  requirePermission(actor, "integrations.remove");
  providerInfo(provider);
  if (provider === "GOOGLE_CALENDAR") {
    // Best effort, outside any transaction: revoke at Google before the token is gone.
    try {
      const token = await getSecret({ orgId, provider, kind: "REFRESH_TOKEN" });
      if (token) await revokeGoogleToken(token, AbortSignal.timeout(10_000));
    } catch (error) {
      console.warn(`[integrations] Google revoke on remove failed: ${sanitize(error)}`);
    }
  }
  const removed = await removeSecret({ orgId, actor, provider });
  return removed
    ? { ok: true, message: "Removed. The key was deleted." }
    : { ok: true, message: "Nothing was stored." };
}

/** Whether the viewer may remove integrations (for the pages). */
export function canRemoveIntegrations(role: Role | null): boolean {
  return can({ role }, "integrations.remove");
}
