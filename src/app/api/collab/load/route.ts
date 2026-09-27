import { NotFoundError } from "@/lib/auth/errors";
import { loadRequestSchema, toBase64, type LoadResponse } from "@/lib/collab/bridge";
import { bridgeError, bridgeJson, readBridgeRequest } from "@/server/collab/bridge-route";
import { loadNoteState } from "@/server/collab/persistence";
import { withOrgTxAs } from "@/server/db/context";

/**
 * Collaboration bridge, load (docs/features/collaboration.md): the
 * collaboration server fetches a note's Yjs state for the user whose
 * connection opened it, read in that user's own RLS context. 404 when they
 * may not see the note (or are not a member of its org).
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const req = await readBridgeRequest(request, "load", loadRequestSchema);
  if (req instanceof Response) return req;
  const { body, document } = req;

  try {
    const state = await withOrgTxAs(body.userId, document.organizationId, (ctx) =>
      loadNoteState(ctx, document.noteId),
    );
    if (!state) return bridgeError(404, "Not found");
    return bridgeJson({ state: toBase64(state) } satisfies LoadResponse);
  } catch (error) {
    if (error instanceof NotFoundError) return bridgeError(404, "Not found");
    throw error;
  }
}
