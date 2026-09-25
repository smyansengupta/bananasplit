"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { syncProgressAction } from "./actions";
import type { SyncProgressView } from "./view";

/**
 * The first sync runs as a background job in its own invocation, so the
 * result screen has to wait a few seconds for it. Rather than leaving an
 * empty screen with a "come back later", this watches the job and turns
 * itself into the real numbers the moment they land.
 *
 * It polls a read-only action (counts and sync state, bounded by RLS to the
 * viewer's org), stops the second the job leaves the queue, and gives up
 * after a minute with a straight answer instead of spinning forever.
 */

const INTERVAL_MS = 2000;
const MAX_POLLS = 30;

export function SyncWatcher({
  orgId,
  /** Rows already present, so "nothing changed" can be told from "nothing yet". */
  startingRows,
}: {
  orgId: string;
  startingRows: number;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<SyncProgressView | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const polls = useRef(0);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      const next = await syncProgressAction(orgId).catch(() => null);
      if (!live) return;
      if (next) setProgress(next);
      polls.current += 1;
      const rows =
        next === null
          ? startingRows
          : next.counts.checkIns + next.counts.signups + next.counts.sessions + next.counts.ballots;
      // Done when the job has left the queue. Pull the server tree down
      // once so the chart and the links render with the new rows.
      if (next && !next.syncing) {
        if (rows !== startingRows || next.lastError) router.refresh();
        return;
      }
      if (polls.current >= MAX_POLLS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(tick, INTERVAL_MS);
    }

    timer = setTimeout(tick, INTERVAL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [orgId, router, startingRows]);

  if (gaveUp) {
    return (
      <p role="status" className="border-warning/40 bg-warning/10 rounded-lg border p-3 text-sm">
        The sync is taking longer than a minute. It runs in the background and will finish on its
        own — reload this page, or check the sync panel on the Databases page, to see where it got
        to. Locally, run <span className="font-mono">pnpm jobs:drain</span>.
      </p>
    );
  }

  const written = progress?.streams.reduce((n, s) => n + s.rows, 0) ?? 0;

  return (
    <div role="status" aria-live="polite" className="bg-muted/40 space-y-2 rounded-lg border p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Loader2
          className="text-muted-foreground size-4 motion-safe:animate-spin"
          aria-hidden="true"
        />
        Pulling your data in…
      </p>
      <p className="text-muted-foreground text-sm">
        {written > 0
          ? `${written.toLocaleString()} rows so far. This page updates when the sync finishes.`
          : "Reading sessions, check-ins, signups and ballots. This usually takes a few seconds."}
      </p>
      {progress?.streams.some((s) => s.rows > 0) ? (
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {progress.streams
            .filter((s) => s.rows > 0)
            .map((s) => (
              <li key={s.label} className="tabular-nums">
                {s.label} {s.rows.toLocaleString()}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
