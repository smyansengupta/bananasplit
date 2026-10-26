/**
 * WorkOS's side of AI connections (docs/features/ai-connectors.md): list
 * or revoke the AI apps a user authorized, through WorkOS's
 * authorized-applications API. Reads WORKOS_API_KEY and
 * WORKOS_AUTHKIT_DOMAIN from .env (CONNECTORS_ENABLED need not be set);
 * touches no database, so it doesn't revoke our ConnectorGrant row: the
 * member's Disconnect on their profile does both.
 *
 *   pnpm tsx --tsconfig tsconfig.scripts.json scripts/connectors-grants.ts list <our user id>
 *   pnpm tsx --tsconfig tsconfig.scripts.json scripts/connectors-grants.ts revoke <our user id> <application id or client id>
 *
 * Our user id is User.id (WorkOS keeps it as the user's external_id).
 */
import "dotenv/config";

import { connectorsConfig } from "@/server/connectors/config";
import {
  getWorkosUserByExternalId,
  listAuthorizedApplications,
  revokeAuthorizedApplication,
  type WorkosResult,
} from "@/server/connectors/workos";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function unwrap<T>(label: string, result: WorkosResult<T>): T {
  if (!result.ok) {
    fail(`${label}: HTTP ${result.status} ${result.code ?? ""} ${result.message ?? ""}`.trim());
  }
  return result.data;
}

async function main(): Promise<void> {
  const [command, userId, applicationId] = process.argv.slice(2);
  const config = connectorsConfig({ ...process.env, CONNECTORS_ENABLED: "true" });
  if (!config) fail("Set WORKOS_API_KEY and WORKOS_AUTHKIT_DOMAIN in .env first.");
  if ((command !== "list" && command !== "revoke") || !userId) {
    fail(
      "Usage: connectors-grants.ts list <user id> | revoke <user id> <application id or client id>",
    );
  }

  const workosUser = unwrap(
    "Look up the WorkOS user",
    await getWorkosUserByExternalId(config, userId),
  );
  console.log(
    `WorkOS user ${workosUser.id} (${workosUser.email}), external_id ${workosUser.external_id}`,
  );

  if (command === "list") {
    const { data } = unwrap(
      "List authorized applications",
      await listAuthorizedApplications(config, workosUser.id),
    );
    if (data.length === 0) console.log("No authorized applications.");
    for (const grant of data) {
      console.log(
        [
          `- ${grant.application.name}`,
          `  application id: ${grant.application.id}`,
          `  client id:      ${grant.application.client_id}`,
          `  scopes:         ${grant.granted_scopes.join(" ") || "(none)"}`,
          `  first party:    ${grant.application.is_first_party}`,
        ].join("\n"),
      );
    }
    return;
  }

  if (!applicationId) fail("revoke needs an application id or client id (see list).");
  unwrap(
    "Revoke the authorized application",
    await revokeAuthorizedApplication(config, workosUser.id, applicationId),
  );
  console.log(
    `Revoked ${applicationId}. The client's next refresh should fail with invalid_grant.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
