import Link from "next/link";

import { Role } from "@/generated/prisma/enums";
import type { PendingDeletionOrg } from "@/server/settings/deletion";

import { CancelDeletionButton } from "./settings/danger/cancel-deletion-button";

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });

/**
 * What an org's URL shows while it is scheduled for deletion (the org is
 * soft-deleted: nothing else of it is reachable). OWNERs can cancel.
 */
export function OrgPendingDeletion({ org }: { org: PendingDeletionOrg }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-lg border p-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {org.name} is scheduled for deletion
        </h1>
        <p className="text-muted-foreground text-sm">
          {org.deleteScheduledFor
            ? `On ${dateFmt.format(org.deleteScheduledFor)} its members, tasks, notes, events, files and settings are deleted for good.`
            : "Its data will be deleted for good."}{" "}
          Until then it is closed to everyone.
        </p>
        {org.role === Role.OWNER ? (
          <CancelDeletionButton orgId={org.id} />
        ) : (
          <p className="text-sm">Only an owner can cancel the deletion.</p>
        )}
        <p className="text-sm">
          <Link href="/app" className="underline underline-offset-4">
            Go to your other organizations
          </Link>
        </p>
      </div>
    </main>
  );
}
