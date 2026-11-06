"use client";

import { History, Merge, MoreHorizontal, RotateCcw, Trash2, Undo2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  restoreAction,
  restoreToPointAction,
  trashAction,
  undoAction,
} from "@/app/app/[orgSlug]/crm/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { crmBase } from "@/lib/crm/href";

import { CardPanel, useCardPanel } from "./card/card-panel";
import { useCrmOpen } from "./card/use-crm-open";

/**
 * A record's own actions, as buttons: merge a duplicate into it (the Merge
 * card, ?open=merge:<id>, which asks for the other one), its field history
 * (a panel over the card it's in, with putting it back to any point in
 * it), and the trash (with Undo). Restoring a trashed one is one click too.
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
  menuItems,
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
  /** More items at the top of the "…" menu (a person's Add to a follow-up series). */
  menuItems?: ReactNode;
  onTrashed?: () => void;
}) {
  const router = useRouter();
  const { setOpen } = useCrmOpen();
  // Where History is open: over the card this sits in, never beside it.
  const {
    anchor: panelAnchor,
    host: panelHost,
    back: panelBack,
    show: panelShow,
    hide: panelHide,
  } = useCardPanel();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const showHistory = () => panelShow(trigger);
  const merge = () => {
    if (kind !== "deal") setOpen({ kind: "merge", ids: [id] });
  };
  const list = kind === "person" ? "people" : kind === "company" ? "companies" : null;

  if (deleted) {
    return (
      <Button
        variant="outline"
        onClick={async () => {
          const r = await restoreAction(orgId, kind, [id]).catch(() => null);
          if (!r || !r.ok)
            toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
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
      <span ref={panelAnchor} hidden />
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={setTrigger}
              variant="outline"
              size="icon"
              title="History, merge, trash"
              aria-label="More: history, merge, trash"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {menuItems}
            <DropdownMenuItem onSelect={showHistory}>
              <History className="size-4" aria-hidden="true" />
              History
            </DropdownMenuItem>
            {canMerge && kind !== "deal" && (
              <DropdownMenuItem onSelect={merge}>
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
          <Button
            ref={setTrigger}
            variant="outline"
            size="icon"
            title="History"
            aria-label="History"
            onClick={showHistory}
          >
            <History className="size-4" aria-hidden="true" />
          </Button>
          {canMerge && kind !== "deal" && (
            <Button
              variant="outline"
              size="icon"
              title="Merge a duplicate into this one"
              aria-label="Merge a duplicate"
              onClick={merge}
            >
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

      {panelHost && (
        <CardPanel
          host={panelHost}
          title="History"
          subtitle={`Every change to ${name}. Put it back to before any of them.`}
          label={`History of ${name}`}
          onClose={panelHide}
          returnFocus={panelBack}
        >
          <ol className="space-y-1 px-6 py-4 max-sm:px-4">
            {history.length === 0 && (
              <li className="text-muted-foreground text-sm">No changes yet.</li>
            )}
            {history.map((h) => (
              <li
                key={h.id}
                className="border-border flex gap-3 border-b py-2.5 text-sm last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <b>{h.label}</b>
                  <p className="text-muted-foreground break-words">
                    {h.oldValue || "Empty"} to {h.newValue || "Empty"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(h.changedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
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
        </CardPanel>
      )}
    </>
  );
}
