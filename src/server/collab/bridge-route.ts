import type { z } from "zod";

import { MAX_BODY_BYTES, verifyBridgeRequest, type BridgeOperation } from "@/lib/collab/bridge";
import { collabConfig } from "@/lib/collab/config";
import { parseDocumentName, type NoteDocument } from "@/lib/collab/protocol";

/**
 * The front door of the bridge routes (/api/collab/load and /store), which
 * only the collaboration server calls. In order: 503 unless collaboration is
 * configured (fail closed: with the flag off nothing reaches a note); 413
 * for a body over the cap, before reading it; 401 unless the signature is
 * valid for this operation; 400 for a body that does not parse; 404 for a
 * document that is not a note. Unlike browser routes there is no session
 * and no same-origin check: the signature is the only credential.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export function bridgeError(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

export function bridgeJson(body: unknown): Response {
  return Response.json(body, { headers: NO_STORE });
}

async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface BridgeRequest<T> {
  body: T;
  document: NoteDocument;
}

export async function readBridgeRequest<T extends { documentName: string }>(
  request: Request,
  operation: BridgeOperation,
  schema: z.ZodType<T>,
): Promise<BridgeRequest<T> | Response> {
  const config = collabConfig();
  if (!config) return bridgeError(503, "Collaboration is not configured");

  const raw = await readCapped(request);
  if (raw === null) return bridgeError(413, "Document too large");
  if (!verifyBridgeRequest(operation, raw, (name) => request.headers.get(name), config.secret)) {
    return bridgeError(401, "Unauthorized");
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return bridgeError(400, "Invalid body");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return bridgeError(400, "Invalid body");
  const document = parseDocumentName(parsed.data.documentName);
  if (!document) return bridgeError(404, "Unknown document");
  return { body: parsed.data, document };
}
