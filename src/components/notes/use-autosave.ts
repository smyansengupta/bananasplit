"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "conflict" | "error";

interface SaveResult {
  error?: string;
  conflict?: boolean;
}

/** Waits between automatic retries of a save that failed (a dropped connection, a cold server). */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

/**
 * Debounces edits and sends the latest snapshot after `delay` ms of
 * inactivity. Nothing typed is ever dropped:
 *
 * - An edit that lands while a save is in flight is sent once it resolves
 *   (the server always ends up with the latest state, never a stale one).
 * - A save that fails keeps its snapshot and retries on its own, with
 *   backoff, until it lands or a newer edit replaces it; `retry()` sends it
 *   now.
 * - Leaving the page (unmount, tab hidden, pagehide) sends whatever is
 *   waiting at once instead of waiting out the debounce, and closing the
 *   tab with unsaved changes asks first.
 * - A conflict (someone else saved a newer version) stops saving: the
 *   caller shows it and reloads.
 */
export function useAutosave<T>({
  save,
  delay = 800,
}: {
  save: (payload: T) => Promise<SaveResult>;
  delay?: number;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saveRef = useRef(save);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const pendingRef = useRef<T | null>(null);
  const savingRef = useRef(false);
  const stoppedRef = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    if (savingRef.current || stoppedRef.current) return;
    savingRef.current = true;
    try {
      // Loop instead of recursing: an edit that lands while this save is in
      // flight is picked up on the next pass rather than dropped.
      while (pendingRef.current !== null) {
        const payload = pendingRef.current;
        pendingRef.current = null;
        setStatus("saving");

        let result: SaveResult;
        try {
          result = await saveRef.current(payload);
        } catch {
          result = { error: "network" };
        }

        if (result.conflict) {
          stoppedRef.current = true;
          setStatus("conflict");
          return;
        }
        if (result.error) {
          // Keep this snapshot unless a newer edit already replaced it.
          if (pendingRef.current === null) pendingRef.current = payload;
          setStatus("error");
          const wait = RETRY_DELAYS_MS[Math.min(attemptsRef.current, RETRY_DELAYS_MS.length - 1)];
          attemptsRef.current += 1;
          retryRef.current = setTimeout(() => void flushRef.current(), wait);
          return;
        }
        attemptsRef.current = 0;
        setStatus(pendingRef.current === null ? "saved" : "saving");
      }
    } finally {
      savingRef.current = false;
    }
  }, []);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const schedule = useCallback(
    (payload: T) => {
      if (stoppedRef.current) return;
      pendingRef.current = payload;
      setStatus((s) => (s === "saving" ? s : "pending"));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  /** Sends a failed or waiting save now. */
  const retry = useCallback(() => {
    attemptsRef.current = 0;
    void flush();
  }, [flush]);

  useEffect(() => {
    const unsaved = () => pendingRef.current !== null || savingRef.current;
    const onHidden = () => {
      if (document.visibilityState === "hidden" && unsaved()) void flush();
    };
    const onPageHide = () => {
      if (unsaved()) void flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!unsaved() || stoppedRef.current) return;
      void flush();
      // The browser's own "Leave site? Changes you made may not be saved."
      event.preventDefault();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Leaving the editor inside the app: send what's waiting right away.
      if (pendingRef.current !== null) void flush();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [flush]);

  return { status, schedule, flush, retry };
}
