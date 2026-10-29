import { KeyRound } from "@/components/icons";
import { notFound } from "next/navigation";

import { TableFrame } from "@/components/databases/table-frame";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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

  const open = codes.filter((c) => !c.usedAt && !isPast(c.expiresAt)).length;
  const used = codes.filter((c) => c.usedAt).length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-7.5 p-6">
      <div className="space-y-3">
        <PageHeader
          title="Organization codes"
          description={`${open} open · ${used} used · creation ${orgCreationEnabled() ? "enabled" : "disabled"}`}
        />
        <p className="text-muted-foreground max-w-prose text-sm">
          Mode: <span className="font-mono">{orgCreationMode()}</span>{" "}
          (PLATFORM_ORG_CREATION_ENABLED turns creation on or off). Give an organization&apos;s
          leader a code; they enter it when creating their organization.
        </p>
      </div>
      <div className="space-y-4.5">
        <IssueCodeForm disabledReason={issue.allowed ? undefined : issue.reason} />
        {codes.length === 0 ? (
          <Card>
            <EmptyState
              icon={KeyRound}
              title="No codes yet."
              description="Codes you issue show here, with who used them and when."
            />
          </Card>
        ) : (
          <TableFrame maxHeight="none">
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
                {codes.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-semibold">{c.note ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.createdByEmail}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {fmt.format(c.createdAt)}
                    </TableCell>
                    <TableCell>
                      {c.usedAt ? (
                        <Badge variant="success">Used {fmt.format(c.usedAt)}</Badge>
                      ) : isPast(c.expiresAt) ? (
                        <Badge variant="secondary">Expired</Badge>
                      ) : (
                        <Badge variant="info">Open until {fmt.format(c.expiresAt)}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        )}
      </div>
    </div>
  );
}
