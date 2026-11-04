import { z } from "zod";

import { SHOT_IMAGE_TYPES, type ShotImageType } from "@/lib/ai/calendar-shot";
import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { sniffMimeType } from "@/lib/finance/file-sniff";
import { isCrossSite } from "@/lib/http/cross-site";
import { AiImportError } from "@/server/ai/generate";
import { CrmError } from "@/server/crm/access";
import { memberWho } from "@/server/crm/ai-tx";
import { readContact, readConversation, scanCard } from "@/server/crm/assist";
import { AppError } from "@/server/db/errors";
import { readUpload, uploadErrorResponse } from "@/server/storage/upload";

/**
 * POST /api/orgs/{orgId}/crm/ai/image  multipart `file`, `purpose`
 * ("conversation", "card", or "fill" for the New card, which only reads
 * the card back), and `personId` or `metAt`.
 *
 * A member's screenshot of a conversation (WhatsApp, LinkedIn, Instagram,
 * texts) or a photo of a business card or badge, read once by the
 * organization's AI model (src/server/crm/assist.ts) and turned into
 * suggestions in the CRM's review queue: nothing is created here, and the
 * image is never stored. Same-site only, signed in, a member of the
 * organization with the CRM; 4 MB at most, checked by its bytes. The CRM's
 * AI limits and monthly cap apply (runCrmAi).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });
  const session = await getSession();
  if (!session) return json(401, { error: "Sign in first." });
  if (!id.safeParse(orgId).success) return json(404, { error: "Not found." });

  const upload = await readUpload(request, { maxBytes: MAX_BYTES }).catch(uploadErrorResponse);
  if (upload instanceof Response) return upload;
  const type = sniffMimeType(upload.file.bytes);
  if (!type || !(SHOT_IMAGE_TYPES as readonly string[]).includes(type)) {
    return json(415, { error: "Upload a picture (PNG, JPEG, WebP or GIF)." });
  }
  const image = { mediaType: type as ShotImageType, base64: upload.file.bytes.toString("base64") };
  const who = memberWho(orgId, session.user.id);
  try {
    if (upload.fields.purpose === "fill") {
      // The New card: read the card to fill its fields; nothing is proposed or kept.
      const r = await readContact(who, { image });
      return json(200, {
        kind: "fill",
        name: r.name,
        title: r.title,
        company: r.company,
        email: r.email,
        phone: r.phone,
        website: r.website,
        notes: r.notes,
      });
    }
    if (upload.fields.purpose === "card") {
      const r = await scanCard(who, { image, metAt: upload.fields.metAt?.slice(0, 200) ?? null });
      return json(200, {
        kind: "card",
        name: r.reading.name,
        company: r.reading.company,
        title: r.reading.title,
        existing: r.existing,
        suggestionId: r.suggestionId,
        notes: r.reading.notes,
      });
    }
    const personId = upload.fields.personId && id.safeParse(upload.fields.personId).success ? upload.fields.personId : null;
    const r = await readConversation(who, { image, text: upload.fields.text?.slice(0, 20_000) ?? null, personId });
    return json(200, { kind: "conversation", matched: r.matched, queued: r.queued, summary: r.reading.summary, notes: r.reading.notes });
  } catch (error) {
    if (error instanceof AiImportError) {
      return json(error.status, { error: error.message, ...(error.status === 409 ? { code: "no-connection" } : {}) });
    }
    if (error instanceof CrmError) return json(422, { error: error.message });
    if (error instanceof NotFoundError) return json(404, { error: "Not found." });
    if (error instanceof AppError && error.status < 500) return json(error.status, { error: error.message });
    throw error;
  }
}
