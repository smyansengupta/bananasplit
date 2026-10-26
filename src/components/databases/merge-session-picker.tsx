"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { mergeSessionsAction } from "@/app/app/[orgSlug]/databases/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { FieldSelect } from "@/components/ui/field-select";

import { notice } from "./styles";
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
  onCancel,
}: {
  organizationId: string;
  loserId: string;
  loserTitle: string;
  /** Sessions to keep instead (nearby sessions, or the duplicate pair); without them an id is typed. */
  candidates?: { id: string; label: string }[];
  startOpen?: boolean;
  /** After merging, open the surviving session in the drawer (Sessions page) or just refresh (queue). */
  openSurvivor?: boolean;
  /** For a picker opened from elsewhere (a menu): Cancel hands control back. */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const view = useViewParams();
  const [confirmEl, confirm] = useConfirm();
  const [open, setOpen] = useState(startOpen);
  const [survivor, setSurvivor] = useState(candidates?.[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Merge into another session…
      </Button>
    );
  }
  return (
    <div className="bg-muted/60 rounded-tile space-y-3 p-4 text-sm">
      {confirmEl}
      <p>
        Merge <strong className="font-semibold">{loserTitle}</strong> into:
      </p>
      {candidates && candidates.length > 0 ? (
        <FieldSelect
          value={survivor}
          onChange={(e) => setSurvivor(e.target.value)}
          aria-label="Session to keep"
          className="w-full"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </FieldSelect>
      ) : (
        <Input
          value={survivor}
          onChange={(e) => setSurvivor(e.target.value.trim())}
          placeholder="Session id (from the Sessions table)"
          aria-label="Session id to keep"
          className="font-mono text-xs md:text-xs"
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={pending || !survivor}
          onClick={async () => {
            const ok = await confirm({
              title: "Merge these sessions?",
              description: `${loserTitle} is removed and everything on it moves to the session you keep. This can't be undone.`,
              confirmLabel: "Merge session",
            });
            if (!ok) return;
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
          Merge session
        </Button>
        {(!startOpen || onCancel) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (onCancel ? onCancel() : setOpen(false))}
          >
            Cancel
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className={notice.error}>
          {error}
        </p>
      )}
      {done && <p className={notice.success}>{done}</p>}
    </div>
  );
}
