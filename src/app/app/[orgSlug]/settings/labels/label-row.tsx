"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";

import { deleteLabel, updateLabel } from "./actions";

export function LabelRow({
  orgId,
  label,
}: {
  orgId: string;
  label: { id: string; name: string; color: string };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmEl, confirm] = useConfirm();

  function handleRename() {
    setError(null);
    startTransition(async () => {
      const result = await updateLabel(orgId, label.id, { name, color: label.color });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete the label “${label.name}”?`,
      description: "It comes off every task that has it. The tasks stay.",
      confirmLabel: "Delete label",
      run: async () => {
        try {
          await deleteLabel(orgId, label.id);
        } catch {
          return "Only owners and admins can delete labels.";
        }
      },
    });
    if (ok) router.refresh();
  }

  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      {editing ? (
        <>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 w-40"
            autoFocus
          />
          <Button size="sm" disabled={isPending} onClick={handleRename}>
            Save
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Badge style={{ backgroundColor: label.color, color: "white" }} className="border-0">
            {label.name}
          </Badge>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Rename
          </Button>
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => void handleDelete()}>
            Delete
          </Button>
        </>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
      {confirmEl}
    </div>
  );
}
