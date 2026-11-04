import { ORG_KEYS_PLACE } from "@/lib/crm/org-keys";
import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

import { CrmError } from "../access";
import { logActivity, type ActivityTarget } from "../activity";
import { readPhoneStatus } from "./connection";

/**
 * Voice notes (docs/features/crm.md module 12: "record a voice note and it
 * lands on their timeline"): recorded in the browser, stored as crm-audio,
 * one NOTE row on the timeline with the audio in its meta. With Deepgram
 * connected a job writes it out and sums it up; without, it stays audio
 * with a line saying so.
 */

export const NO_DEEPGRAM_NOTE =
  `Voice note, kept as audio. Add a Deepgram key in ${ORG_KEYS_PLACE} to have voice notes written out.`;

/** A voice note past the organization's monthly spending cap. */
export const CAPPED_NOTE = "Voice note, kept as audio. Your organization has reached this month's spending cap.";

export interface VoiceNoteInput {
  organizationId: string;
  userId: string;
  audioKey: string;
  contentType: string;
  durationSec: number | null;
  targets: ActivityTarget[];
}

/** Checks each record is this organization's (and visible to the member, through RLS). */
export async function checkTargets(db: TxClient, organizationId: string, targets: readonly ActivityTarget[]): Promise<ActivityTarget[]> {
  if (targets.length === 0 || targets.length > 10) throw new CrmError("Pick who the note is about.");
  for (const t of targets) {
    const found =
      t.kind === "person"
        ? await db.crmPerson.findFirst({ where: { id: t.id, organizationId }, select: { id: true } })
        : t.kind === "company"
          ? await db.crmCompany.findFirst({ where: { id: t.id, organizationId }, select: { id: true } })
          : await db.crmDeal.findFirst({ where: { id: t.id, organizationId }, select: { id: true } });
    if (!found) throw new CrmError("One of them isn't in the CRM any more.");
  }
  return [...targets];
}

/** The note's timeline row, in the member's own transaction; the job is queued with it. */
export async function saveVoiceNote(db: TxClient, input: VoiceNoteInput): Promise<{ activityId: string; transcribing: boolean }> {
  const targets = await checkTargets(db, input.organizationId, input.targets);
  const status = await readPhoneStatus(db, input.organizationId);
  const transcribing = status.deepgram.connected;
  const activityId = await logActivity(db, {
    organizationId: input.organizationId,
    kind: "NOTE",
    subject: "Voice note",
    body: transcribing ? "Writing it out…" : NO_DEEPGRAM_NOTE,
    actorId: input.userId,
    createdById: input.userId,
    targets,
    meta: {
      voiceNote: true,
      audioKey: input.audioKey,
      contentType: input.contentType,
      durationSec: input.durationSec,
      transcribing,
    },
  });
  if (transcribing) {
    await enqueueJob(db, {
      orgId: input.organizationId,
      kind: "crm-transcribe",
      key: `note:${activityId}`,
      payload: { activityId },
    });
  }
  return { activityId, transcribing };
}
