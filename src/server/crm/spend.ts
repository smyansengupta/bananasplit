import { costOf, type PerUse } from "@/lib/crm/per-use";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";

import { CrmError } from "./access";
import { AiCapError, assertUnderCap } from "./ai";

/**
 * The meter for everything the organization pays per use that isn't a
 * model's tokens (docs/features/crm.md, "Whose keys pay for what"): web
 * searches, lookups, texts, call minutes, transcripts and bulk email. Each
 * is one AiUsage row (the CRM's one usage meter) with an estimated cost on
 * the organization's own key, so the same monthly spending cap
 * (CrmSettings.aiMonthlyCapCents) covers AI and everything else, and CRM
 * settings shows this month's use per key.
 *
 * Prices are rough list prices in micro-dollars, for the cap and the
 * estimate only: the provider's own bill is the truth.
 */

export { billedMinutes, costOf, PER_USE_MICROS, textSegments, type PerUse } from "@/lib/crm/per-use";

export interface MeterInput {
  organizationId: string;
  userId: string | null;
  /** crm.research, crm.text, crm.call, crm.transcript, crm.email... */
  feature: string;
  /** tavily, hunter, prospeo, telnyx, twilio, deepgram, resend */
  provider: string;
  what: PerUse;
  units?: number;
  /** Whose account carried it (default the organization's key; PLATFORM rows stay outside its cap). */
  paidBy?: "ORG_KEY" | "PLATFORM";
}

/** One meter row in an open service-path transaction. */
export async function meterUseIn(db: TxClient, input: MeterInput): Promise<void> {
  const units = input.units ?? 1;
  if (units <= 0) return;
  await db.aiUsage.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      feature: input.feature,
      provider: input.provider,
      model: units === 1 ? input.what : `${input.what} x${Math.round(units)}`,
      costMicros: costOf(input.what, units),
      paidBy: input.paidBy ?? "ORG_KEY",
    },
  });
}

/** One meter row on the service path (call with no transaction open). */
export async function meterUse(input: MeterInput): Promise<void> {
  await withSystemOrgTx(input.organizationId, ({ db }) => meterUseIn(db, input));
}

/**
 * Refuses work that would go past the organization's monthly spending cap,
 * as a CrmError with the plain message (for texts, calls, transcripts and
 * email, whose callers show CrmError words). AI paths throw AiCapError
 * through assertUnderCap directly.
 */
export async function assertCanSpend(organizationId: string, upcomingMicros = 0): Promise<void> {
  try {
    await assertUnderCap(organizationId, upcomingMicros);
  } catch (error) {
    if (error instanceof AiCapError) throw new CrmError(error.message);
    throw error;
  }
}

/** Whether there's room under the cap (for jobs, which skip quietly instead of failing). */
export async function underCap(organizationId: string, upcomingMicros = 0): Promise<boolean> {
  try {
    await assertUnderCap(organizationId, upcomingMicros);
    return true;
  } catch (error) {
    if (error instanceof AiCapError) return false;
    throw error;
  }
}
