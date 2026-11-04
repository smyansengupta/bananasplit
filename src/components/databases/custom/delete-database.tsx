"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { deleteDatabaseAction } from "@/app/app/[orgSlug]/databases/custom-actions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { deleteConfirmCopy } from "@/lib/databases/delete";

/**
 * Deleting a database for good: the confirm (saying a report reading it
 * will show it's gone), the action, then back to Databases. Render the
 * element, call the function from a button.
 */
export function useDeleteDatabase({
  orgId,
  orgSlug,
  database,
  onDeleted,
}: {
  orgId: string;
  orgSlug: string;
  database: { id: string; name: string; reportCount: number };
  /** Before leaving the page (closing a dialog, say). */
  onDeleted?: () => void;
}): [ReactNode, () => Promise<void>] {
  const router = useRouter();
  const [confirmEl, confirm] = useConfirm();

  async function remove() {
    const ok = await confirm({
      ...deleteConfirmCopy(database.name, database.reportCount),
      tone: "destructive",
      run: async () => (await deleteDatabaseAction(orgId, database.id)).error,
    });
    if (!ok) return;
    onDeleted?.();
    toast({ title: `${database.name} deleted` });
    router.push(`/app/${orgSlug}/databases`);
  }

  return [confirmEl, remove];
}
