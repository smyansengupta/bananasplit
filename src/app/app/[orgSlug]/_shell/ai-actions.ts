"use server";

import type { AiConnectionInfo } from "@/lib/ai/types";
import { listAiConnections } from "@/server/ai/connections";
import { withOrgTx } from "@/server/db/context";

/**
 * The AI models this club can use for imports, for the picker in the import
 * dialogs: labels only, no keys. Members only (withOrgTx refuses anyone
 * else); the listing itself reads the integration rows on the service path.
 */
export async function listAiConnectionsAction(orgId: string): Promise<AiConnectionInfo[]> {
  await withOrgTx(orgId, async () => undefined);
  return listAiConnections(orgId);
}
