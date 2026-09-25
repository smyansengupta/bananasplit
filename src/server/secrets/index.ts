// The KEK, the plaintext of every org secret and the fingerprint key live
// here. `server-only` makes a client import a build error, not a review item.
import "server-only";

import {
  IntegrationStatus,
  NotificationType,
  Prisma,
  type IntegrationProvider,
  type Role,
} from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { writeOrgAuditLog } from "@/server/audit";
import { assertNoTx, withSystemOrgTx, type SystemContext } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";
import { notifyOrgOwners } from "@/server/notifications";

import { decryptSecret, encryptSecret, type EncryptedSecret, type SecretLocator } from "./envelope";
import { secretFingerprint, secretLast4 } from "./fingerprint";
import { keyring } from "./keyring";

/**
 * Per-org integration secrets (Claude key, Google refresh token, Resend key,
 * Supabase password, Netlify hook URL), encrypted at rest ('Secrets at
 * rest' decision; contract 3).
 *
 * The ONLY functions: setSecret, getSecret, removeSecret, testIntegration.
 * This module is the only caller of app.secret_read / secret_write /
 * secret_delete (EXECUTE for app_service only, and each requires the org
 * GUC to equal the org it touches). Isolation between orgs on the service
 * path rests on that, plus the permission check each function makes:
 *   - setSecret, testIntegration: ADMIN+ (integrations.write)
 *   - removeSecret: OWNER (integrations.remove)
 *   - getSecret: no user check; for jobs and for code that has already
 *     authorized the caller. Its plaintext must never reach a DTO, a log or
 *     the client.
 * Every change writes OrgAuditLog in the same transaction and alerts every
 * OWNER (SECURITY_ALERT). Decryption and all network calls happen outside
 * any transaction. The UI is write-only: it shows last4 and status.
 *
 * Do not import this module from client components.
 */

export const SECRET_KINDS = ["API_KEY", "REFRESH_TOKEN", "DB_PASSWORD", "HOOK_URL"] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** The acting user, whose role in the org has been resolved by the caller. */
export interface SecretActor {
  userId: string;
  role: Role | null;
}

export { SecretsConfigError } from "./keyring";
export { SecretDecryptError } from "./envelope";

const MAX_SECRET_BYTES = 8 * 1024;

const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  CLAUDE: "Claude API key",
  GOOGLE_CALENDAR: "Google Calendar connection",
  EMAIL_RESEND: "email sender (Resend) key",
  SUPABASE_SOURCE: "website data source password",
  NETLIFY_BUILD_HOOK: "website build hook",
};

interface SecretRow {
  id: string;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  wrappedDek: Uint8Array;
  dekIv: Uint8Array;
  dekTag: Uint8Array;
  kekVersion: number;
}

function toRecord(row: SecretRow): EncryptedSecret {
  return {
    ciphertext: Buffer.from(row.ciphertext),
    iv: Buffer.from(row.iv),
    authTag: Buffer.from(row.authTag),
    wrappedDek: Buffer.from(row.wrappedDek),
    dekIv: Buffer.from(row.dekIv),
    dekTag: Buffer.from(row.dekTag),
    kekVersion: Number(row.kekVersion),
  };
}

function checkKind(kind: string): asserts kind is SecretKind {
  if (!(SECRET_KINDS as readonly string[]).includes(kind))
    throw new TypeError(`unknown secret kind ${kind}`);
}

async function readSecretRow(
  db: SystemContext["db"],
  orgId: string,
  integrationId: string,
  kind: SecretKind,
): Promise<EncryptedSecret | null> {
  const rows = await db.$queryRaw<SecretRow[]>`
    SELECT "id", "ciphertext", "iv", "authTag", "wrappedDek", "dekIv", "dekTag", "kekVersion"
      FROM app.secret_read(${orgId}, ${integrationId}, ${kind})`;
  return rows[0] ? toRecord(rows[0]) : null;
}

async function alertOwners(
  db: SystemContext["db"],
  orgId: string,
  provider: IntegrationProvider,
  change: "added" | "replaced" | "removed",
): Promise<void> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { slug: true } });
  await notifyOrgOwners(db, orgId, {
    type: NotificationType.SECURITY_ALERT,
    title: `The ${PROVIDER_LABEL[provider]} was ${change}`,
    body: "An integration secret changed in Settings. If you didn't expect this, review Settings > Integrations and the audit log.",
    linkUrl: org ? `/app/${org.slug}/settings/integrations` : null,
  });
}

export interface SetSecretInput {
  orgId: string;
  actor: SecretActor;
  provider: IntegrationProvider;
  kind: SecretKind;
  value: string;
  /** Non-secret settings to merge into OrgIntegration.config. */
  config?: Record<string, unknown>;
  /** Status after the save (default DISCONNECTED until a test passes). */
  status?: IntegrationStatus;
}

