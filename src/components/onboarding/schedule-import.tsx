"use client";

import { Camera, ImageUp, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DAY_LABELS, hourLabelLong, MAX_RULE_LABEL, MAX_RULES, type Availability } from "@/lib/availability";
import { addBlocksAsRules, type DetectedBlock } from "@/lib/availability/screenshot";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 25 }, (_, h) => h);

interface Draft extends DetectedBlock {
  keep: boolean;
}

/**
 * "Import from a screenshot": pick a screenshot of a class schedule or
 * calendar week, review what was read (rename, change days and hours, drop
 * anything wrong), then add it to the week as regular commitments. They
 * show on the grid and in the list below it, still editable, and nothing is
 * saved until the week is.
 */
export function ScheduleImport({
  value,
  onChange,
}: {
  value: Availability;
  onChange: (next: Availability) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function read(file: File) {
    setBusy(true);
    setError(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/profile/availability/screenshot", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { blocks?: DetectedBlock[]; error?: string } | null;
      if (!res.ok || !body?.blocks) {
        setError(body?.error ?? "The screenshot couldn't be read.");
        setDrafts([]);
        return;
      }
      setDrafts(body.blocks.map((b) => ({ ...b, keep: true })));
    } catch {
      setError("The screenshot couldn't be sent. Check your connection.");
      setDrafts([]);
    } finally {
      setBusy(false);
    }
  }

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => (d ? d.map((x, k) => (k === i ? { ...x, ...patch } : x)) : d));

  const kept = (drafts ?? []).filter((d) => d.keep && d.days.length > 0 && d.end > d.start && d.label.trim());
  const room = MAX_RULES - value.rules.length;

  function close() {
    setDrafts(null);
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-xs font-medium transition-colors"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Camera className="size-3.5" aria-hidden="true" />}
        {busy ? "Reading your schedule…" : "Import a screenshot"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void read(file);
        }}
      />

      <Dialog open={drafts !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Check what we found</DialogTitle>
            <DialogDescription>
              Fix anything that&apos;s off, untick what shouldn&apos;t count, then add them to your
              week. You can still change them after, and nothing is saved until you save your week.
              Your screenshot isn&apos;t kept.
            </DialogDescription>
          </DialogHeader>

          {preview && (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL of the member's own screenshot
            <img src={preview} alt="Your screenshot" className="max-h-40 w-full rounded-lg border object-contain" />
          )}

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : drafts && drafts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No regular classes or shifts were found in that image. Try a screenshot of your week
              view, or mark your hours on the grid.
            </p>
          ) : (
            <ul className="space-y-2">
              {(drafts ?? []).map((d, i) => (
                <li
                  key={i}
                  className={cn("space-y-2 rounded-lg border p-3", !d.keep && "opacity-50")}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={d.keep}
                      onChange={(e) => update(i, { keep: e.target.checked })}
                      aria-label={`Add ${d.label}`}
                      className="accent-primary size-4"
                    />
                    <Input
                      value={d.label}
                      maxLength={MAX_RULE_LABEL}
                      onChange={(e) => update(i, { label: e.target.value })}
                      aria-label="Name"
                      className="h-8"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={`Remove ${d.label}`}
                      onClick={() => setDrafts((all) => (all ? all.filter((_, k) => k !== i) : all))}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-6">
                    <div className="flex gap-1" role="group" aria-label="Days">
                      {DAY_LABELS.map((day, dayIndex) => {
                        const on = d.days.includes(dayIndex);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              update(i, {
                                days: on ? d.days.filter((x) => x !== dayIndex) : [...d.days, dayIndex].sort(),
                              })
                            }
                            className={cn(
                              "rounded-md border px-1.5 py-0.5 text-[11px]",
                              on ? "bg-chart-1/15 border-chart-1/40 font-medium" : "text-muted-foreground",
                            )}
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
                    <select
                      value={d.start}
                      onChange={(e) => update(i, { start: Number(e.target.value) })}
                      aria-label="From"
                      className="border-input h-7 rounded-md border bg-transparent px-1.5 text-xs"
                    >
                      {HOURS.slice(0, 24).map((h) => (
                        <option key={h} value={h}>
                          {hourLabelLong(h)}
                        </option>
                      ))}
                    </select>
                    <span className="text-muted-foreground text-xs">to</span>
                    <select
                      value={d.end}
                      onChange={(e) => update(i, { end: Number(e.target.value) })}
                      aria-label="Until"
                      className="border-input h-7 rounded-md border bg-transparent px-1.5 text-xs"
                    >
                      {HOURS.slice(1).map((h) => (
                        <option key={h} value={h}>
                          {hourLabelLong(h)}
                        </option>
                      ))}
                    </select>
                    <span className="text-muted-foreground text-[11px]">
                      read as {d.startText} – {d.endText}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
              <ImageUp className="size-4" aria-hidden="true" />
              Try another screenshot
            </Button>
            <Button
              type="button"
              disabled={kept.length === 0 || room <= 0}
              onClick={() => {
                onChange(addBlocksAsRules(value, kept));
                close();
              }}
            >
              {room <= 0
                ? `You have ${MAX_RULES} commitments already`
                : `Add ${Math.min(kept.length, room)} to my week`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
