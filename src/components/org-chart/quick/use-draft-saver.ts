"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { publishDraftAction, saveDraftAction } from "@/app/app/[orgSlug]/org-chart/actions";
import type { DraftPosition } from "@/lib/org-chart/draft";
import type { NamedTeam } from "@/lib/org-chart/teams";
import type { OpenItem } from "@/lib/org-chart/types";

/**
 * The quick setup screens' draft state: positions that save themselves a
 * moment after each change (saveDraftAction, one save at a time, with the
 * draft's editVersion), and Publish, which saves first. New positions get
 * their row ids back from the save; `keyOf` keeps the id they started with,
 * so React keys and focus survive the swap.
 */

const SAVE_DELAY_MS = 600;

type PublishOutcome = { ok: true } | { ok: false; error: string };

export function useDraftSaver({
  orgId,
  version,
  initial,
  initiallyDirty = false,
  onRemap,
}: {
  orgId: string;
  version: { id: string; editVersion: number; openItems: OpenItem[]; teams: NamedTeam[] };
  initial: DraftPosition[];
  /** Save once even before the first change (the screen adjusted `initial`). */
  initiallyDirty?: boolean;
  /** Called with the client id -> row id map after each save. */
  onRemap?: (ids: Record<string, string>) => void;
}) {
  const [positions, setState] = useState<DraftPosition[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(initiallyDirty);
  const current = useRef(initial);
  const editVersion = useRef(version.editVersion);
  const changes = useRef(initiallyDirty ? 1 : 0);
  const saved = useRef(0);
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
    if (initiallyDirty) schedule();
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const publish = useCallback(
    async (setTitles: boolean): Promise<PublishOutcome> => {
      if (!(await flush())) return { ok: false, error: "The draft couldn't be saved." };
      const result = await publishDraftAction(orgId, version.id, {
        setTitles,
        expectedEditVersion: editVersion.current,
      });
      if (result.ok) return { ok: true };
      const detail =
        "issues" in result && result.issues?.length
          ? ` ${result.issues.map((i) => i.message).join(" ")}`
          : "";
      return { ok: false, error: `${result.error}${detail}` };
    },
    [flush, orgId, version.id],
  );

  /** The id a position started with in this session (a stable React key). */
  const keyOf = useCallback((id: string) => aliasMap.get(id) ?? id, [aliasMap]);

  return { positions, change, flush, publish, error, dirty, keyOf };
}
