import type { Prisma } from "@/generated/prisma/client";
import { userPublicSelect } from "@/server/members";

import type { FieldSpec } from "../query-builder";

/**
 * The contact shape every people-bearing database selects: the display
 * name, the masked email, the linked member (for UserAvatar), and the
 * primary full address. ContactEmail is row-gated by RLS
 * (can_view_rows CONTACT_EMAIL), so for a viewer without access `emails`
 * comes back empty and the masked address is shown instead: the privacy
 * tier is applied by the database, in the table, the drawer and the export.
 */
export const contactSelect = {
  id: true,
  displayName: true,
  emailMasked: true,
  userId: true,
  lapsedSince: true,
  user: { select: userPublicSelect },
  emails: { where: { isPrimary: true }, select: { emailNormalized: true }, take: 1 },
} satisfies Prisma.ContactSelect;

export type ContactRecord = Prisma.ContactGetPayload<{ select: typeof contactSelect }>;

/** Field specs for the contact behind a row (Attendance, Signup, ContactTermStats). */
export function contactFields(prefix: readonly string[]): Record<string, FieldSpec> {
  return {
    person: {
      path: [...prefix, "displayName"],
      kind: "text",
      nullable: true,
      sortable: true,
      filterable: true,
      ops: ["contains", "eq", "isnull"],
    },
    contactId: {
      path: [...prefix, "id"],
      kind: "string",
      filterable: true,
      ops: ["eq", "in"],
    },
    linked: {
      path: [...prefix, "userId"],
      kind: "boolean",
      filterable: true,
      ops: ["eq"],
      where: (_op, v) => nestPath(prefix, { userId: v === true ? { not: null } : null }),
    },
    memberId: {
      path: [...prefix, "userId"],
      kind: "string",
      nullable: true,
      filterable: true,
      ops: ["eq", "in", "isnull"],
    },
  };
}

export function nestPath(
  prefix: readonly string[],
  leaf: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> = leaf;
  for (let i = prefix.length - 1; i >= 0; i--) out = { [prefix[i]]: out };
  return out;
}

/** ?q= over a contact: display name, masked email and (for viewers RLS lets see it) the full address. */
export function contactSearch(prefix: readonly string[], q: string): Record<string, unknown>[] {
  const email = q.toLowerCase();
  return [
    nestPath(prefix, { displayName: { contains: q, mode: "insensitive" } }),
    nestPath(prefix, { emailMasked: { contains: email, mode: "insensitive" } }),
    nestPath(prefix, { emails: { some: { emailNormalized: { contains: email } } } }),
  ];
}

export const CONTACT_ALIASES = { member: "person", name: "person", displayName: "person" } as const;
