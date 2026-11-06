import type { CrmShareMode } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

import { CrmError, type CrmActor } from "../access";
import { bccAddress } from "./mailbox";
import { mailToken } from "./tokens";

/**
 * A member's own CRM settings (docs/features/crm.md, "Email connections"):
 * their BCC logging address, what their mail shares with the organization
 * (nothing, who and when only, or full messages), addresses and domains
 * never logged, and the signature added to what they send. Only they read
 * or change it (RLS).
 */

export interface MemberSettingsView {
  bccToken: string;
  bccAddress: string | null;
  shareMode: CrmShareMode;
  neverLog: string[];
  signature: string | null;
}

/** Their row, made on first use (a fresh BCC token). */
export async function ensureMemberSettings(
  db: TxClient,
  organizationId: string,
  userId: string,
): Promise<MemberSettingsView> {
  let row = await db.crmMemberSettings.findFirst({ where: { organizationId, userId } });
  if (!row) {
    row = await db.crmMemberSettings.create({
      data: { organizationId, userId, bccToken: mailToken() },
    });
  }
  return {
    bccToken: row.bccToken,
    bccAddress: bccAddress(row.bccToken),
    shareMode: row.shareMode,
    neverLog: row.neverLog,
    signature: row.signature,
  };
}

const ENTRY = /^(@?[a-z0-9.-]+\.[a-z]{2,}|[^\s@]+@[a-z0-9.-]+\.[a-z]{2,})$/;

/** "@bank.com, doctor@clinic.org\nfamily.net" -> ["@bank.com", "doctor@clinic.org", "@family.net"]. */
export function parseNeverLog(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    if (!ENTRY.test(v)) throw new CrmError(`"${raw.trim()}" isn't an address or a domain.`, ["neverLog"]);
    const entry = v.includes("@") ? v : `@${v}`;
    if (!out.includes(entry)) out.push(entry);
  }
  if (out.length > 200) throw new CrmError("Up to 200 addresses and domains.", ["neverLog"]);
  return out;
}

export async function saveMemberSettings(
  actor: CrmActor,
  input: { shareMode?: CrmShareMode; neverLog?: string; signature?: string | null; newBccAddress?: boolean },
): Promise<MemberSettingsView> {
  const { db, organizationId, userId } = actor;
  await ensureMemberSettings(db, organizationId, userId);
  const data: { shareMode?: CrmShareMode; neverLog?: string[]; signature?: string | null; bccToken?: string } = {};
  if (input.shareMode) {
    if (!["NONE", "METADATA", "FULL"].includes(input.shareMode)) throw new CrmError("Pick what to share.");
    data.shareMode = input.shareMode;
  }
  if (input.neverLog !== undefined) data.neverLog = parseNeverLog(input.neverLog);
  if (input.signature !== undefined) {
    const s = input.signature?.trim() ?? "";
    if (s.length > 2000) throw new CrmError("Keep the signature under 2,000 characters.", ["signature"]);
    data.signature = s || null;
  }
  // A new address stops anything sent to the old one from logging.
  if (input.newBccAddress) data.bccToken = mailToken();
  await db.crmMemberSettings.updateMany({ where: { organizationId, userId }, data });
  return ensureMemberSettings(db, organizationId, userId);
}

export const SHARE_LABELS: Record<CrmShareMode, { label: string; help: string }> = {
  NONE: { label: "Nothing", help: "Your mail never reaches the CRM. Replies to sequences still stop them." },
  METADATA: { label: "Who and when", help: "The CRM sees that you emailed someone, and when, but not what was said." },
  FULL: { label: "Full messages", help: "The CRM keeps the subject and what was written, on the person's timeline." },
};
