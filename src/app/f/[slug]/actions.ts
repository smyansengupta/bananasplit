"use server";

import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { submissionSchema } from "@/lib/forms/answers";
import type { QuestionSummary } from "@/lib/forms/summary";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import {
  formPageTarget,
  loadPublicForm,
  publicResults,
  submitResponse,
  type SubmitResult,
} from "@/server/forms/public";
import { sendFormReceipt } from "@/server/forms/receipt";
import { formToCrm } from "@/server/crm/outreach/intake";

/**
 * The public form's two calls: send the answers, and (for a quick poll
 * that shows them) read the results. Anyone may call these, signed in or
 * not; submitResponse decides whether this person may answer.
 */

const SUBMITS = { limit: 20, windowSec: 10 * 60 };

const input = submissionSchema.extend({
  /** The honeypot: a field people never see. */
  website: z.string().max(200).optional(),
});

export async function submitForm(slug: string, raw: unknown): Promise<SubmitResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: "Something's off with that form. Reload and try again." };
  // Looks like success to a bot, does nothing.
  if (parsed.data.website) return { ok: true, responseId: "ok" };
  const limited = await checkRateLimit(
    rateLimitKey("form-submit", await getClientIp()),
    SUBMITS.limit,
    SUBMITS.windowSec,
  );
  if (!limited.allowed)
    return { ok: false, error: "Too many answers from here. Wait a few minutes and try again." };
  const target = await formPageTarget(slug);
  if (!target) return { ok: false, error: "This form isn't taking answers." };
  const session = await getSession();
  try {
    const result = await submitResponse(
      target,
      { answers: parsed.data.answers, other: parsed.data.other },
      {
        userId: session?.user.id ?? null,
        name: session?.user.name ?? null,
        email: session?.user.email ?? null,
      },
    );
    // Into the CRM when the form sends its responses there; never fails the answer.
    if (result.ok && result.responseId !== "ok") {
      await formToCrm(target, result.responseId).catch((error) =>
        console.error("[forms] CRM intake failed", error instanceof Error ? error.message : error),
      );
    }
    // A copy of their answers, when the form sends one; never fails the answer.
    if (result.ok && result.responseId !== "ok") {
      await sendFormReceipt(target, result.responseId).catch((error) =>
        console.error("[forms] receipt failed", error),
      );
    }
    return result;
  } catch (error) {
    console.error("[forms] submit failed", error);
    return { ok: false, error: "That didn't send. Try again." };
  }
}

/** A quick poll's results, when this form shows them to the people who answered. */
export async function formResults(
  slug: string,
): Promise<{ summary: QuestionSummary[]; total: number } | null> {
  const target = await formPageTarget(slug);
  if (!target) return null;
  const session = await getSession();
  const form = await loadPublicForm(slug, session?.user.id ?? null);
  if (!form || form.form.kind !== "QUICK_POLL") return null;
  if (form.form.hideResultsUntilClosed && form.open) return null;
  return publicResults(target);
}
