import { lookup } from "node:dns/promises";

import type { Prisma } from "@/generated/prisma/client";
import { absoluteAppUrl } from "@/lib/app-url";
import { readWorkflow, renderMessage, type RunLogEntry } from "@/lib/crm/workflows";
import { withSystemOrgTx } from "@/server/db/context";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";

import { checkCallUrl, isPrivateAddress } from "./call-url";
import { loadTarget, targetPath } from "./workflow-target";
import type { TriggerRef } from "./workflow-engine";

/**
 * The workflow steps that leave Bananasplit (Slack, Discord, a webhook),
 * run by the crm-workflow-call job, never inside a transaction. The rules:
 *
 * - https only, on the default port, no user:password in the address;
 * - Slack only at hooks.slack.com, Discord only at discord.com (or
 *   discordapp.com) /api/webhooks/;
 * - the host must not be an IP literal or resolve to a private, loopback,
 *   link-local or otherwise internal address (checked just before the call);
 * - redirects are refused, the call gives up after 10 seconds, and only
 *   the status is kept;
 * - the webhook body is the event and the record's ids, kind and name, so
 *   nothing more of a person leaves than the organization's own link
 *   already shows.
 *
 * The outcome goes into the run's log at the step's index.
 */

const TIMEOUT_MS = 10_000;

async function assertPublicHost(url: URL): Promise<void> {
  const answers = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (answers.length === 0) throw new PermanentJobError("That address doesn't resolve.");
  if (answers.some((a) => isPrivateAddress(a.address))) throw new PermanentJobError("That address is inside a private network.");
}

type CallPayload = { runId: string; index: number };

export const crmWorkflowCallJob: JobHandler<CallPayload> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-workflow-call needs an organization");
  const { runId, index } = run.payload;
  const loaded = await withSystemOrgTx(orgId, async ({ db }) => {
    const r = await db.crmWorkflowRun.findFirst({
      where: { id: runId, organizationId: orgId },
      select: { id: true, triggerRef: true, log: true, workflow: { select: { id: true, name: true, trigger: true, conditions: true, actions: true } } },
    });
    if (!r) return null;
    const ref = r.triggerRef as unknown as TriggerRef;
    const action = readWorkflow(r.workflow).actions[index];
    const target = ref?.kind && ref?.id ? await loadTarget(db, orgId, ref.kind, ref.id) : null;
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { slug: true } });
    return { run: r, ref, action, target, slug: org?.slug ?? "" };
  });
  if (!loaded) return;
  const { action, target, ref } = loaded;
  let entry: RunLogEntry;
  if (!action || (action.type !== "slack.post" && action.type !== "discord.post" && action.type !== "webhook.call")) {
    entry = { action: action?.type ?? "webhook.call", ok: false, detail: "The step changed before it ran." };
  } else {
    try {
      const url = checkCallUrl(action.type, action.params.url);
      await assertPublicHost(url);
      const link = target ? absoluteAppUrl(targetPath(loaded.slug, target.kind, target.id)) : null;
      const merge = { ...(target?.merge ?? {}), link, workflow: loaded.run.workflow.name };
      const body =
        action.type === "slack.post"
          ? { text: renderMessage(action.params.message, merge).slice(0, 3000) }
          : action.type === "discord.post"
            ? { content: renderMessage(action.params.message, merge).slice(0, 2000) }
            : {
                event: ref?.event ?? null,
                workflow: { id: loaded.run.workflow.id, name: loaded.run.workflow.name },
                record: target ? { kind: target.kind, id: target.id, name: target.name, url: link } : null,
                runId,
                at: new Date().toISOString(),
              };
      const signal = AbortSignal.any([run.signal, AbortSignal.timeout(TIMEOUT_MS)]);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Bananasplit-CRM-Automation" },
        body: JSON.stringify(body),
        redirect: "manual",
        signal,
      });
      if (res.status >= 300 && res.status < 400) throw new PermanentJobError("It answered with a redirect, which isn't followed.");
      if (!res.ok) {
        if (res.status >= 500 && run.attempt < run.maxAttempts) throw new Error(`It answered ${res.status}; trying again.`);
        throw new PermanentJobError(`It answered ${res.status}.`);
      }
      entry = { action: action.type, ok: true, detail: action.type === "webhook.call" ? `Called (${res.status}).` : "Posted." };
    } catch (error) {
      if (!(error instanceof PermanentJobError) && run.attempt < run.maxAttempts && !(error instanceof Error && error.name === "TimeoutError")) {
        throw error;
      }
      const detail =
        error instanceof PermanentJobError
          ? error.message
          : error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
            ? "It didn't answer within 10 seconds."
            : "It couldn't be reached.";
      entry = { action: action.type, ok: false, detail: `Failed: ${detail}` };
    }
  }
  await withSystemOrgTx(orgId, async ({ db }) => {
    const r = await db.crmWorkflowRun.findFirst({ where: { id: runId, organizationId: orgId }, select: { log: true } });
    if (!r) return;
    const log = (Array.isArray(r.log) ? [...(r.log as unknown as RunLogEntry[])] : []) as RunLogEntry[];
    log[index] = entry;
    const failed = log.some((e) => e && !e.ok && e.detail.startsWith("Failed"));
    await db.crmWorkflowRun.updateMany({
      where: { id: runId, organizationId: orgId },
      data: { log: log as unknown as Prisma.InputJsonArray, ...(failed ? { status: "FAILED" } : {}) },
    });
  });
};
