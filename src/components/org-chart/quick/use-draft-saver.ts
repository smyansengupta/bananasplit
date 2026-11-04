"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { publishDraftAction, saveDraftAction } from "@/app/app/[orgSlug]/org-chart/actions";
import type { DraftPosition } from "@/lib/org-chart/draft";
import type { NamedTeam } from "@/lib/org-chart/teams";
import type { OpenItem } from "@/lib/org-chart/types";

/**
 * The quick setup screens' draft state: positions that save themselves a
 * moment after each change (saveDraftAction, one save at a time, with the
 * draft's editVersion), and Publish, which saves first. Nothing is saved
 * until something changes, so opening a screen never bumps the draft's
 * editVersion under a colleague's editor. While Publish runs, changes wait
 * (a save landing mid-publish would conflict with it); a change that came
 * in too late to be published is reported as `unsaved`. New positions get
 * their row ids back from the save; `keyOf` keeps the id they started with,
 * so React keys and focus survive the swap.
 */

const SAVE_DELAY_MS = 600;

type PublishOutcome =
  /** `unsaved`: a change came in after the last save and is not in what was published. */
  { ok: true; unsaved: boolean } | { ok: false; error: string };

export function useDraftSaver({
  orgId,
  version,
  initial,
  onRemap,
}: {
  orgId: string;
  version: { id: string; editVersion: number; openItems: OpenItem[]; teams: NamedTeam[] };
  initial: DraftPosition[];
  /** Called with the client id -> row id map after each save. */
  onRemap?: (ids: Record<string, string>) => void;
}) {
  const [positions, setState] = useState<DraftPosition[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const current = useRef(initial);
  const editVersion = useRef(version.editVersion);
  const changes = useRef(0);
  const saved = useRef(0);
  /** Publishing, or paused by the screen: changes wait instead of saving. */
  const holding = useRef(0);
  /** Published: nothing more saves into this draft. */
  const closed = useRef(false);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<number | null>(null);
  const aliases = useRef(new Map<string, string>());
  const [aliasMap, setAliasMap] = useState<ReadonlyMap<string, string>>(() => new Map());
  const remapRef = useRef(onRemap);
  useEffect(() => {
    remapRef.current = onRemap;
  });

  const saveOnce = useCallback(async (): Promise<boolean> => {
    const mark = changes.current;
    const snapshot = current.current;
    let result: Awaited<ReturnType<typeof saveDraftAction>>;
    try {
      result = await saveDraftAction(orgId, {
        versionId: version.id,
        editVersion: editVersion.current,
        openItems: version.openItems.filter((o) => o.question.trim()),
        teams: version.teams,
        positions: snapshot.map((p) => ({
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
      });
    } catch {
      setError("Couldn't save. Check your connection and try again.");
      return false;
    }
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    const ids = "ids" in result ? result.ids : {};
    const remap = (id: string | null) => (id && ids[id] ? ids[id] : id);
    for (const [from, to] of Object.entries(ids)) {
      if (from !== to) aliases.current.set(to, aliases.current.get(from) ?? from);
    }
    if (Object.keys(ids).length > 0) setAliasMap(new Map(aliases.current));
    const next = current.current.map((p) => ({
      ...p,
      id: remap(p.id) as string,
      reportsTo: remap(p.reportsTo),
      ...(p.alsoReportsTo ? { alsoReportsTo: p.alsoReportsTo.map((m) => remap(m) as string) } : {}),
    }));
    current.current = next;
    setState(next);
    remapRef.current?.(ids);
    editVersion.current = result.editVersion;
    saved.current = mark;
    if (changes.current === mark) setDirty(false);
    setError(null);
    return true;
  }, [orgId, version.id, version.openItems, version.teams]);

  /** Saves until nothing is left unsaved; false when a save failed. */
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    queue.current = queue.current.then(async () => {
      while (saved.current < changes.current) {
        if (!(await saveOnce())) return false;
      }
      return true;
    });
    return queue.current;
  }, [saveOnce]);

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (holding.current > 0 || closed.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void flush();
    }, SAVE_DELAY_MS);
  }, [flush]);

  /** Applies a change; it saves a moment later. Null means "no change". */
  const change = useCallback(
    (fn: (positions: DraftPosition[]) => DraftPosition[] | null) => {
      const next = fn(current.current);
      if (!next) return false;
      current.current = next;
      setState(next);
      changes.current += 1;
      setDirty(true);
      schedule();
      return true;
    },
    [schedule],
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /**
   * Stops saving until the returned resume() runs (which saves anything
   * that waited): for an action that may throw the draft away, so a
   * pending save doesn't race it.
   */
  const pause = useCallback(() => {
    holding.current += 1;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      holding.current -= 1;
      if (saved.current < changes.current) schedule();
    };
  }, [schedule]);

  const publish = useCallback(
    async (setTitles: boolean): Promise<PublishOutcome> => {
      const resume = pause();
      try {
        if (!(await flush())) return { ok: false, error: "The draft couldn't be saved." };
        const result = await publishDraftAction(orgId, version.id, {
          setTitles,
          expectedEditVersion: editVersion.current,
        });
        if (result.ok) {
          closed.current = true;
          return { ok: true, unsaved: saved.current < changes.current };
        }
        const detail =
          "issues" in result && result.issues?.length
            ? ` ${result.issues.map((i) => i.message).join(" ")}`
            : "";
        return { ok: false, error: `${result.error}${detail}` };
      } finally {
        resume();
      }
    },
    [flush, orgId, pause, version.id],
  );

  /** The id a position started with in this session (a stable React key). */
  const keyOf = useCallback((id: string) => aliasMap.get(id) ?? id, [aliasMap]);

  return { positions, change, flush, pause, publish, error, dirty, keyOf };
}
