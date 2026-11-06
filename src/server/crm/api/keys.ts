import { createHash, randomBytes } from "node:crypto";

import { readAddOns } from "@/lib/addons";
import { spaceIncludes } from "@/lib/billing/space";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";

/**
 * API keys for the public CRM API (docs/features/crm.md module 11). A key
 * is `bsk_{organization id}.{secret}`: the organization is in the clear so
 * the request opens that one organization's context, and the secret (32
 * random bytes) is what proves it. Only the key's SHA-256 is stored
 * (CrmApiKey.keyHash) with a short prefix to tell keys apart; the key is
 * shown once, when it's made. Owners and admins make and revoke keys (RLS
 * on CrmApiKey). Scopes: read, or read and write.
 */

export type ApiScope = "read" | "write";

const KEY = /^bsk_([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{43})$/;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function parseApiKey(key: string): { organizationId: string; secret: string } | null {
  const m = KEY.exec(key.trim());
  return m ? { organizationId: m[1]!, secret: m[2]! } : null;
}

/** A new key for an organization: the key itself (shown once), its hash and its prefix. */
export function newApiKey(organizationId: string): { key: string; keyHash: string; prefix: string } {
  const secret = randomBytes(32).toString("base64url");
  const key = `bsk_${organizationId}.${secret}`;
  return { key, keyHash: hashApiKey(key), prefix: `bsk_…${secret.slice(0, 8)}` };
}

/** `Authorization: Bearer <key>` into the key, or null. */
export function bearerKey(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1]! : null;
}

export interface VerifiedKey {
  keyId: string;
  organizationId: string;
  scopes: ApiScope[];
  createdById: string | null;
}

export type KeyCheck =
  | { ok: true; key: VerifiedKey }
  | { ok: false; status: 401 | 403; code: string; message: string };

/** Test seam: the key lookup (the service path in that organization). */
export const apiKeyStore = {
  async find(organizationId: string, keyHash: string) {
    return withSystemOrgTx(organizationId, async ({ db }) => {
      const row = await db.crmApiKey.findFirst({
        where: { organizationId, keyHash, revokedAt: null },
        select: { id: true, scopes: true, createdById: true, lastUsedAt: true },
      });
      if (!row) return null;
      const crm = await crmOpen(db, organizationId);
      // Seen at most once a minute, so a busy key doesn't write on every call.
      if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
        await db.crmApiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
      }
      return { ...row, crm };
    });
  },
};

/** The CRM is added and the plan has it (what every API call needs; Personal Plus counts). */
export async function crmOpen(db: TxClient, organizationId: string): Promise<boolean> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { kind: true, plan: true, trialEndsAt: true, planAfterTrial: true, deletedAt: true },
  });
  if (!org || org.deletedAt || !spaceIncludes(org, "crm")) return false;
  const settings = await db.orgSettings.findUnique({ where: { organizationId }, select: { addOns: true } });
  return readAddOns(settings?.addOns).includes("crm");
}

export async function verifyApiKey(header: string | null): Promise<KeyCheck> {
  const key = bearerKey(header);
  if (!key) return { ok: false, status: 401, code: "unauthorized", message: "Send your API key as Authorization: Bearer <key>." };
  const parsed = parseApiKey(key);
  if (!parsed) return { ok: false, status: 401, code: "unauthorized", message: "That API key isn't valid." };
  const row = await apiKeyStore.find(parsed.organizationId, hashApiKey(key));
  if (!row) return { ok: false, status: 401, code: "unauthorized", message: "That API key isn't valid or was revoked." };
  if (!row.crm) return { ok: false, status: 403, code: "crm_off", message: "The CRM isn't on in this space." };
  const scopes = row.scopes.filter((s): s is ApiScope => s === "read" || s === "write");
  return {
    ok: true,
    key: { keyId: row.id, organizationId: parsed.organizationId, scopes, createdById: row.createdById },
  };
}

// ---- Settings (owners and admins; RLS enforces it) ------------------------------------

export async function createApiKey(
  db: TxClient,
  organizationId: string,
  userId: string,
  input: { name: string; write: boolean },
): Promise<{ id: string; key: string; prefix: string }> {
  const name = input.name.trim().slice(0, 80) || "API key";
  const live = await db.crmApiKey.count({ where: { organizationId, revokedAt: null } });
  if (live >= 25) throw new Error("An organization can have 25 keys. Revoke one first.");
  const made = newApiKey(organizationId);
  const row = await db.crmApiKey.create({
    data: {
      organizationId,
      name,
      prefix: made.prefix,
      keyHash: made.keyHash,
      scopes: input.write ? ["read", "write"] : ["read"],
      createdById: userId,
    },
    select: { id: true },
  });
  return { id: row.id, key: made.key, prefix: made.prefix };
}

export async function revokeApiKey(db: TxClient, organizationId: string, id: string): Promise<boolean> {
  const r = await db.crmApiKey.updateMany({
    where: { id, organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count > 0;
}
