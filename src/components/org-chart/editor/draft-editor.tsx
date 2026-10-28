"use client";

import type { NamedTeam } from "@/lib/org-chart/teams";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CheckCheck, CircleAlert, ListTree, Plus, Trash2, Type, Undo2 } from "@/components/icons";

import {
  discardDraftAction,
  publishDraftAction,
  saveDraftAction,
} from "@/app/app/[orgSlug]/org-chart/actions";
import { setMemberTitle } from "@/app/app/[orgSlug]/settings/members/actions";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  addPosition,
  confirmAllExact,
  exactMatches,
  moveDraft,
  moveSibling,
  removePosition,
  setManager,
  toValidationNodes,
  type DraftPosition,
  type DropZone,
} from "@/lib/org-chart/draft";
import type { ChartNodeDTO, ChartWarning, OpenItem } from "@/lib/org-chart/types";
import { hasErrors, validateChart, type ValidationIssue } from "@/lib/org-chart/validate";

import type { EditorMember } from "./member-picker";
import { OutlineEditor } from "./outline-editor";
import { flattenOutline, OutlineTree } from "./outline-tree";
import { TeamsEditor } from "./teams-editor";
import { TitleSync } from "./title-sync";
import { PositionEditor } from "./position-editor";

const ChartCanvas = dynamic(() => import("../chart-canvas"), {
  ssr: false,
  loading: () => <p className="text-muted-foreground p-4 text-sm">Loading the preview…</p>,
});

/**
 * The draft editor (any member). Parsing is never trusted blindly: every
 * position can be renamed, re-linked, moved (drag and drop in the outline,
 * or the Reports to picker and move buttons), toggled advisor or open hire,
 * and its bullets edited, with a live checklist and a read-only preview of
 * the chart. Saves use optimistic concurrency (editVersion); publishing
 * saves first, then validates again on the server.
 */

export interface DraftEditorProps {
  orgId: string;
  orgSlug: string;
  version: {
    id: string;
    number: number;
    source: string;
    sourceFilename: string | null;
    editVersion: number;
    warnings: ChartWarning[];
    openItems: OpenItem[];
    /** The teams this draft names. */
    teams: NamedTeam[];
  };
  positions: DraftPosition[];
  members: EditorMember[];
  /** OWNER/ADMIN may invite (the "invite" link on unknown names). */
  canInvite?: boolean;
  /**
   * May set members' titles (members.setTitle, OWNER/ADMIN): title sync, and
   * the "set each linked member's title" option on publish.
   */
  canSetTitles?: boolean;
}

/** Autosave this long after the last change. */
export const AUTOSAVE_MS = 1500;
const HISTORY_LIMIT = 50;

