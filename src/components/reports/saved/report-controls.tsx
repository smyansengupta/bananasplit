"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import {
  archiveReportAction,
  askClaudeAction,
  deleteReportAction,
  restoreReportAction,
  saveScheduleAction,
  saveWidgetConfigAction,
  takeSnapshotAction,
  updateReportAction,
} from "@/app/app/[orgSlug]/databases/reports/report-actions";
import { WidgetBoard, type SaveBoard } from "@/components/boards/widget-board";
import {
  Archive,
  CalendarClock,
  Camera,
  Ellipsis,
  Pencil,
  Settings,
  Share2,
  Trash2,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toaster";
import type { BoardWidget, WidgetMeta } from "@/lib/boards";
import type { ReportWidget, SourceSummary, WidgetConfig } from "@/lib/reports/catalog";
import { DEFAULT_SCHEDULE, describeSchedule, type ReportSchedule } from "@/lib/reports/schedule";

import { ScheduleFields } from "./report-options";
import { ShareDialog } from "./share-fields";
import { WidgetSettings } from "./widget-settings";

function useRange(): { range?: string; from?: string; to?: string } {
  const sp = useSearchParams();
  return {
    ...(sp.get("range") ? { range: sp.get("range")! } : {}),
    ...(sp.get("from") ? { from: sp.get("from")! } : {}),
    ...(sp.get("to") ? { to: sp.get("to")! } : {}),
  };
}

/** A widget's gear: its settings in a popover, saved with Save. */
export function WidgetSettingsButton({
  orgId,
  reportId,
  widget,
  source,
  title,
}: {
  orgId: string;
  reportId: string;
  widget: ReportWidget;
  source: SourceSummary;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<WidgetConfig>(widget.config);
  const [pending, start] = useTransition();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setConfig(widget.config);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground ms-auto"
          aria-label={`${title} settings`}
          title="Settings"
        >
          <Settings className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(30rem,calc(100vw-2rem))] space-y-4 p-4">
        <p className="text-sm font-semibold">{title}</p>
        <WidgetSettings widget={{ ...widget, config }} source={source} onChange={setConfig} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await saveWidgetConfigAction(orgId, reportId, widget.id, config);
                if (!result.ok) {
                  toast({ title: result.error });
                  return;
                }
                setOpen(false);
              })
            }
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Insights' Ask Claude (Rewrite once it has): Claude reads the report and its reading is kept on it. */
export function AskClaudeButton({
  orgId,
  reportId,
  again,
}: {
  orgId: string;
  reportId: string;
  again: boolean;
}) {
  const range = useRange();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await askClaudeAction(orgId, reportId, range);
          if (!result.ok) toast({ title: result.error });
        })
      }
    >
      {pending ? "Writing…" : again ? "Rewrite" : "Ask Claude"}
    </Button>
  );
}

/**
 * The report's header controls: keep a copy, and (for its editors) share it
 * in the organization and outside it, schedule, rename, archive or delete.
 */
export function ReportHeaderControls({
  orgId,
  orgSlug,
  reportId,
  title,
  access,
  canEdit,
  isOwner,
  schedule,
  linkOn = false,
}: {
  orgId: string;
  orgSlug: string;
  reportId: string;
  title: string;
  access: "ORGANIZATION" | "PRIVATE";
  canEdit: boolean;
  isOwner: boolean;
  schedule: ReportSchedule | null;
  /** Anyone with its link can view it. */
  linkOn?: boolean;
}) {
  const router = useRouter();
  const [confirmEl, confirm] = useConfirm();
  const [sharing, setSharing] = useState(false);
  const range = useRange();
  const [pending, start] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [draft, setDraft] = useState<ReportSchedule | null>(schedule);
  const [name, setName] = useState(title);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const result = await fn();
      if (!result.ok) toast({ title: result.error ?? "That didn't work. Try again." });
      else if (done) toast({ title: done });
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon" variant="outline" aria-label="More report actions">
            <Ellipsis className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem
            disabled={pending}
            onSelect={() =>
              run(
                () => takeSnapshotAction(orgId, reportId, range),
                "Saved a copy. It's at the bottom of this report.",
              )
            }
          >
            <Camera aria-hidden="true" />
            Save a copy
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuItem onSelect={() => setSharing(true)}>
                <Share2 aria-hidden="true" />
                {linkOn ? "Sharing" : "Share"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setDraft(schedule ?? DEFAULT_SCHEDULE);
                  setScheduling(true);
                }}
              >
                <CalendarClock aria-hidden="true" />
                {schedule ? "Change the schedule" : "Send on a schedule"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil aria-hidden="true" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  start(async () => {
                    const result = await archiveReportAction(orgId, reportId);
                    if (!result.ok) {
                      toast({ title: result.error });
                      return;
                    }
                    toast({
                      title: `Archived ${title}`,
                      action: {
                        label: "Undo",
                        run: async () => {
                          const back = await restoreReportAction(orgId, reportId);
                          if (!back.ok) return back.error;
                          router.push(`/app/${orgSlug}/databases/reports/${reportId}`);
                        },
                      },
                    });
                    router.push(`/app/${orgSlug}/databases/reports`);
                  })
                }
              >
                <Archive aria-hidden="true" />
                Archive
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  void confirm({
                    title: `Delete ${title}?`,
                    description:
                      "It's gone for good, with its saved copies and its sharing. This can't be undone. Archive it instead to keep it.",
                    run: async () => {
                      const result = await deleteReportAction(orgId, reportId);
                      if (!result.ok) return result.error;
                      toast({ title: "Deleted" });
                      router.push(`/app/${orgSlug}/databases/reports`);
                    },
                  })
                }
              >
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmEl}
      {canEdit && (
        <ShareDialog
          orgId={orgId}
          reportId={reportId}
          access={access}
          isOwner={isOwner}
          open={sharing}
          onOpenChange={setSharing}
        />
      )}
      <Dialog open={scheduling} onOpenChange={setScheduling}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Send on a schedule</DialogTitle>
            <DialogDescription>
              Each person gets the report as they see it, and a copy is kept at the bottom of the
              report.
            </DialogDescription>
          </DialogHeader>
          <ScheduleFields schedule={draft} onChange={setDraft} shared={access === "ORGANIZATION"} />
          <DialogFooter>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await saveScheduleAction(orgId, reportId, draft);
                  if (!result.ok) {
                    toast({ title: result.error });
                    return;
                  }
                  setScheduling(false);
                  toast({ title: draft ? describeSchedule(draft) : "It won't send on a schedule" });
                })
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename report</DialogTitle>
            <DialogDescription className="sr-only">A new name for this report.</DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            aria-label="Name"
          />
          <DialogFooter>
            <Button
              type="button"
              disabled={pending || !name.trim()}
              onClick={() =>
                start(async () => {
                  const result = await updateReportAction(orgId, reportId, { title: name });
                  if (!result.ok) {
                    toast({ title: result.error });
                    return;
                  }
                  setRenaming(false);
                })
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A board shown, not arranged (a past report, or a report someone else made). */
export function StaticBoard({
  types,
  layout,
  titles,
  bodies,
  intro,
}: {
  types: WidgetMeta[];
  layout: BoardWidget[];
  titles: Record<string, string>;
  bodies: Record<string, ReactNode>;
  intro?: ReactNode;
}) {
  const noSave: SaveBoard = async () => ({ ok: true });
  return (
    <WidgetBoard
      types={types}
      initialLayout={layout}
      customized={false}
      titles={titles}
      bodies={bodies}
      onSave={noSave}
      readOnly
      refreshOnSave={false}
      intro={intro}
    />
  );
}
