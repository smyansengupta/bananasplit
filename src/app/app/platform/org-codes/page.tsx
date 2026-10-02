import { notFound } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getUserIdentity } from "@/lib/auth/email-verification";
import {
  canIssueOrgCreationCodes,
  isPlatformAdmin,
  orgCreationEnabled,
  orgCreationMode,
} from "@/lib/auth/org-creation";
import { requireUser } from "@/lib/auth/session";
import { listOrgCreationCodes } from "@/server/settings/org-creation";

import { IssueCodeForm } from "./issue-code-form";

function isPast(date: Date): boolean {
  return date.getTime() < Date.now();
}

const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/**
 * /app/platform/org-codes: single-use org-creation codes (ORG_CREATION_MODE
 * =invite). Platform admins (PLATFORM_ADMIN_EMAILS, verified) only; anyone
 * else gets a 404. Codes are stored as sha256 hashes and expire after 14 days.
 */
export default async function OrgCodesPage() {
  const user = await requireUser();
  const identity = await getUserIdentity(user.id);
  if (!isPlatformAdmin(identity)) notFound();

  const issue = canIssueOrgCreationCodes(identity);
  const codes = await listOrgCreationCodes(user.id);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="page-title">Organization codes</h1>
        <p className="text-muted-foreground text-sm">
          Mode: <span className="font-mono">{orgCreationMode()}</span> · creation{" "}
          {orgCreationEnabled() ? "enabled" : "disabled"} (PLATFORM_ORG_CREATION_ENABLED). Give a
          club&apos;s president a code; they enter it when creating their organization.
        </p>
      </div>
      <IssueCodeForm disabledReason={issue.allowed ? undefined : issue.reason} />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Note</TableHead>
              <TableHead>Issued by</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {codes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground text-sm">
                  No codes yet.
                </TableCell>
              </TableRow>
            ) : (
              codes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.note ?? "—"}</TableCell>
                  <TableCell className="text-sm">{c.createdByEmail}</TableCell>
                  <TableCell className="text-sm">{fmt.format(c.createdAt)}</TableCell>
                  <TableCell className="text-sm">
                    {c.usedAt
                      ? `Used ${fmt.format(c.usedAt)}`
                      : isPast(c.expiresAt)
                        ? "Expired"
                        : `Open until ${fmt.format(c.expiresAt)}`}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