/**
 * Saves (sets or replaces) a secret for the org's `provider` integration,
 * creating the OrgIntegration row if needed. ADMIN+.
 */
export async function setSecret(
  input: SetSecretInput,
): Promise<{ integrationId: string; last4: string | null; replaced: boolean }> {
  requirePermission(input.actor, "integrations.write");
  checkKind(input.kind);
  const value = input.value.trim();
  if (!value) throw new TypeError("secret value is empty");
  if (Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES)
    throw new TypeError("secret value is too large");

  const ring = keyring();
  const last4 = secretLast4(value);
  const fingerprint = secretFingerprint(value);

  return withSystemOrgTx(input.orgId, { userId: input.actor.userId }, async ({ db }) => {
    const existing = await db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId: input.orgId, provider: input.provider } },
      select: { id: true, config: true },
    });
    const mergedConfig = {
      ...((existing?.config as Record<string, unknown> | null) ?? {}),
      ...(input.config ?? {}),
    } as Prisma.InputJsonObject;
    const integration = existing
      ? await db.orgIntegration.update({
          where: { id: existing.id },
          data: { config: mergedConfig },
          select: { id: true },
        })
      : await db.orgIntegration.create({
          data: {
            organizationId: input.orgId,
            provider: input.provider,
            status: IntegrationStatus.DISCONNECTED,
            config: mergedConfig,
            connectedById: input.actor.userId,
          },
          select: { id: true },
        });

    const loc: SecretLocator = {
      orgId: input.orgId,
      integrationId: integration.id,
      provider: input.provider,
      kind: input.kind,
    };
    const replaced = (await readSecretRow(db, input.orgId, integration.id, input.kind)) !== null;
    const enc = encryptSecret(value, loc, ring);
    await db.$queryRaw`
      SELECT app.secret_write(
        ${input.orgId}, ${integration.id}, ${input.kind},
        ${enc.ciphertext}, ${enc.iv}, ${enc.authTag},
        ${enc.wrappedDek}, ${enc.dekIv}, ${enc.dekTag}, ${enc.kekVersion}::int
      ) AS id`;

    await db.orgIntegration.update({
      where: { id: integration.id },
      data: {
        secretLast4: last4,
        secretFingerprint: fingerprint,
        status: input.status ?? IntegrationStatus.DISCONNECTED,
        lastError: null,
        lastVerifiedAt: null,
        connectedById: input.actor.userId,
      },
    });
    await writeOrgAuditLog(db, {
      organizationId: input.orgId,
      action: replaced ? "integration.secret_replaced" : "integration.secret_set",
      targetType: "OrgIntegration",
      targetId: integration.id,
      diff: { provider: input.provider, kind: input.kind, last4 },
    });
    await alertOwners(db, input.orgId, input.provider, replaced ? "replaced" : "added");
    return { integrationId: integration.id, last4, replaced };
  });
}

export interface GetSecretInput {
  orgId: string;
  kind: SecretKind;
  /** Identify the integration by provider (usual) or by id. */
  provider?: IntegrationProvider;
  integrationId?: string;
}

/**
 * The decrypted secret, or null when none is stored. Service path only:
 * call it from jobs, or after the calling action has checked permissions.
 * Never inside a transaction; never return the value to the client.
 */
export async function getSecret(input: GetSecretInput): Promise<string | null> {
  checkKind(input.kind);
  if (!input.provider && !input.integrationId)
    throw new TypeError("getSecret needs provider or integrationId");
  assertNoTx("getSecret");
  const found = await withSystemOrgTx(input.orgId, async ({ db }) => {
    const integration = await db.orgIntegration.findFirst({
      where: {
        organizationId: input.orgId,
        ...(input.integrationId ? { id: input.integrationId } : { provider: input.provider }),
      },
      select: { id: true, provider: true },
    });
    if (!integration) return null;
    const record = await readSecretRow(db, input.orgId, integration.id, input.kind);
    return record ? { integration, record } : null;
  });
  if (!found) return null;
  return decryptSecret(
    found.record,
    {
      orgId: input.orgId,
      integrationId: found.integration.id,
      provider: found.integration.provider,
      kind: input.kind,
    },
    keyring(),
  );
}

export interface RemoveSecretInput {
  orgId: string;
  actor: SecretActor;
  provider: IntegrationProvider;
  /** One kind, or every kind of the integration when omitted. */
  kind?: SecretKind;
}

