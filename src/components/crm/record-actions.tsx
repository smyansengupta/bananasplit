"use client";

import { History, Merge, MoreHorizontal, RotateCcw, Trash2, Undo2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { mergeAction, restoreAction, restoreToPointAction, trashAction, undoAction } from "@/app/app/[orgSlug]/crm/actions";
import { undoMergeAction } from "@/app/app/[orgSlug]/crm/people-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { crmBase } from "@/lib/crm/href";

import { CrmPicker } from "./crm-picker";

/**
 * A record's own actions, as buttons: merge a duplicate into it, its field
 * history (and putting it back to any point in it), and the trash (with
 * Undo). Restoring a trashed one is one click too.
 *
 * `menu` draws them as one round "…" instead (a CRM card's header), and
 * `onTrashed` replaces going back to the list once it's in the trash.
 */

export interface HistoryItem {
  id: string;
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
  by: string | null;
  source: string;
  changedAt: string;
}

export function RecordActions({
  orgId,
  orgSlug,
  kind,
  id,
  name,
  deleted,
  history,
  canMerge = true,
  canTrash = true,
  menu = false,
  onTrashed,
}: {
  orgId: string;
  orgSlug: string;
  kind: "person" | "company" | "deal";
  id: string;
  name: string;
  deleted: boolean;
  history: HistoryItem[];
  canMerge?: boolean;
  canTrash?: boolean;
  menu?: boolean;
  onTrashed?: () => void;
}) {
  const router = useRouter();
  const [merging, setMerging] = useState(false);
  const [dup, setDup] = useState<{ id: string; label: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const list = kind === "person" ? "people" : kind === "company" ? "companies" : null;

  if (deleted) {
    return (
      <Button
        variant="outline"
        onClick={async () => {
          const r = await restoreAction(orgId, kind, [id]).catch(() => null);
          if (!r || !r.ok) toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
          else toast({ title: "Restored." });
          router.refresh();
        }}
      >
        <Undo2 className="size-4" aria-hidden="true" />
        Restore
      </Button>
    );
  }

  const trash = async () => {
    const r = await trashAction(orgId, kind, [id]).catch(() => null);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
      return;
    }
    toast({
      title: `${name} is in the trash.`,
      action: {
        label: "Undo",
        run: async () => {
          const u = await undoAction(orgId, r.batchId).catch(() => null);
          router.refresh();
          return u && !u.ok ? u.error : undefined;
        },
      },
    });
    if (onTrashed) onTrashed();
    else router.push(list ? `${crmBase(orgSlug)}/${list}` : crmBase(orgSlug));
  };

  return (
    <>
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" title="History, merge, trash" aria-label="More: history, merge, trash">
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => setShowHistory(true)}>
              <History className="size-4" aria-hidden="true" />
              History
            </DropdownMenuItem>
            {canMerge && kind !== "deal" && (
              <DropdownMenuItem onSelect={() => setMerging(true)}>
                <Merge className="size-4" aria-hidden="true" />
                Merge a duplicate
              </DropdownMenuItem>
            )}
            {canTrash && (
              <DropdownMenuItem variant="destructive" onSelect={() => void trash()}>
                <Trash2 className="size-4" aria-hidden="true" />
                Move to the trash
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <Button variant="outline" size="icon" title="History" aria-label="History" onClick={() => setShowHistory(true)}>
            <History className="size-4" aria-hidden="true" />
          </Button>
          {canMerge && kind !== "deal" && (
            <Button variant="outline" size="icon" title="Merge a duplicate into this one" aria-label="Merge a duplicate" onClick={() => setMerging(true)}>
              <Merge className="size-4" aria-hidden="true" />
            </Button>
          )}
          {canTrash && (
            <Button
              variant="outline"
              size="icon"
              title="Move to the trash"
              aria-label="Move to the trash"
              onClick={trash}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          )}
        </>
      )}

      {merging && (
        <Dialog open onOpenChange={(o) => !o && setMerging(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Merge a duplicate into {name}</DialogTitle>
              <DialogDescription>
                Its addresses, items, timeline, history and links move here, empty fields are filled from it, and it goes to the trash.
              </DialogDescription>
            </DialogHeader>
            <CrmPicker
              orgId={orgId}
              kind={kind === "person" ? "person" : "company"}
              value={dup?.id ?? null}
              display={dup?.label}
              placeholder={kind === "person" ? "Pick the duplicate" : "Pick the duplicate company"}
              onPick={(h) => setDup(h && h.id !== id ? { id: h.id, label: h.label } : null)}
              autoOpen
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setMerging(false)}>
                Cancel
              </Button>
              <Button
                disabled={!dup}
                onClick={async () => {
                  if (!dup) return;
                  const r = await mergeAction(orgId, kind === "person" ? "person" : "company", id, dup.id).catch(() => null);
                  if (!r || !r.ok) {
                    toast({ title: r && !r.ok ? r.error : "That didn't merge.", tone: "error" });
                    return;
                  }
                  const undoId = r.undoId;
                  toast({
                    title: r.conflicts
                      ? `Merged. ${r.conflicts} values differed; this one's were kept and the others are in its history.`
                      : `Merged ${dup.label} into ${name}.`,
                    action: {
                      label: "Undo",
                      run: async () => {
                        const u = await undoMergeAction(orgId, undoId).catch(() => null);
                        if (u?.ok) router.refresh();
                        return u && !u.ok ? u.error : u ? undefined : "That didn't undo. Try again.";
                      },
                    },
                  });
                  setMerging(false);
                  router.refresh();
                }}
              >
                Merge
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Sheet open={showHistory} onOpenChange={setShowHistory}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetTitle className="px-5 pt-5">History</SheetTitle>
          <ol className="space-y-1 p-5">
            {history.length === 0 && <li className="text-muted-foreground text-sm">No changes yet.</li>}
            {history.map((h) => (
              <li key={h.id} className="border-border flex gap-3 border-b py-2.5 text-sm last:border-0">
                <div className="min-w-0 flex-1">
                  <b>{h.label}</b>
                  <p className="text-muted-foreground break-words">
                    {h.oldValue || "Empty"} to {h.newValue || "Empty"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(h.changedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {h.by ? `, ${h.by}` : h.source !== "user" ? `, ${h.source}` : ""}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Put it back to how it was before this"
                  aria-label="Put it back to before this change"
                  onClick={async () => {
                    const before = new Date(new Date(h.changedAt).getTime() - 1).toISOString();
                    const r = await restoreToPointAction(orgId, kind, id, before).catch(() => null);
                    if (!r || !r.ok) {
                      toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
                      return;
                    }
                    toast({
                      title: r.fields ? `Put back ${r.fields} fields.` : "Nothing to put back.",
                      action: r.fields
                        ? {
                            label: "Undo",
                            run: async () => {
                              const u = await undoAction(orgId, r.batchId).catch(() => null);
                              router.refresh();
                              return u && !u.ok ? u.error : undefined;
                            },
                          }
                        : undefined,
                    });
                    router.refresh();
                  }}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ol>
        </SheetContent>
      </Sheet>
    </>
  );
}
