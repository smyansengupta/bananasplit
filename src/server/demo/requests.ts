import "server-only";

import { authDb } from "@/server/db/clients";

export interface DemoRequestInput {
  name: string;
  email: string;
  organization: string;
  teamSize: string;
  message: string | null;
  /** When the email to the inbox went out; null if it didn't. */
  emailedAt: Date | null;
}

/**
 * Saves a /demo request (DemoRequest). app_auth may only insert into the
 * table (no tenant context; it can't read one back), so this writes without
 * RETURNING. Platform data: the owner role reads it.
 */
export async function saveDemoRequest(input: DemoRequestInput): Promise<void> {
  await authDb.demoRequest.createMany({ data: [input] });
}
