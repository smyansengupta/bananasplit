import { BRIDGE_PATHS, signBridgeRequest } from "@/lib/collab/bridge";
import { collabConfig } from "@/lib/collab/config";
import { noteDocumentName } from "@/lib/collab/protocol";
import { assertNoTx } from "@/server/db/context";

const TIMEOUT_MS = 3000;

/**
 * Asks the collaboration server to close every connection to a note's live
 * document and to refuse every token minted before now for it, so each
 * editor has to come back with a fresh token. Queue it with ctx.afterCommit
 * when a note turns PRIVATE or is deleted: whoever may no longer see the
 * note is refused the new token and drops out now, instead of when their
 * current token expires (COLLAB_TOKEN_TTL_SECONDS). Best effort and never
 * throws: a failure is logged, and the expiry still applies.
 */
export async function revokeNoteSessions(organizationId: string, noteId: string): Promise<void> {
  const config = collabConfig();
  if (!config) return;
  assertNoTx("collab revoke");
  const body = JSON.stringify({
    documentName: noteDocumentName(organizationId, noteId),
    notBefore: Date.now(),
  });
  try {
    const response = await fetch(`${config.httpUrl}${BRIDGE_PATHS.revoke}`, {
      method: "POST",
      headers: signBridgeRequest("revoke", body, config.secret),
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) console.warn(`[collab] revoke answered ${response.status}`);
  } catch (error) {
    console.warn("[collab] revoke failed:", error instanceof Error ? error.message : error);
  }
}