export function DraftEditor({
  orgId,
  orgSlug,
  version,
  positions: initial,
  members: initialMembers,
  canInvite = false,
  canSetTitles = false,
}: DraftEditorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [positions, setPositions] = useState<DraftPosition[]>(initial);
  const [openItems, setOpenItems] = useState<OpenItem[]>(version.openItems);
  const [teams, setTeams] = useState<NamedTeam[]>(version.teams);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();
  const [publishOpen, setPublishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [setTitles, setSetTitles] = useState(false);
  const [tab, setTab] = useState("outline");
  const [mode, setMode] = useState<"type" | "positions">(searchParams.get("mode") === "positions" ? "positions" : "type");
  const [outlineKey, setOutlineKey] = useState(0);
  const [members, setMembers] = useState<EditorMember[]>(initialMembers);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const history = useRef<DraftPosition[][]>([]);
  const [historySize, setHistorySize] = useState(0);
  const lastPush = useRef(0);
  const changes = useRef(0);
  const editVersionRef = useRef(version.editVersion);
  const inFlight = useRef(false);

  const initialSelected = (() => {
    const key = searchParams.get("position");
    return (key && initial.find((p) => p.key === key)?.id) || flattenOutline(initial)[0]?.position.id || null;
  })();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected);

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const issues = useMemo(() => validateChart(toValidationNodes(positions)), [positions]);
  const issuesById = useMemo(() => {
    const map = new Map<string, "error" | "warning">();
    for (const issue of issues) {
      if (!issue.positionId) continue;
      if (issue.level === "error" || !map.has(issue.positionId)) map.set(issue.positionId, issue.level);
    }
    return map;
  }, [issues]);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const exact = exactMatches(positions);
  const selected = positions.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Keeps `current` for Undo; a burst of typing keeps one step per pause. */
  function remember(current: DraftPosition[], force: boolean) {
    const now = Date.now();
    if (!force && now - lastPush.current < 800) return;
    lastPush.current = now;
    history.current = [...history.current.slice(-(HISTORY_LIMIT - 1)), current];
    setHistorySize(history.current.length);
  }

  const onTyped = useCallback((next: DraftPosition[]) => {
    remember(positions, false);
    setPositions(next);
    changes.current += 1;
    setDirty(true);
    setStatus(null);
     
  }, [positions]);

  const undo = useCallback(() => {
    const previous = history.current.pop();
    setHistorySize(history.current.length);
    if (!previous) return;
    setPositions(previous);
    changes.current += 1;
    setDirty(true);
    setOutlineKey((k) => k + 1);
  }, []);

  // Cmd/Ctrl+Z outside text fields undoes the last chart change (fields keep their own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const update = useCallback((next: DraftPosition[] | null, message?: string) => {
    if (!next) {
      if (message) setStatus({ tone: "error", text: message });
      return;
    }
    remember(positions, true);
    setPositions(next);
    changes.current += 1;
    setDirty(true);
    setStatus(null);
     
  }, [positions]);

  const onMove = useCallback(
    (dragId: string, targetId: string, zone: DropZone) =>
      update(moveDraft(positions, dragId, targetId, zone), "That move would create a loop."),
    [positions, update],
  );

  async function save(): Promise<number | null> {
    const payload = {
      versionId: version.id,
      editVersion: editVersionRef.current,
      openItems: openItems.filter((o) => o.question.trim()),
      teams,
      positions: positions.map((p) => ({
        id: p.id,
        title: p.title,
        personName: p.personName,
        userId: p.userId,
        matchState: p.matchState,
        matchScore: p.matchScore,
        suggestedUserIds: p.suggestedUserIds,
        reportsTo: p.reportsTo,
        isOpen: p.isOpen,
        isAdvisor: p.isAdvisor,
        responsibilities: p.responsibilities.filter((b) => b.trim()),
        decidesAlone: p.decidesAlone.filter((b) => b.trim()),
        rank: p.rank,
        teamId: p.teamId ?? null,
      })),
    };
    const mark = changes.current;
    inFlight.current = true;
    setSaving(true);
    let result: Awaited<ReturnType<typeof saveDraftAction>>;
    try {
      result = await saveDraftAction(orgId, payload);
    } catch {
      setSaveError(true);
      return null;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
    if (!result.ok) {
      setStatus({ tone: "error", text: result.error });
      setSaveError(true);
      if ("conflict" in result && result.conflict) setConflict(true);
      return null;
    }
    setSaveError(false);
    const ids = "ids" in result ? result.ids : {};
    const remap = (id: string | null) => (id && ids[id] ? ids[id] : id);
    setPositions((current) => current.map((p) => ({ ...p, id: remap(p.id) as string, reportsTo: remap(p.reportsTo) })));
    setSelectedId((id) => remap(id));
    editVersionRef.current = result.editVersion;
    history.current = history.current.map((snap) =>
      snap.map((p) => ({ ...p, id: remap(p.id) as string, reportsTo: remap(p.reportsTo) })),
    );
    // Still unsaved if something changed while the save was on its way.
    if (changes.current === mark) setDirty(false);
    return result.editVersion;
  }

  const onSave = () =>
    startTransition(async () => {
      if ((await save()) !== null) setStatus(null);
    });

  // Drafts save themselves a moment after the last change (one save at a time).
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (!dirty || conflict || saveError) return;
    const id = window.setTimeout(() => {
      if (!inFlight.current) void saveRef.current();
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(id);
  }, [dirty, conflict, saveError, positions, openItems, saving]);

  async function settled() {
    for (let i = 0; i < 100 && inFlight.current; i++) await new Promise((r) => setTimeout(r, 100));
  }

  const onPublish = () =>
    startTransition(async () => {
      await settled();
      const current = dirty ? await save() : editVersionRef.current;
      if (current === null) return;
      const result = await publishDraftAction(orgId, version.id, {
        setTitles: canSetTitles && setTitles,
        expectedEditVersion: current,
      });
      if (!result.ok) {
        const detail = "issues" in result && result.issues?.length ? ` ${result.issues.map((i) => i.message).join(" ")}` : "";
        setStatus({ tone: "error", text: `${result.error}${detail}` });
        setPublishOpen(false);
        return;
      }
      setPublishOpen(false);
      router.push(`/app/${orgSlug}/org-chart`);
      router.refresh();
    });

  const onDiscard = () =>
    startTransition(async () => {
      const result = await discardDraftAction(orgId, version.id);
      if (!result.ok) {
        setStatus({ tone: "error", text: "error" in result ? result.error : "The draft could not be discarded." });
        return;
      }
      setDirty(false);
      router.push(`/app/${orgSlug}/org-chart/versions`);
      router.refresh();
    });

  const previewNodes: ChartNodeDTO[] = useMemo(
    () =>
      positions.map((p) => {
        const m = p.userId ? membersById.get(p.userId) : undefined;
        return {
          id: p.id,
          key: p.key || p.id,
          title: p.title || "Untitled position",
          personName: p.personName,
          userId: p.userId,
          user: m ? { id: m.id, name: m.name, image: m.image, avatar: m.avatar } : null,
          reportsToId: p.reportsTo,
          isOpen: p.isOpen,
          isAdvisor: p.isAdvisor,
          responsibilities: p.responsibilities,
          decidesAlone: p.decidesAlone,
          rank: p.rank,
          teamId: p.teamId ?? null,
        };
      }),
    [positions, membersById],
  );

  return (
    <div className="space-y-4">
      <div className="bg-background/95 sticky top-[var(--shell-top,3.5rem)] z-30 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="font-medium">Draft v{version.number}</span>
          <Badge variant="outline">{sourceLabel(version.source)}</Badge>
          <span className="text-muted-foreground" role="status" aria-live="polite">
            {saving
              ? "Saving…"
              : saveError
                ? "Couldn't save"
                : pending
                  ? "Working…"
                  : dirty
                    ? "Unsaved changes"
                    : "All changes saved"}
          </span>
          {saveError && !conflict && (
            <Button type="button" variant="link" size="sm" onClick={() => setSaveError(false)}>
              Retry
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={undo}
            disabled={historySize === 0}
            title="Undo the last change (⌘Z outside a text field)"
          >
            <Undo2 aria-hidden="true" />
            Undo
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDiscardOpen(true)} disabled={pending}>
            <Trash2 className="size-4" aria-hidden="true" />
            Discard
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onSave} disabled={pending || saving || !dirty || conflict}>
            Save now
          </Button>
          <Button type="button" size="sm" onClick={() => setPublishOpen(true)} disabled={pending || conflict}>
            Review and publish
          </Button>
        </div>
      </div>

      {status && (
        <p
          role={status.tone === "error" ? "alert" : "status"}
          className={
            status.tone === "error"
              ? "border-destructive/40 bg-destructive/10 rounded-md border px-3 py-2 text-sm"
              : "bg-muted rounded-md px-3 py-2 text-sm"
          }
        >
          {status.text}
          {conflict && (
            <Button type="button" variant="link" size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
        </p>
      )}

      <Checklist
        errors={errors}
        warnings={warnings}
        parseWarnings={version.warnings}
        onSelect={(id) => {
          setSelectedId(id);
          setTab("outline");
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Editor"
          value={mode}
          onSelect={(v) => {
            setMode(v as "type" | "positions");
            setOutlineKey((k) => k + 1);
          }}
          options={[
            { value: "type", label: "Type it", icon: Type },
            { value: "positions", label: "Edit positions", icon: ListTree },
          ]}
        />
        <p className="text-muted-foreground text-[13px]">
          {mode === "type"
            ? "Write the chart as an outline. Responsibilities and decisions live in Edit positions."
            : "Move, link and describe each position."}
        </p>
      </div>

      {mode === "type" ? (
        <OutlineEditor
          key={outlineKey}
          positions={positions}
          members={members}
          onChange={onTyped}
          previewNodes={previewNodes}
          teams={teams}
          selectedId={selectedId}
          onSelect={setSelectedId}
          orgSlug={orgSlug}
          canInvite={canInvite}
        />
      ) : (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section aria-label="Chart structure" className="bg-card min-w-0 rounded-xl border p-3">
          <Tabs value={tab} onValueChange={setTab}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="outline">Outline</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <div className="flex flex-wrap gap-2">
                {exact.length > 0 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => update(confirmAllExact(positions, names))}>
                    <CheckCheck className="size-4" aria-hidden="true" />
                    Confirm all exact ({exact.length})
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const next = addPosition(positions, null);
                    update(next);
                    setSelectedId(next[next.length - 1].id);
                  }}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add position
                </Button>
              </div>
            </div>
            <TabsContent value="outline" className="mt-3">
              {positions.length === 0 ? (
                <p className="text-muted-foreground p-6 text-center text-sm">
                  No positions yet. Add the top position first, then add its reports.
                </p>
              ) : (
                <OutlineTree
                  positions={positions}
                  members={membersById}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onMove={onMove}
                  issuesById={issuesById}
                />
              )}
            </TabsContent>
            <TabsContent value="preview" className="mt-3">
              <div className="h-[520px] overflow-hidden rounded-lg border">
                {tab === "preview" && (
                  <ChartCanvas
                    nodes={previewNodes}
                    teams={teams}
                    selectedId={selectedId}
                    onSelect={(id) => {
                      setSelectedId(id);
                    }}
                    refitOnChange
                    ariaLabel="Preview of the draft chart"
                  />
                )}
              </div>
            </TabsContent>
          </Tabs>
        </section>

        <section aria-label="Selected position" className="bg-card min-w-0 rounded-xl border p-4">
          {selected ? (
            <PositionEditor
              key={selected.id}
              position={selected}
              positions={positions}
              members={members}
              issues={issues.filter((i) => i.positionId === selected.id)}
              onChange={(next) => update(positions.map((p) => (p.id === next.id ? next : p)))}
              onSetManager={(managerId) =>
                update(setManager(positions, selected.id, managerId), "That would make the chart loop back on itself.")
              }
              onMove={(direction) => update(moveSibling(positions, selected.id, direction))}
              onAddReport={() => {
                const next = addPosition(positions, selected.id);
                update(next);
                setSelectedId(next[next.length - 1].id);
              }}
              onRemove={() => {
                update(removePosition(positions, selected.id));
                setSelectedId(selected.reportsTo ?? positions.find((p) => p.id !== selected.id)?.id ?? null);
              }}
            />
          ) : (
            <p className="text-muted-foreground text-sm">Select a position in the outline to edit it.</p>
          )}
        </section>
      </div>

      )}

      <TeamsEditor
        teams={teams}
        positions={positions}
        members={members}
        onTeams={(next) => {
          setTeams(next);
          changes.current += 1;
          setDirty(true);
        }}
        onAssign={(positionId, teamId) =>
          update(positions.map((p) => (p.id === positionId ? { ...p, teamId } : p)))
        }
      />

      <TitleSync
        positions={positions}
        members={members}
        canSetTitles={canSetTitles}
        onUseMemberTitle={(positionId, title) => {
          update(positions.map((p) => (p.id === positionId ? { ...p, title } : p)));
          setOutlineKey((k) => k + 1);
        }}
        onSetMemberTitle={async (userId, title) => {
          const result = await setMemberTitle(orgId, userId, title);
          if (result && "error" in result && result.error) {
            toast({ title: result.error, tone: "error" });
            return;
          }
          setMembers((list) => list.map((m) => (m.id === userId ? { ...m, title } : m)));
          toast({ title: `Updated: ${membersById.get(userId)?.name ?? "the member"}'s title`, tone: "success" });
        }}
      />

      <OpenItemsEditor
        items={openItems}
        onChange={(items) => {
          setOpenItems(items);
          changes.current += 1;
          setDirty(true);
        }}
      />

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish draft v{version.number}?</DialogTitle>
            <DialogDescription>
              Everyone in the workspace will see this chart. The current chart is kept in the version history and can be
              restored.
            </DialogDescription>
          </DialogHeader>
          {errors.length > 0 ? (
            <div role="alert" className="space-y-1 text-sm">
              <p className="font-medium">Fix {errors.length === 1 ? "this problem" : `these ${errors.length} problems`} first:</p>
              <ul className="list-disc pl-5">
                {errors.slice(0, 6).map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p>
                {positions.length} positions, {positions.filter((p) => p.userId).length} linked to members
                {warnings.length > 0 ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}.
              </p>
              {warnings.length > 0 && (
                <ul className="text-muted-foreground list-disc pl-5">
                  {warnings.slice(0, 5).map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              )}
              {canSetTitles && (
                <div className="flex items-start gap-2">
                  <Checkbox id="set-titles" checked={setTitles} onCheckedChange={(v) => setSetTitles(v === true)} />
                  <Label htmlFor="set-titles" className="leading-snug font-normal">
                    Also set each linked member&apos;s title in this workspace from their position
                  </Label>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" onClick={onPublish} disabled={pending || hasErrors(issues)}>
              {pending ? "Publishing…" : dirty ? "Save and publish" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard draft v{version.number}?</DialogTitle>
            <DialogDescription>
              The published chart does not change. The discarded draft stays in the version history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Keep editing
              </Button>
            </DialogClose>
            <Button type="button" variant="destructive" onClick={onDiscard} disabled={pending}>
              Discard draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "UPLOAD":
      return "Imported";
    case "ROLLBACK":
      return "Restored";
    case "SEED":
      return "Seed";
    default:
      return "Manual";
  }
}

function Checklist({
  errors,
  warnings,
  parseWarnings,
  onSelect,
}: {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  parseWarnings: ChartWarning[];
  onSelect: (id: string) => void;
}) {
  if (errors.length === 0 && warnings.length === 0 && parseWarnings.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <CheckCheck className="text-success size-4" aria-hidden="true" />
        No problems found. Review the positions, then publish.
      </p>
    );
  }
  const item = (issue: ValidationIssue, i: number) => (
    <li key={`${issue.code}-${i}`}>
      {issue.positionId ? (
        <button
          type="button"
          onClick={() => onSelect(issue.positionId as string)}
          className="text-left underline-offset-4 hover:underline"
        >
          {issue.message}
        </button>
      ) : (
        issue.message
      )}
    </li>
  );
  return (
    <section aria-label="Checklist" className="space-y-3 rounded-xl border p-3">
      {errors.length > 0 && (
        <div className="space-y-1">
          <p className="text-destructive flex items-center gap-1.5 text-sm font-medium">
            <CircleAlert className="size-4" aria-hidden="true" />
            {errors.length} problem{errors.length === 1 ? "" : "s"} to fix before publishing
          </p>
          <ul className="list-disc space-y-0.5 pl-6 text-sm">{errors.map(item)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {warnings.length} thing{warnings.length === 1 ? "" : "s"} to check
          </p>
          <ul className="text-muted-foreground list-disc space-y-0.5 pl-6 text-sm">{warnings.map(item)}</ul>
        </div>
      )}
      {parseWarnings.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            {parseWarnings.length} note{parseWarnings.length === 1 ? "" : "s"} from reading the document
          </summary>
          <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-6">
            {parseWarnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function OpenItemsEditor({ items, onChange }: { items: OpenItem[]; onChange: (items: OpenItem[]) => void }) {
  return (
    <section aria-label="Open items" className="space-y-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Open items</h2>
          <p className="text-muted-foreground text-xs">Questions the document leaves open, with who should answer.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, { who: "", question: "" }])}
          disabled={items.length >= 50}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">None.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
              <Input
                value={item.who}
                maxLength={120}
                placeholder="Who"
                aria-label={`Open item ${i + 1}: who`}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, who: e.target.value } : x)))}
              />
              <Input
                value={item.question}
                maxLength={500}
                placeholder="Question"
                aria-label={`Open item ${i + 1}: question`}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={`Remove open item ${i + 1}`}
              >
                Resolve
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
