"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { discardDraftAction, saveDraftAction } from "@/app/app/[orgSlug]/org-chart/actions";
import { InviteDialog } from "@/app/app/[orgSlug]/settings/members/invite-dialog";
import { AmbientButton } from "@/components/ambient/ambient-button";
import { BackLink } from "@/components/back-link";
import {
  ArrowLeft,
  CircleAlert,
  FileUp,
  History,
  Plus,
  Undo2,
  UserPlus,
  UsersRound,
} from "@/components/icons";
import { ItemMenu } from "@/components/item-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import {
  addAlsoReportsTo,
  addBeside,
  addPosition,
  moveDraft,
  removeAlsoReportsTo,
  removePosition,
  setManager,
  toValidationNodes,
  type DraftPosition,
} from "@/lib/org-chart/draft";
import { membersOffChart, outlineOrder } from "@/lib/org-chart/outline";
import type { NamedTeam } from "@/lib/org-chart/teams";
import {
  nodeVariant,
  type ChartNodeDTO,
  type ChartWarning,
  type OpenItem,
} from "@/lib/org-chart/types";
import { validateChart } from "@/lib/org-chart/validate";
import { cn } from "@/lib/utils";

import { useMediaQuery } from "../use-media-query";
import type { EditorMember } from "./member-picker";
import { OutlineEditor } from "./outline-editor";
import { PositionFields } from "./position-fields";
import { TeamsEditor } from "./teams-editor";

const ChartCanvas = dynamic(() => import("../chart-canvas"), {
  ssr: false,
  loading: () => <p className="text-muted-foreground p-4 text-sm">Loading the chart…</p>,
});

/**
 * The org chart editor, for changes after setup (Moonstone "the chart is
 * the editor"). Two tabs on one draft: Chart, where you click a position
 * to edit it in the side panel, drag it onto another to change who it
 * reports to, and add under or beside the selected one; and Type it, the
 * outline. On a phone the chart is an indented list and a position opens
 * in a bottom sheet. An open role on the chart offers Invite someone.
 *
 * The header says the draft saves itself ("Saved just now"), with Undo,
 * Discard and Review and publish (the review page publishes). Saves use
 * optimistic concurrency (editVersion); teams and open questions live in
 * the "…" menu.
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
  /** OWNER/ADMIN may invite (Invite someone on an open role). */
  canInvite?: boolean;
  /** Under the header: what the import read, for an imported draft. */
  notice?: ReactNode;
}

/** Autosave this long after the last change. */
export const AUTOSAVE_MS = 1500;
const HISTORY_LIMIT = 50;

