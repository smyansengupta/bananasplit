import { FinanceAccessNotice } from "@/components/finance/finance-access";
import type { Role } from "@/generated/prisma/enums";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { withOrgTx } from "@/server/db/context";
import { loadFinancePeople } from "@/server/finance/setup";

/**
 * The finance pages' answer to someone who isn't an owner or treasurer:
 * who manages the money, and what they can do instead. A page renders this
 * rather than throwing, since a thrown ForbiddenError reaches a production
 * browser only as "Something went wrong".
 */
export async function FinanceAccessGate({
  orgId,
  orgSlug,
  role,
  compact,
}: {
  orgId: string;
  orgSlug: string;
  role: Role;
  compact?: boolean;
}) {
  const people = await withOrgTx(orgId, ({ db }) => loadFinancePeople(db, orgId)).catch(handleAuthErrorInPage);
  return <FinanceAccessNotice orgSlug={orgSlug} role={role} people={people} compact={compact} />;
}
