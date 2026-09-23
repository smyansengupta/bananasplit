"use server";

import { requireUser } from "@/lib/auth/session";
import { OrgCodeError, issueOrgCreationCode } from "@/server/settings/org-creation";

export interface IssueCodeState {
  error?: string;
  /** Shown once; only its hash is stored. */
  code?: string;
  expiresAt?: string;
}

/** Platform admins only (checked in issueOrgCreationCode). */
export async function issueCodeAction(
  _prev: IssueCodeState,
  formData: FormData,
): Promise<IssueCodeState> {
  const user = await requireUser();
  const note = formData.get("note");
  try {
    const { code, expiresAt } = await issueOrgCreationCode(
      user.id,
      typeof note === "string" ? note : null,
    );
    return { code, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    if (error instanceof OrgCodeError) return { error: error.message };
    throw error;
  }
}