/** A team id like the Teams dialog makes. */
function newTeamId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function DraftEditor({
  orgId,
  orgSlug,
  version,
  positions: initial,
  members,
  canInvite = false,
  notice,
}: DraftEditorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [positions, setPositions] = useState<DraftPosition[]>(initial);
  const [openItems, setOpenItems] = useState<OpenItem[]>(version.openItems);
  const [teams, setTeams] = useState<NamedTeam[]>(version.teams);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tab, setTab] = useState<"chart" | "type">(
    searchParams.get("mode") === "type" ? "type" : "chart",
  );
  const [outlineKey, setOutlineKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const history = useRef<DraftPosition[][]>([]);
  const [historySize, setHistorySize] = useState(0);
  const lastPush = useRef(0);
  const changes = useRef(0);
  const editVersionRef = useRef(version.editVersion);
  const inFlight = useRef(false);

  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const key = searchParams.get("position");
    return (key && initial.find((p) => p.key === key)?.id) || null;
  });

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const issues = useMemo(() => validateChart(toValidationNodes(positions)), [positions]);
  const errors = issues.filter((i) => i.level === "error");
  const selected = positions.find((p) => p.id === selectedId) ?? null;
  const ordered = useMemo(() => outlineOrder(positions), [positions]);
  const top = ordered.find((o) => o.position.reportsTo === null)?.position ?? null;
  const offChart = useMemo(() => membersOffChart(positions, members), [positions, members]);
  const base = `/app/${orgSlug}/org-chart`;

  // "Saved just now" turns into "Saved" after a minute.
  useEffect(() => {
    if (!savedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(id);
  }, [savedAt]);

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
    const at = Date.now();
    if (!force && at - lastPush.current < 800) return;
    lastPush.current = at;
    history.current = [...history.current.slice(-(HISTORY_LIMIT - 1)), current];
    setHistorySize(history.current.length);
  }

  function touched() {
    changes.current += 1;
    setDirty(true);
    setStatus(null);
  }

  const onTyped = useCallback(
    (next: DraftPosition[]) => {
      remember(positions, false);
      setPositions(next);
      touched();
    },
    [positions],
  );

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

  /** Applies a change (one Undo step); null means it was refused, and says why. */
  const update = useCallback(
    (next: DraftPosition[] | null, refused?: string) => {
      if (!next) {
        if (refused) setStatus(refused);
        return false;
      }
      remember(positions, true);
      setPositions(next);
      touched();
      return true;
    },
    [positions],
  );

  const edit = (next: DraftPosition) => update(positions.map((p) => (p.id === next.id ? next : p)));

  /** Adds a position and selects it. */
  const add = (next: DraftPosition[] | null) => {
    if (!next || !update(next)) return;
    const added = next.find((p) => !positions.some((q) => q.id === p.id));
    if (added) setSelectedId(added.id);
    setOutlineKey((k) => k + 1);
  };

  /** Under the selected position (or the top of the chart). */
  const parentForNew = () =>
    selected ? (selected.isAdvisor ? selected.reportsTo : selected.id) : (top?.id ?? null);

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
        alsoReportsTo: p.alsoReportsTo ?? [],
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
      setStatus(result.error);
      setSaveError(true);
      if ("conflict" in result && result.conflict) setConflict(true);
      return null;
    }
    setSaveError(false);
    const ids = "ids" in result ? result.ids : {};
    const remap = (id: string | null) => (id && ids[id] ? ids[id] : id);
    const remapPosition = (p: DraftPosition): DraftPosition => ({
      ...p,
      id: remap(p.id) as string,
      reportsTo: remap(p.reportsTo),
      ...(p.alsoReportsTo ? { alsoReportsTo: p.alsoReportsTo.map((m) => remap(m) as string) } : {}),
    });
    setPositions((current) => current.map(remapPosition));
    setSelectedId((id) => remap(id));
    editVersionRef.current = result.editVersion;
    history.current = history.current.map((snap) => snap.map(remapPosition));
    // Still unsaved if something changed while the save was on its way.
    if (changes.current === mark) setDirty(false);
    setSavedAt(Date.now());
    setNow(Date.now());
    return result.editVersion;
  }

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
  }, [dirty, conflict, saveError, positions, openItems, teams, saving]);

  async function settled() {
    for (let i = 0; i < 100 && inFlight.current; i++) await new Promise((r) => setTimeout(r, 100));
  }

  /** Saves what's left, then opens the review (which publishes). */
  const onReview = () =>
    startTransition(async () => {
      await settled();
      const current = dirty ? await save() : editVersionRef.current;
      if (current === null) return;
      router.push(`${base}/drafts/${version.id}/publish`);
    });

  const onDiscard = () =>
    startTransition(async () => {
      const result = await discardDraftAction(orgId, version.id);
      if (!result.ok) {
        setStatus("error" in result ? result.error : "The draft could not be discarded.");
        return;
      }
      setDirty(false);
      router.push(`/app/${orgSlug}/people?view=chart`);
      router.refresh();
    });

  const nodes: ChartNodeDTO[] = useMemo(
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
          alsoReportsToIds: p.alsoReportsTo,
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

  const inviteButton = (title: string) =>
    canInvite ? (
      <AmbientButton
        action={{
          key: "invite",
          label: "Invite someone",
          icon: UserPlus,
          reason: "An open role",
          ariaLabel: `Invite someone to be ${title}`,
          // Opens the invite dialog; nothing to wait for, so the button stays.
          run: async () => {
            setInviteOpen(true);
          },
        }}
      />
    ) : null;

  // Under the selected position: add under it or beside it. Under an open
  // one: Invite someone.
  const nodeActions = (node: ChartNodeDTO): ReactNode => {
    if (node.id === selectedId) {
      return (
        <span className="bg-primary text-primary-foreground shadow-e1 flex gap-0.5 rounded-full p-[3px]">
          {!node.isAdvisor && (
            <button
              type="button"
              onClick={() => add(addPosition(positions, node.id))}
              className="focus-glow h-[26px] rounded-full px-2.5 text-xs font-semibold outline-none hover:bg-white/15"
            >
              Add under
            </button>
          )}
          <button
            type="button"
            onClick={() => add(addBeside(positions, node.id))}
            className="focus-glow h-[26px] rounded-full px-2.5 text-xs font-semibold outline-none hover:bg-white/15"
          >
            Beside
          </button>
        </span>
      );
    }
    const variant = nodeVariant(node);
    return variant === "open" || variant === "empty" ? inviteButton(node.title) : null;
  };

  /** A member from the strip, given a position under the selected one. */
  const placeMember = (m: EditorMember) => {
    const id = `new-${m.id}-${positions.length}`;
    add(
      addPosition(positions, parentForNew(), id).map((p) =>
        p.id === id
          ? {
              ...p,
              title: m.title?.trim() || "Member",
              userId: m.id,
              personName: m.name,
              matchState: "CONFIRMED" as const,
              matchScore: 1,
            }
          : p,
      ),
    );
  };

  const savedLabel = saving
    ? "Saving…"
    : saveError
      ? "Couldn't save"
      : dirty
        ? "Saving soon"
        : savedAt && now - savedAt < 60_000
          ? "Saved just now"
          : "Saved";

  const fields = selected && (
    <PositionFields
      key={selected.id}
      position={selected}
      positions={positions}
      members={members}
      teams={teams}
      issues={issues.filter((i) => i.positionId === selected.id)}
      layout={isDesktop ? "panel" : "sheet"}
      onChange={edit}
      onSetManager={(managerId) =>
        update(
          setManager(positions, selected.id, managerId),
          "That would make the chart loop back on itself.",
        )
      }
      onAddAlso={(managerId) =>
        update(
          addAlsoReportsTo(positions, selected.id, managerId),
          "That position can't be a second manager here.",
        )
      }
      onRemoveAlso={(managerId) => update(removeAlsoReportsTo(positions, selected.id, managerId))}
      onAddUnder={() => add(addPosition(positions, selected.id))}
      onRemove={() => {
        update(removePosition(positions, selected.id));
        setSelectedId(null);
        setOutlineKey((k) => k + 1);
      }}
      onSelect={setSelectedId}
      onNewTeam={(name) => {
        const id = newTeamId();
        setTeams((list) => [...list, { id, name: name.slice(0, 60) }]);
        edit({ ...selected, teamId: id });
      }}
      onClose={() => setSelectedId(null)}
      invite={inviteButton(selected.title)}
    />
  );

  const tabs = (
    <Segmented
      label="Edit as"
      value={tab}
      onSelect={(v) => {
        setTab(v as "chart" | "type");
        setOutlineKey((k) => k + 1);
      }}
      options={[
        { value: "chart", label: "Chart" },
        { value: "type", label: "Type it" },
      ]}
    />
  );

  const more = (
    <ItemMenu
      label="More for this draft"
      items={[
        { label: "Teams", icon: UsersRound, onSelect: () => setTeamsOpen(true) },
        openItems.length > 0 && {
          label: `Open questions (${openItems.length})`,
          icon: CircleAlert,
          onSelect: () => setQuestionsOpen(true),
        },
        { label: "Version history", icon: History, href: `${base}/versions`, separated: true },
      ]}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="hidden md:block">
        <BackLink href={`/app/${orgSlug}/people?view=chart`} label="People" />
      </div>

      <header className="flex flex-wrap items-center gap-2 md:gap-3">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Back to People"
        >
          <Link href={`/app/${orgSlug}/people?view=chart`}>
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <h1 className="page-title min-w-0 flex-1 max-md:text-[22px]">Org chart</h1>
        <Badge variant="accent">Draft</Badge>
        <span
          className="text-muted-foreground mr-1 hidden text-[13px] sm:inline"
          role="status"
          aria-live="polite"
        >
          {savedLabel}
          {saveError && !conflict && (
            <button
              type="button"
              className="text-foreground ml-1.5 font-semibold underline underline-offset-4"
              onClick={() => setSaveError(false)}
            >
              Retry
            </button>
          )}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="hidden md:inline-flex"
          aria-label="Undo"
          title="Undo the last change (⌘Z outside a text field)"
          onClick={undo}
          disabled={historySize === 0}
        >
          <Undo2 aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="hidden md:inline-flex"
          onClick={() => setDiscardOpen(true)}
          disabled={pending}
        >
          Discard
        </Button>
        <Button type="button" onClick={onReview} disabled={pending || conflict}>
          <span className="md:hidden">Publish</span>
          <span className="hidden md:inline">Review and publish</span>
        </Button>
      </header>

      {notice}

      {status && (
        <p role="alert" className="bg-tint-danger rounded-tile px-4 py-3 text-sm">
          {status}
          {conflict && (
            <button
              type="button"
              className="ml-2 font-semibold underline underline-offset-4"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          )}
        </p>
      )}

      {errors.length > 0 && (
        <section
          aria-label="To fix before publishing"
          className="bg-tint-accent rounded-tile flex flex-col gap-1.5 px-4 py-3 text-[13.5px]"
        >
          <p className="font-semibold">
            {errors.length === 1
              ? "1 thing to fix before publishing"
              : `${errors.length} things to fix before publishing`}
          </p>
          <ul className="flex flex-col gap-0.5">
            {errors.map((issue, i) => (
              <li key={`${issue.code}-${i}`}>
                {issue.positionId ? (
                  <button
                    type="button"
                    className="text-left underline-offset-4 hover:underline"
                    onClick={() => {
                      setSelectedId(issue.positionId ?? null);
                      setTab("chart");
                    }}
                  >
                    {issue.message}
                  </button>
                ) : (
                  issue.message
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "type" ? (
        <OutlineEditor
          key={outlineKey}
          positions={positions}
          members={members}
          onChange={onTyped}
          previewNodes={nodes}
          teams={teams}
          selectedId={selectedId}
          onSelect={setSelectedId}
          canInvite={canInvite}
          onInvite={() => setInviteOpen(true)}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              {tabs}
              <span className="flex-1" />
              <Button asChild variant="outline" size="sm">
                <Link href={`${base}/import`}>
                  <FileUp aria-hidden="true" />
                  Import a document
                </Link>
              </Button>
              {more}
            </div>
          }
        />
      ) : (
        <div className="flex min-w-0 flex-wrap items-stretch gap-5">
          <section
            aria-label="Chart"
            className="bg-card edge rounded-card flex min-w-0 flex-[999_1_640px] flex-col overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-3">
              {tabs}
              <span className="flex-1" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => add(addPosition(positions, parentForNew()))}
              >
                <Plus aria-hidden="true" />
                Position
              </Button>
              {more}
            </div>

            {positions.length === 0 ? (
              <p className="text-muted-foreground border-t px-5 py-10 text-center text-sm">
                Nobody is on the chart yet. Add the top position first, or type it.
              </p>
            ) : isDesktop ? (
              <div className="h-[560px] border-t">
                <ChartCanvas
                  nodes={nodes}
                  teams={teams}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onReparent={(dragId, targetId) =>
                    update(
                      moveDraft(positions, dragId, targetId, "inside"),
                      "That move would make the chart loop back on itself.",
                    )
                  }
                  nodeActions={nodeActions}
                  collapsible={false}
                  ariaLabel="The draft chart"
                />
              </div>
            ) : (
              <ul className="border-t px-3 py-2" aria-label="Positions">
                {ordered.map(({ position: p, depth }) => {
                  const m = p.userId ? membersById.get(p.userId) : undefined;
                  const who = p.isOpen ? "Open role" : (m?.name ?? p.personName ?? "Nobody yet");
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        aria-pressed={p.id === selectedId}
                        style={{ paddingLeft: 6 + Math.min(depth, 6) * 20 }}
                        className="hover:bg-muted aria-pressed:bg-muted focus-glow flex h-[52px] w-full items-center gap-2.5 rounded-xl pr-2 text-left text-sm outline-none"
                      >
                        {m ? (
                          <UserAvatar user={m} size="lg" />
                        ) : (
                          <span className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-full">
                            <UserPlus className="size-4" aria-hidden="true" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <b className="block truncate font-semibold">
                            {p.title || "Untitled position"}
                          </b>
                          <span className="text-muted-foreground block truncate text-xs">
                            {who}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {offChart.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3.5">
                <span className="text-[13px] font-semibold">Not on the chart</span>
                {offChart.slice(0, 12).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => placeMember(m)}
                    title={`Give ${m.name ?? "them"} a position under ${selected?.title ?? top?.title ?? "the top"}`}
                    className="bg-secondary hover:bg-muted-strong focus-glow inline-flex h-8 max-w-[14rem] items-center gap-2 rounded-full pr-3 pl-1 text-[13px] font-semibold outline-none"
                  >
                    <UserAvatar user={m} size="sm" />
                    <span className="truncate">{m.name ?? "Unnamed member"}</span>
                  </button>
                ))}
                {offChart.length > 12 && (
                  <span className="text-muted-foreground text-[12.5px]">
                    and {offChart.length - 12} more in Type it
                  </span>
                )}
              </div>
            )}
            {isDesktop && positions.length > 0 && (
              <p className="text-muted-foreground px-5 pb-4 text-[12.5px]">
                Drag a position onto another to change who it reports to.
              </p>
            )}
          </section>

          {isDesktop && (
            <aside
              aria-label="Position"
              className="bg-card edge rounded-card flex min-w-0 flex-[1_1_340px] flex-col p-5"
            >
              {fields || (
                <p className="text-muted-foreground text-sm">
                  Click a position to edit it. Add a report under it, or one beside it, from the
                  buttons that show up under it.
                </p>
              )}
            </aside>
          )}
        </div>
      )}

      {!isDesktop && (
        <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto px-[18px] pt-5 pb-6">
            <SheetTitle className="sr-only">{selected?.title ?? "Position"}</SheetTitle>
            {fields}
          </SheetContent>
        </Sheet>
      )}

      <Dialog open={teamsOpen} onOpenChange={setTeamsOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Teams</DialogTitle>
            <DialogDescription>Colors on the chart, and who works together.</DialogDescription>
          </DialogHeader>
          <TeamsEditor
            teams={teams}
            positions={positions}
            members={members}
            onTeams={(next) => {
              setTeams(next);
              touched();
            }}
            onAssign={(positionId, teamId) =>
              update(positions.map((p) => (p.id === positionId ? { ...p, teamId } : p)))
            }
          />
        </DialogContent>
      </Dialog>

      <Dialog open={questionsOpen} onOpenChange={setQuestionsOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Open questions</DialogTitle>
            <DialogDescription>
              What the document left open, and who should answer.
            </DialogDescription>
          </DialogHeader>
          <OpenItemsEditor
            items={openItems}
            onChange={(items) => {
              setOpenItems(items);
              touched();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this draft?</DialogTitle>
            <DialogDescription>The chart everyone sees doesn&apos;t change.</DialogDescription>
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

      {canInvite && (
        <InviteDialog
          orgId={orgId}
          orgSlug={orgSlug}
          link={null}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
        />
      )}
    </div>
  );
}

function OpenItemsEditor({
  items,
  onChange,
}: {
  items: OpenItem[];
  onChange: (items: OpenItem[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">None left.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li key={i} className={cn("grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]")}>
              <Input
                value={item.who}
                maxLength={120}
                placeholder="Who"
                aria-label={`Open question ${i + 1}: who`}
                onChange={(e) =>
                  onChange(items.map((x, j) => (j === i ? { ...x, who: e.target.value } : x)))
                }
              />
              <Input
                value={item.question}
                maxLength={500}
                placeholder="Question"
                aria-label={`Open question ${i + 1}`}
                onChange={(e) =>
                  onChange(items.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={`Resolve open question ${i + 1}`}
              >
                Resolved
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...items, { who: "", question: "" }])}
        disabled={items.length >= 50}
      >
        <Plus aria-hidden="true" />
        Add a question
      </Button>
    </div>
  );
}
