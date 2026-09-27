import * as Y from "yjs";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import {
  fromBase64,
  MAX_STATE_BYTES,
  storeRequestSchema,
  toBase64,
  type StoreResponse,
} from "@/lib/collab/bridge";
import { bridgeError, bridgeJson, readBridgeRequest } from "@/server/collab/bridge-route";
import { storeNoteState } from "@/server/collab/persistence";
import { withOrgTxAs } from "@/server/db/context";

/**
 * Collaboration bridge, store (docs/features/collaboration.md): the
 * collaboration server saves a note's live document (debounced, a few
 * seconds after the last edit) as its last writer, in that user's own RLS
 * context. Answers the new version and whatever the live document is
 * missing (an autosave merged in). 403 when the user may not edit the note,
 * 404 when they may not see it, 409 when the row kept changing underneath,
 * 422 when the document does not fit the note schema.
 */
export const dynamic = "force-dynamic";

const FAILURES = {
  not_found: [404, "Not found"],
  forbidden: [403, "Forbidden"],
  invalid: [422, "The document does not fit the note schema"],
  conflict: [409, "The note kept changing; try again"],
} as const;

export async function POST(request: Request) {
  const req = await readBridgeRequest(request, "store", storeRequestSchema);
  if (req instanceof Response) return req;
  const { body, document } = req;

  const state = fromBase64(body.state);
  if (state.byteLength > MAX_STATE_BYTES) return bridgeError(413, "Document too large");
  try {
    // Decodes every struct: a malformed update is refused before any transaction opens.
    Y.encodeStateVectorFromUpdate(state);
  } catch {
    return bridgeError(400, "Invalid document state");
  }

  try {
    const result = await withOrgTxAs(body.userId, document.organizationId, (ctx) =>
      storeNoteState(ctx, document.noteId, state),
    );
    if (!result.ok) {
      const [status, message] = FAILURES[result.reason];
      return bridgeError(status, message);
    }
    return bridgeJson({
      version: result.version,
      update: result.missing ? toBase64(result.missing) : null,
    } satisfies StoreResponse);
  } catch (error) {
    if (error instanceof NotFoundError) return bridgeError(404, "Not found");
    if (error instanceof ForbiddenError) return bridgeError(403, "Forbidden");
    throw error;
  }
}
