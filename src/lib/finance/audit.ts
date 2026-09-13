import type { Prisma } from "@/generated/prisma/client";

interface FinanceAuditLogWriter {
  financeAuditLog: {
    create: (args: { data: Prisma.FinanceAuditLogUncheckedCreateInput }) => Promise<unknown>;
  };
}

/**
 * Appends a FinanceAuditLog row inside the same DB transaction as the
 * mutation it describes (spec 5.9). Never call this outside a
 * `prisma.$transaction` — a log entry with no matching committed change is
 * worse than no log at all.
 */
export async function writeFinanceAuditLog(
  tx: FinanceAuditLogWriter,
  params: {
    organizationId: string;
    actorId: string;
    transactionId?: string | null;
    sponsorshipId?: string | null;
    action: string;
    before?: unknown;
    after?: unknown;
  },
) {
  await tx.financeAuditLog.create({
    data: {
      organizationId: params.organizationId,
      actorId: params.actorId,
      transactionId: params.transactionId ?? null,
      sponsorshipId: params.sponsorshipId ?? null,
      action: params.action,
      diffJson: {
        before: params.before ?? null,
        after: params.after ?? null,
      } as Prisma.InputJsonValue,
    },
  });
}
