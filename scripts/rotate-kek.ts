/**
 * pnpm secrets:rotate-kek — rewrap every org secret's data key under the
 * current key-encryption key (SECRETS_KEK_CURRENT).
 *
 * Rotation procedure (docs/features/settings.md, RUNBOOK):
 *   1. Generate a new key: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   2. Add it as SECRETS_KEK_V{n+1} next to the old one(s), set
 *      SECRETS_KEK_CURRENT={n+1}, and deploy (new secrets use the new KEK;
 *      old ones still decrypt with theirs).
 *   3. Run this script with the same environment: every OrgSecret whose
 *      kekVersion differs is rewrapped. Only the wrapped data key changes;
 *      the ciphertext is untouched, so a failure half way loses nothing.
 *   4. Once `--dry-run` reports 0 to rewrap, remove the old SECRETS_KEK_V{n}.
 *
 * It runs as the table OWNER (MIGRATE_DATABASE_URL, else DATABASE_URL_UNPOOLED,
 * else DATABASE_URL): no runtime role can read OrgSecret. Each row is
 * updated with a compare-and-set on its old kekVersion, all in one
 * transaction. Nothing secret is printed.
 *
 *   pnpm secrets:rotate-kek [--dry-run]
 */
import "dotenv/config";

import pg from "pg";

import { rewrapSecret, type EncryptedSecret } from "@/server/secrets/envelope";
import { loadKeyring } from "@/server/secrets/keyring";

interface Row {
  id: string;
  organizationId: string;
  integrationId: string;
  kind: string;
  provider: string;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDek: Buffer;
  dekIv: Buffer;
  dekTag: Buffer;
  kekVersion: number;
}

function ownerUrl(): string {
  const url =
    process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("set MIGRATE_DATABASE_URL (the table owner) to rotate");
  return url;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const ring = loadKeyring();
  const client = new pg.Client({ connectionString: ownerUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<Row>(
      `SELECT s."id", s."organizationId", s."integrationId", s."kind", i."provider"::text AS provider,
              s."ciphertext", s."iv", s."authTag", s."wrappedDek", s."dekIv", s."dekTag", s."kekVersion"
         FROM "OrgSecret" s
         JOIN "OrgIntegration" i ON i."organizationId" = s."organizationId" AND i."id" = s."integrationId"
        WHERE s."kekVersion" <> $1
        ORDER BY s."id"
          FOR UPDATE OF s`,
      [ring.current],
    );
    console.log(`[rotate-kek] current KEK v${ring.current}; ${rows.length} secret(s) to rewrap`);
    if (dryRun || rows.length === 0) {
      await client.query("ROLLBACK");
      return;
    }

    let done = 0;
    for (const row of rows) {
      const record: EncryptedSecret = {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.authTag,
        wrappedDek: row.wrappedDek,
        dekIv: row.dekIv,
        dekTag: row.dekTag,
        kekVersion: row.kekVersion,
      };
      const next = rewrapSecret(
        record,
        {
          orgId: row.organizationId,
          integrationId: row.integrationId,
          provider: row.provider,
          kind: row.kind,
        },
        ring,
      );
      const res = await client.query(
        `UPDATE "OrgSecret" SET "wrappedDek" = $2, "dekIv" = $3, "dekTag" = $4, "kekVersion" = $5
          WHERE "id" = $1 AND "kekVersion" = $6`,
        [row.id, next.wrappedDek, next.dekIv, next.dekTag, next.kekVersion, row.kekVersion],
      );
      if (res.rowCount !== 1) throw new Error(`secret ${row.id} changed during rotation`);
      done += 1;
    }
    await client.query("COMMIT");
    console.log(`[rotate-kek] rewrapped ${done} secret(s) under KEK v${ring.current}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[rotate-kek] failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