/** Deletes the secret(s) and marks the integration DISCONNECTED. OWNER only. */
export async function removeSecret(input: RemoveSecretInput): Promise<boolean> {
  requirePermission(input.actor, "integrations.remove");
  if (input.kind) checkKind(input.kind);
  const kinds = input.kind ? [input.kind] : [...SECRET_KINDS];

  return withSystemOrgTx(input.orgId, { userId: input.actor.userId }, async ({ db }) => {
    const integration = await db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId: input.orgId, provider: input.provider } },
      select: { id: true },
    });
    if (!integration) return false;
    let removed = false;
    for (const kind of kinds) {
      const rows = await db.$queryRaw<{ ok: boolean }[]>`
        SELECT app.secret_delete(${input.orgId}, ${integration.id}, ${kind}) AS ok`;
      removed = removed || rows[0]?.ok === true;
    }
    await db.orgIntegration.update({
      where: { id: integration.id },
      data: {
        status: IntegrationStatus.DISCONNECTED,
        secretLast4: null,
        secretFingerprint: null,
        lastError: null,
        lastVerifiedAt: null,
      },
    });
    await writeOrgAuditLog(db, {
      organizationId: input.orgId,
      action: "integration.secret_removed",
      targetType: "OrgIntegration",
      targetId: integration.id,
      diff: { provider: input.provider, kinds },
    });
    if (removed) await alertOwners(db, input.orgId, input.provider, "removed");
    return removed;
  });
}

export interface IntegrationTestContext {
  /** The decrypted secret, or null when none is stored. */
  secret: string | null;
  /** OrgIntegration.config (non-secret settings). */
  config: Record<string, unknown>;
  /** Aborted at the timeout; pass it to fetch(). */
  signal: AbortSignal;
}

export type IntegrationTestResult =
  { ok: true; config?: Record<string, unknown> } | { ok: false; reason: string };

export interface TestIntegrationInput {
  orgId: string;
  actor: SecretActor;
  provider: IntegrationProvider;
  kind?: SecretKind;
  timeoutMs?: number;
  /** The network check (e.g. a models.list or a domain lookup). Runs outside any transaction. */
  test: (ctx: IntegrationTestContext) => Promise<IntegrationTestResult>;
}

/**
 * Test-connection in the job-runner shape (Phase 1): permission check; a
 * short transaction reads the config and the secret; the network test runs
 * with no transaction open and a 10s timeout; a second short transaction
 * records status, lastVerifiedAt, the sanitized lastError and the audit row.
 * Returns only ok or a sanitized reason, never the secret.
 */
export async function testIntegration(input: TestIntegrationInput): Promise<IntegrationTestResult> {
  requirePermission(input.actor, "integrations.write");
  assertNoTx("testIntegration");
  const kind = input.kind ?? "API_KEY";
  checkKind(kind);

  const loaded = await withSystemOrgTx(
    input.orgId,
    { userId: input.actor.userId },
    async ({ db }) => {
      const integration = await db.orgIntegration.findUnique({
        where: {
          organizationId_provider: { organizationId: input.orgId, provider: input.provider },
        },
        select: { id: true, provider: true, config: true, status: true },
      });
      if (!integration) return null;
      const record = await readSecretRow(db, input.orgId, integration.id, kind);
      return { integration, record };
    },
  );
  if (!loaded) return { ok: false, reason: "This integration is not set up yet." };

  let result: IntegrationTestResult;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("timed out")),
    input.timeoutMs ?? 10_000,
  );
  try {
    const secret = loaded.record
      ? decryptSecret(
          loaded.record,
          {
            orgId: input.orgId,
            integrationId: loaded.integration.id,
            provider: loaded.integration.provider,
            kind,
          },
          keyring(),
        )
      : null;
    const config = (loaded.integration.config as Record<string, unknown> | null) ?? {};
    result = await Promise.race([
      input.test({ secret, config, signal: controller.signal }),
      new Promise<IntegrationTestResult>((resolve) =>
        controller.signal.addEventListener("abort", () =>
          resolve({ ok: false, reason: "The connection test timed out." }),
        ),
      ),
    ]);
  } catch (error) {
    result = { ok: false, reason: sanitize(error, 300) };
  } finally {
    clearTimeout(timer);
  }
  if (!result.ok) result = { ok: false, reason: sanitize(result.reason, 300) };

  await withSystemOrgTx(input.orgId, { userId: input.actor.userId }, async ({ db }) => {
    const current = (loaded.integration.config as Record<string, unknown> | null) ?? {};
    await db.orgIntegration.update({
      where: { id: loaded.integration.id },
      data: result.ok
        ? {
            status: IntegrationStatus.CONNECTED,
            lastVerifiedAt: new Date(),
            lastError: null,
            ...(result.config
              ? { config: { ...current, ...result.config } as Prisma.InputJsonObject }
              : {}),
          }
        : { status: IntegrationStatus.ERROR, lastError: result.reason },
    });
    await writeOrgAuditLog(db, {
      organizationId: input.orgId,
      action: "integration.tested",
      targetType: "OrgIntegration",
      targetId: loaded.integration.id,
      diff: { provider: input.provider, ok: result.ok },
    });
  });
  return result;
}
