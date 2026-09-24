import { IntegrationProvider, IntegrationStatus } from "@/generated/prisma/client";
import { assertNoTx, withSystemOrgTx } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import { getSecret } from "@/server/secrets";

/**
 * The site-rebuild job: rebuild the org's static website after its public
 * events change, so the site's build-time fetch of
 * /api/public/{slug}/events picks the change up.
 *
 * - The event service queues site-rebuild:{orgId} with runAt = now + 60s
 *   whenever a PUBLIC event is created, edited or deleted, or an event's
 *   visibility flips; further changes inside that minute coalesce into the
 *   same job, so a burst of edits costs one deploy.
 * - The hook URL is a per-org secret (Settings > Integrations > Website
 *   build hook, OrgSecret kind HOOK_URL), decrypted only here. Only Netlify
 *   build hooks are accepted (https://api.netlify.com/build_hooks/...), so a
 *   stored URL cannot point the server at anything else.
 * - The POST runs outside any transaction with a 15s timeout. 2xx: done.
 *   404/410: the hook was deleted in Netlify; the integration is marked
 *   ERROR and the job ends. 429/5xx/network: retried with backoff.
 */

const NETLIFY_HOOK = /^https:\/\/api\.netlify\.com\/build_hooks\/[A-Za-z0-9]{8,64}$/;

/** The validated hook URL, or null when the stored value is not a Netlify build hook. */
export function parseBuildHookUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!NETLIFY_HOOK.test(trimmed)) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

async function recordHookState(
  organizationId: string,
  data: { status: IntegrationStatus; lastError: string | null; verified: boolean },
): Promise<void> {
  await withSystemOrgTx(organizationId, async ({ db }) => {
    await db.orgIntegration.updateMany({
      where: { organizationId, provider: IntegrationProvider.NETLIFY_BUILD_HOOK },
      data: {
        status: data.status,
        lastError: data.lastError,
        ...(data.verified ? { lastVerifiedAt: new Date() } : {}),
      },
    });
  });
}

export const siteRebuildJob: JobHandler<Record<string, never>> = async (run) => {
  const organizationId = run.organizationId;
  if (!organizationId) throw new PermanentJobError("site-rebuild is an org job");

  const integration = await withSystemOrgTx(organizationId, async ({ db }) =>
    db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId, provider: IntegrationProvider.NETLIFY_BUILD_HOOK } },
      select: { id: true, status: true },
    }),
  );
  if (!integration || integration.status === IntegrationStatus.DISCONNECTED) return;

  const stored = await getSecret({
    orgId: organizationId,
    provider: IntegrationProvider.NETLIFY_BUILD_HOOK,
    kind: "HOOK_URL",
  });
  if (!stored) return;
  const hook = parseBuildHookUrl(stored);
  if (!hook) {
    await recordHookState(organizationId, {
      status: IntegrationStatus.ERROR,
      lastError: "The saved build hook is not a Netlify build hook URL (https://api.netlify.com/build_hooks/...).",
      verified: false,
    });
    throw new PermanentJobError("the saved build hook is not a Netlify build hook URL");
  }

  assertNoTx("site-rebuild");
  hook.searchParams.set("trigger_title", "Public events changed in the ops suite");
  const timeout = AbortSignal.timeout(15_000);
  const res = await fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.any([run.signal, timeout]),
    cache: "no-store",
    redirect: "error",
  });
  if (res.ok) {
    if (integration.status !== IntegrationStatus.CONNECTED) {
      await recordHookState(organizationId, { status: IntegrationStatus.CONNECTED, lastError: null, verified: true });
    }
    return;
  }
  const message = `Netlify answered ${res.status} to the build hook`;
  if (res.status === 404 || res.status === 410) {
    await recordHookState(organizationId, {
      status: IntegrationStatus.ERROR,
      lastError: sanitize(`${message}: the hook no longer exists. Save a new one in Settings > Integrations.`, 300),
      verified: false,
    });
    throw new PermanentJobError(message);
  }
  if (res.status === 429 || res.status >= 500) throw new Error(message);
  throw new PermanentJobError(message);
};
