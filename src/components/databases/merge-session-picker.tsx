"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { mergeSessionsAction } from "@/app/app/[orgSlug]/databases/actions";
import { Button } from "@/components/ui/button";

import { useViewParams } from "./view-params";

/**
 * Merge one session into another (ADMIN+). The survivor keeps its details;
 * check-ins, RSVPs, notes, transactions and the website link move to it and
 * this session is removed. There is no unmerge; the audit log records what
 * moved.
 */
export function MergeSessionPicker({
  organizationId,
  loserId,
  loserTitle,
  candidates,
  startOpen = false,
  openSurvivor = true,
}: {
  organizationId: string;
  loserId: string;
  loserTitle: string;
  /** Sessions to keep instead (nearby sessions, or the duplicate pair); without them an id is typed. */
  candidates?: { id: string; label: string }[];
  startOpen?: boolean;
  /** After merging, open the surviving session in the drawer (Sessions page) or just refresh (queue). */
  openSurvivor?: boolean;
}) {
  const router = useRouter();
  const view = useViewParams();
  const [open, setOpen] = useState(startOpen);
  const [survivor, setSurvivor] = useState(candidates?.[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Merge into another session…
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <p>
        Merge <strong>{loserTitle}</strong> into:
      </p>
      {candidates && candidates.length > 0 ? (
        <select
          value={survivor}
          onChange={(e) => setSurvivor(e.target.value)}
          aria-label="Session to keep"
          className="border-input bg-background h-8 w-full rounded-md border px-2"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={survivor}
          onChange={(e) => setSurvivor(e.target.value.trim())}
          placeholder="Session id (from the Sessions table)"
          aria-label="Session id to keep"
          className="border-input bg-background h-8 w-full rounded-md border px-2 font-mono text-xs"
        />
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={pending || !survivor}
          onClick={() => {
            if (!window.confirm("Merge these sessions? This cannot be undone.")) return;
            setError(null);
            start(async () => {
              const r = await mergeSessionsAction(organizationId, survivor, loserId);
              if (r.error) return setError(r.error);
              const moved = r.data;
              setDone(
                moved
                  ? `Merged: ${moved.attendance} check-ins, ${moved.attendees} RSVPs, ${moved.notes} notes and ${moved.transactions} transactions moved.`
                  : "Merged.",
              );
              if (openSurvivor) view.update((p) => p.set("row", survivor), { keepPage: true });
              router.refresh();
            });
          }}
        >
          Merge
        </Button>
        {!startOpen && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      {done && <p className="text-success text-xs">{done}</p>}
    </div>
  );
}
