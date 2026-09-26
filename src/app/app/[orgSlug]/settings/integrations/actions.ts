"use server";

import { z } from "zod";

import { IntegrationProvider } from "@/generated/prisma/enums";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import {
  disconnectGoogle,
  removeProvider,
  resolveActor,
  saveClaude,
  saveEmailSender,
  saveGoogleCalendars,
  saveNetlifyHook,
  saveSupabase,
  sendTestEmail,
  setPlatformMailFallback,
  testProvider,
  type IntegrationResult,
  type OrgActor,
} from "@/server/integrations/service";

/**
 * Settings > Integrations actions. Not withOrgAction: saving, testing and
 * removing a secret must run on the service path with no transaction open
 * around the network check (src/server/secrets). Each action resolves the
 * caller's role in the org through the database first (a non-member gets
 * nothing), then the service checks the permission.
 *
 * Every result is { ok, message } or { ok: false, error }: secrets are
 * write-only and never come back.
 */

const providerSchema = z.enum(IntegrationProvider);
const idSchema = z.string().min(1).max(100);
const optionalSecret = z.string().max(8192).optional();

const claudeInput = z.object({
  apiKey: optionalSecret,
  model: z.string().max(100).optional(),
  fallbacks: z.boolean().optional(),
});
const emailInput = z.object({
  fromName: z.string().max(200),
  fromAddress: z.string().max(300),
  replyTo: z.string().max(300).optional(),
  apiKey: optionalSecret,
});
const supabaseInput = z.object({
  projectRef: z.string().max(100),
  poolerRegion: z.string().max(40),
  poolerPrefix: z.string().max(10),
  roleName: z.string().max(100).optional(),
  password: optionalSecret,
});
const calendarsInput = z.object({
  publicCalendarId: z.string().max(300).nullable().optional(),
  internalCalendarId: z.string().max(300).nullable().optional(),
});

async function run(
  orgId: string,
  fn: (actor: OrgActor) => Promise<IntegrationResult>,
): Promise<IntegrationResult> {
  try {
    const actor = await resolveActor(idSchema.parse(orgId));
    return await fn(actor);
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    if (error instanceof NotFoundError) return { ok: false, error: "Not found." };
    if (error instanceof z.ZodError) return { ok: false, error: "Invalid input." };
    throw error;
  }
}

export async function saveClaudeAction(orgId: string, input: z.input<typeof claudeInput>) {
  return run(orgId, (actor) => saveClaude(orgId, actor, claudeInput.parse(input)));
}

export async function saveEmailSenderAction(orgId: string, input: z.input<typeof emailInput>) {
  return run(orgId, (actor) => saveEmailSender(orgId, actor, emailInput.parse(input)));
}

export async function sendTestEmailAction(orgId: string) {
  return run(orgId, (actor) => sendTestEmail(orgId, actor));
}

export async function setMailFallbackAction(orgId: string, enabled: boolean) {
  return run(orgId, () => setPlatformMailFallback(orgId, z.boolean().parse(enabled)));
}

export async function saveSupabaseAction(orgId: string, input: z.input<typeof supabaseInput>) {
  return run(orgId, (actor) => saveSupabase(orgId, actor, supabaseInput.parse(input)));
}

export async function saveNetlifyHookAction(orgId: string, hookUrl: string) {
  return run(orgId, (actor) => saveNetlifyHook(orgId, actor, z.string().max(500).parse(hookUrl)));
}

export async function saveGoogleCalendarsAction(
  orgId: string,
  input: z.input<typeof calendarsInput>,
) {
  return run(orgId, (actor) => saveGoogleCalendars(orgId, actor, calendarsInput.parse(input)));
}

export async function disconnectGoogleAction(orgId: string) {
  return run(orgId, (actor) => disconnectGoogle(orgId, actor));
}

export async function testIntegrationAction(orgId: string, provider: string) {
  return run(orgId, (actor) => testProvider(orgId, actor, providerSchema.parse(provider)));
}

export async function removeIntegrationAction(orgId: string, provider: string) {
  return run(orgId, (actor) => removeProvider(orgId, actor, providerSchema.parse(provider)));
}
