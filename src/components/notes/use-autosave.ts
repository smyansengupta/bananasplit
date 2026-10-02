"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "conflict" | "error";

interface SaveResult {
  error?: string;
  conflict?: boolean;
}

/**
 * Debounces edits and sends the latest snapshot after `delay` ms of
 * inactivity. If another edit lands while a save is in flight, it re-flushes
 * once the in-flight save resolves rather than dropping it — so the server
 * always ends up with the most recent state, never a stale intermediate one.
 */
export function useAutosave<T>({
  save,
  delay = 800,
}: {
  save: (payload: T) => Promise<SaveResult>;
  delay?: number;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<T | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);

  /**
   * Saves the pending snapshot now instead of after the debounce. Resolves
   * once nothing is left to save (or a save failed), so callers can await it
   * before reading the note back, e.g. for a download.
   */
  const flush = useCallback((): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // A save in flight already picks up the pending snapshot when it
    // finishes, so wait for that one rather than starting a second.
    if (savingRef.current) return savingRef.current;
    if (pendingRef.current === null) return Promise.resolve();
    savingRef.current = (async () => {
      try {
        // Loop instead of recursing: if another edit lands while this save is
        // in flight, pick it up on the next iteration rather than dropping it.
        while (pendingRef.current !== null) {
          const payload = pendingRef.current;
          pendingRef.current = null;
          setStatus("saving");

          const result = await save(payload);

          if (result.conflict) {
            setStatus("conflict");
            return;
          }
          if (result.error) {
            setStatus("error");
            return;
          }
          setStatus("saved");
        }
      } finally {
        savingRef.current = null;
      }
    })();
    return savingRef.current;
  }, [save]);

  const schedule = useCallback(
    (payload: T) => {
      pendingRef.current = payload;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { status, schedule, flush };
}
