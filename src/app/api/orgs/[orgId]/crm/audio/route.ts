import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { isCrossSite } from "@/lib/http/cross-site";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { CrmError, requireCrm } from "@/server/crm/access";
import type { ActivityTarget } from "@/server/crm/activity";
import { AUDIO_EXT, sniffAudio } from "@/server/crm/phone/audio";
import { saveVoiceNote } from "@/server/crm/phone/voice-notes";
import { readPhoneSettings } from "@/lib/crm/phone";
import { withOrgAction, withOrgTx } from "@/server/db/context";
import { deleteBlobs, getBlob, putBlob, randomKeyId } from "@/server/storage";
import { MAX_UPLOAD_BYTES } from "@/server/storage/kinds";
import { checkUpload, uploadRefusalResponse } from "@/server/storage/quota";
import { readUpload, UploadError } from "@/server/storage/upload";

/**
 * Audio in the CRM (crm-audio, private):
 *
 * - POST, multipart `file` with `purpose` "note" (a voice note; `targets`
 *   is JSON [{kind, id}], `duration` seconds) or "voicemail" (the
 *   organization's voicemail to drop; owners and admins). A route, not a
 *   Server Action (1 MB bodies); 4 MB at most; the bytes decide the type.
 *   The blob is written first, then the row; the blob goes if the row fails.
 * - GET ?call={id} | ?activity={id} | ?voicemail=1: plays it back, after
 *   reading the row as the member (RLS decides who may hear it).
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const saveNote = withOrgAction(
  async (ctx, input: { key: string; contentType: string; durationSec: number | null; targets: ActivityTarget[] }) => {
    await requireCrm(ctx);
    return saveVoiceNote(ctx.db, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      audioKey: input.key,
      contentType: input.contentType,
      durationSec: input.durationSec,
      targets: input.targets,
    });
  },
  { feature: "crm" },
);

const saveVoicemail = withOrgAction(
  async (ctx, key: string) => {
    const access = await requireCrm(ctx);
    if (!access.admin) throw new CrmError("Only owners and admins set the voicemail.");
    const s = await ctx.db.crmSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { phone: true } });
    const before = readPhoneSettings(s?.phone).voicemailKey;
    await ctx.db.crmSettings.update({
      where: { organizationId: ctx.organizationId },
      data: { phone: { ...((s?.phone ?? {}) as Record<string, unknown>), voicemailKey: key } },
    });
    return before;
  },
  { feature: "crm" },
);

function parseTargets(raw: string | undefined): ActivityTarget[] | null {
  try {
    const v = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(v) || v.length === 0 || v.length > 10) return null;
    const out: ActivityTarget[] = [];
    for (const t of v) {
      const kind = (t as { kind?: unknown }).kind;
      const id = (t as { id?: unknown }).id;
      if ((kind !== "person" && kind !== "company" && kind !== "deal") || typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
        return null;
      }
      out.push({ kind, id });
    }
    return out;
  } catch {
    return null;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });
  const session = await getSession();
  if (!session) return json(401, { error: "Sign in again." });
  const gate = { feature: "crm", routeMaxBytes: MAX_UPLOAD_BYTES } as const;
  try {
    const refusal = await checkUpload(orgId, 0, gate);
    if (refusal) return uploadRefusalResponse(refusal);
  } catch (error) {
    if (error instanceof NotFoundError) return json(404, { error: "Not found." });
    throw error;
  }
  const limited = await checkRateLimit(rateLimitKey("crm-audio-upload", session.user.id), 60, 3600);
  if (!limited.allowed) return json(429, { error: "Too many recordings. Try again in a few minutes." });
  let upload;
  try {
    upload = await readUpload(request, { maxBytes: MAX_UPLOAD_BYTES });
  } catch (error) {
    if (error instanceof UploadError) {
      return json(error.status, { error: error.status === 413 ? "Keep a recording under 4 MB (about 10 minutes)." : error.message });
    }
    throw error;
  }
  const { file, fields } = upload;
  const type = sniffAudio(file.bytes);
  if (!type) return json(415, { error: "That isn't a recording we can play." });
  const purpose = fields.purpose === "voicemail" ? "voicemail" : "note";
  const targets = purpose === "note" ? parseTargets(fields.targets) : [];
  if (!targets) return json(400, { error: "Pick who the note is about." });
  const refusal = await checkUpload(orgId, file.bytes.length, gate);
  if (refusal) return uploadRefusalResponse(refusal);
  const duration = Number(fields.duration ?? "");

  const stored = await putBlob(
    "crm-audio",
    orgId,
    [purpose === "note" ? "notes" : "voicemail", `${randomKeyId()}.${AUDIO_EXT[type]}`],
    file.bytes,
    { contentType: type },
  );
  try {
    if (purpose === "voicemail") {
      const before = await saveVoicemail(orgId, stored.key);
      if (before && before !== stored.key) await deleteBlobs([before]);
      return json(201, { ok: true });
    }
    const saved = await saveNote(orgId, {
      key: stored.key,
      contentType: type,
      durationSec: Number.isFinite(duration) && duration > 0 && duration < 7200 ? Math.round(duration) : null,
      targets,
    });
    return json(201, { ok: true, activityId: saved.activityId, transcribing: saved.transcribing });
  } catch (error) {
    await deleteBlobs([stored.key]);
    if (error instanceof CrmError) return json(422, { error: error.message });
    if (error instanceof NotFoundError) return json(404, { error: "Not found." });
    throw error;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });
  const url = new URL(request.url);
  const callId = url.searchParams.get("call");
  const activityId = url.searchParams.get("activity");
  const voicemail = url.searchParams.get("voicemail") === "1";
  const id = callId ?? activityId;
  if (!voicemail && (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id))) return new NextResponse(null, { status: 404 });
  let key: string | null = null;
  try {
    key = await withOrgTx(orgId, async (ctx) => {
      await requireCrm(ctx);
      if (voicemail) {
        const s = await ctx.db.crmSettings.findUnique({ where: { organizationId: orgId }, select: { phone: true } });
        return readPhoneSettings(s?.phone).voicemailKey;
      }
      if (callId) {
        const call = await ctx.db.crmCall.findFirst({ where: { id: callId, organizationId: orgId }, select: { recordingKey: true } });
        return call?.recordingKey ?? null;
      }
      const a = await ctx.db.crmActivity.findFirst({ where: { id: activityId!, organizationId: orgId, deletedAt: null }, select: { meta: true } });
      const k = (a?.meta as { audioKey?: unknown } | null)?.audioKey;
      return typeof k === "string" ? k : null;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof CrmError) return new NextResponse(null, { status: 404 });
    throw error;
  }
  if (!key || !key.startsWith(`crm-audio/${orgId}/`)) return new NextResponse(null, { status: 404 });
  const blob = await getBlob(key);
  if (!blob) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(blob.body), {
    headers: { "Content-Type": blob.contentType, "Cache-Control": "private, no-store", "Content-Length": String(blob.body.length) },
  });
}
