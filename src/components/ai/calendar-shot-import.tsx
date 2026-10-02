"use client";

import { ArrowLeft, CheckCircle2, CircleAlert, ImageUp, Loader2, Repeat, Video, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { createEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { ConnectionPicker, useAiConnections } from "@/components/ai/connection-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ProposedEvent } from "@/lib/ai/calendar-shot";
import type { ImportRosterMember } from "@/lib/ai/types";
import { parseZonedDateTimeLocal } from "@/lib/calendar/dates";
import { cn } from "@/lib/utils";

/**
 * "From a screenshot": drop, paste or pick a screenshot of a calendar item
 * (an invite, an email, a flyer); the club's connected model lists the
 * events in it; the admin checks and edits each one, then adds them through
 * the ordinary event action. The image is shrunk in the browser first (fewer
 * tokens, under the upload cap) and is never stored.
 */

interface ReadResponse {
  events: ProposedEvent[];
  notes: string[];
  readBy: string;
  timezone: string;
  members: ImportRosterMember[];
}

interface Row extends ProposedEvent {
  include: boolean;
  attendeeIds: string[];
  isPublic: boolean;
}

const MAX_EDGE = 1600;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/** The image at most MAX_EDGE on its long side, in its own format (a GIF, or one small enough, stays as it is). */
async function shrink(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const g = canvas.getContext("2d");
    if (!g) return file;
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Same format, so a transparent PNG doesn't turn black as a JPEG.
    const type = file.type === "image/jpeg" || file.type === "image/webp" ? file.type : "image/png";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.88));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function CalendarShotImport({
  orgId,
  orgSlug,
  open,
  onOpenChange,
}: {
  orgId: string;
  orgSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const ai = useAiConnections(orgId, open);
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"input" | "review" | "creating" | "done">("input");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<ReadResponse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [made, setMade] = useState<{ key: string; title: string; eventId?: string; error?: string }[]>([]);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = useCallback((next: File) => {
    setError(null);
    if (!ACCEPT.split(",").includes(next.type)) {
      setError("That isn't a screenshot. Use a PNG, JPEG, WebP or GIF image.");
      return;
    }
    if (next.size > 25_000_000) {
      setError("That image is too large. Use one under 25 MB.");
      return;
    }
    setFile(next);
    setPreview(URL.createObjectURL(next));
  }, []);

  // Paste a screenshot straight from the clipboard while the dialog is open.
  useEffect(() => {
    if (!open || phase !== "input") return;
    function onPaste(e: ClipboardEvent) {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const pasted = item?.getAsFile();
      if (pasted) {
        e.preventDefault();
        pick(pasted);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, phase, pick]);

  function reset() {
    setPhase("input");
    setFile(null);
    setPreview(null);
    setError(null);
    setRead(null);
    setRows([]);
    setMade([]);
  }

  async function readImage() {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const body = new FormData();
      const small = await shrink(file);
      const ext = small.type === "image/jpeg" ? "jpg" : (small.type.split("/")[1] ?? "png");
      body.set("file", small, `screenshot.${ext}`);
      if (ai.selected) body.set("connection", ai.selected.id);
      const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/ai/calendar-screenshot`, { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as Partial<ReadResponse> & { error?: string };
      if (!res.ok || !data.events) {
        setError(data.error ?? "That didn't work. Try again.");
        return;
      }
      if (data.events.length === 0) {
        setError("No event found in that image. Try a screenshot that shows the event's date and time.");
        return;
      }
      setRead(data as ReadResponse);
      setRows(data.events.map((e) => ({ ...e, include: true, attendeeIds: [], isPublic: false })));
      setPhase("review");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setReading(false);
    }
  }

  const patch = (key: string, change: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  function problem(r: Row): string | null {
    if (!r.title.trim()) return "Give it a title.";
    if (!r.date) return "Pick a date.";
    if (!r.allDay && (!r.startTime || !r.endTime)) return "Pick a start and end time.";
    if (`${r.endDate}T${r.endTime || "00:00"}` < `${r.date}T${r.startTime || "00:00"}`) return "It ends before it starts.";
    return null;
  }

  const kept = rows.filter((r) => r.include);
  const blocking = kept.find((r) => problem(r));

  async function create() {
    if (!read || blocking) return;
    setPhase("creating");
    const results: typeof made = [];
    for (const r of kept) {
      const start = r.allDay ? r.date : parseZonedDateTimeLocal(`${r.date}T${r.startTime}`, r.timezone)?.toISOString();
      const end = r.allDay ? r.endDate : parseZonedDateTimeLocal(`${r.endDate}T${r.endTime}`, r.timezone)?.toISOString();
      if (!start || !end) {
        results.push({ key: r.key, title: r.title, error: "Its time couldn't be read." });
        continue;
      }
      const description = [r.description, r.recurrence ? `Repeats: ${r.recurrence}` : null].filter(Boolean).join("\n\n");
      try {
        const result = await createEvent(orgId, {
          title: r.title.trim(),
          description: description || null,
          allDay: r.allDay,
          startsAt: start,
          endsAt: end,
          location: r.location,
          conferenceProvider: r.conferenceProvider,
          conferenceUrl: r.conferenceUrl,
          visibility: r.isPublic ? "PUBLIC" : "INTERNAL",
          attendeeIds: r.attendeeIds,
        });
        results.push({ key: r.key, title: r.title, eventId: result.eventId, error: result.error });
      } catch {
        results.push({ key: r.key, title: r.title, error: "It couldn't be added." });
      }
    }
    setMade(results);
    setPhase("done");
    router.refresh();
  }

  const added = made.filter((m) => m.eventId);
  const failed = made.filter((m) => m.error);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (phase === "creating") return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {phase === "done" ? "Added to the calendar" : "Add events from a screenshot"}
          </DialogTitle>
          <DialogDescription>
            {phase === "input"
              ? "A screenshot of an invite, an email, a calendar entry or a flyer. The AI reads the details, and you check them before anything is added."
              : phase === "done"
                ? "Here's what was added."
                : `Read by ${read?.readBy}. Check each event and fix what it got wrong.`}
          </DialogDescription>
        </DialogHeader>

        {phase === "input" && (
          <div className="min-h-0 space-y-3 overflow-y-auto">
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) pick(f);
              }}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => input.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  input.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) pick(f);
              }}
              className={cn(
                "hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-ring/50 relative grid min-h-48 cursor-pointer place-items-center overflow-hidden rounded-xl border-2 border-dashed p-4 text-center transition-colors outline-none focus-visible:ring-3",
                dragging && "border-primary bg-primary/10",
              )}
            >
              {preview ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the member's own file */}
                  <img src={preview} alt="Your screenshot" className="max-h-72 w-auto rounded-md object-contain shadow-sm" />
                  <button
                    type="button"
                    aria-label="Use another image"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      setPreview(null);
                    }}
                    className="bg-background/90 hover:bg-background absolute top-2 right-2 rounded-full border p-1 shadow-xs"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </>
              ) : (
                <div className="space-y-1.5">
                  <ImageUp className="text-muted-foreground mx-auto size-8" aria-hidden="true" />
                  <p className="text-sm font-medium">Drop a screenshot here, paste it, or click to choose</p>
                  <p className="text-muted-foreground text-xs">PNG, JPEG, WebP or GIF. Tip: Ctrl+V pastes a screenshot you just took.</p>
                </div>
              )}
            </div>
            <ConnectionPicker
              orgSlug={orgSlug}
              list={ai.list}
              failed={ai.failed}
              selected={ai.selected}
              onChoose={ai.setChoice}
              what="the screenshot"
            />
            {error && (
              <p role="alert" className="text-destructive flex items-start gap-1.5 text-sm">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
          </div>
        )}

        {(phase === "review" || phase === "creating") && read && (
          <div className="min-h-0 space-y-3 overflow-y-auto pe-1">
            {read.notes.length > 0 && (
              <div className="border-warning/40 bg-warning/10 rounded-lg border p-3 text-sm">
                <p className="font-medium">Worth a look</p>
                <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 ps-5 text-xs">
                  {read.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="space-y-2.5">
              {rows.map((r) => (
                <EventRow
                  key={r.key}
                  row={r}
                  members={read.members}
                  problem={r.include ? problem(r) : null}
                  onChange={(change) => patch(r.key, change)}
                />
              ))}
            </ul>
          </div>
        )}

        {phase === "done" && (
          <div className="min-h-0 space-y-3 overflow-y-auto">
            <div className="flex items-start gap-3 rounded-xl border p-4">
              <CheckCircle2 className="text-success mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div className="space-y-1.5 text-sm">
                <p className="font-medium">
                  {added.length === 0
                    ? "Nothing was added."
                    : `Added ${added.length} event${added.length === 1 ? "" : "s"}. Invited members were notified.`}
                </p>
                <ul className="space-y-0.5 text-xs">
                  {added.map((m) => (
                    <li key={m.key}>
                      <Link href={`/app/${orgSlug}/calendar/${m.eventId}`} className="text-primary underline underline-offset-2">
                        {m.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {failed.length > 0 && (
              <div className="border-destructive/30 space-y-1 rounded-xl border p-4 text-sm">
                <p className="font-medium">Not added</p>
                <ul className="space-y-1 text-xs">
                  {failed.map((f) => (
                    <li key={f.key}>
                      <span className="font-medium">{f.title}</span>: <span className="text-muted-foreground">{f.error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {phase === "input" && (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void readImage()} disabled={reading || !file || !ai.selected}>
                {reading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {reading ? "Reading…" : ai.selected ? `Read it with ${ai.selected.label}` : "Read it"}
              </Button>
            </>
          )}
          {(phase === "review" || phase === "creating") && (
            <>
              <Button type="button" variant="ghost" disabled={phase === "creating"} onClick={() => setPhase("input")}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back
              </Button>
              <Button type="button" onClick={() => void create()} disabled={phase === "creating" || kept.length === 0 || Boolean(blocking)}>
                {phase === "creating" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {kept.length === 1 ? "Add 1 event" : `Add ${kept.length} events`}
              </Button>
            </>
          )}
          {phase === "done" && (
            <>
              <Button type="button" variant="ghost" onClick={reset}>
                Add another
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventRow({
  row,
  members,
  problem,
  onChange,
}: {
  row: Row;
  members: ImportRosterMember[];
  problem: string | null;
  onChange: (change: Partial<Row>) => void;
}) {
  const invited = members.filter((m) => row.attendeeIds.includes(m.id));
  const addable = members.filter((m) => !row.attendeeIds.includes(m.id));
  return (
    <li
      className={cn(
        "bg-card space-y-2.5 rounded-xl border p-3 transition-opacity",
        !row.include && "opacity-55",
        problem && "border-destructive/50",
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox checked={row.include} onCheckedChange={(v) => onChange({ include: v === true })} aria-label={`Add “${row.title}”`} />
        <Input
          value={row.title}
          onChange={(e) => onChange({ title: e.target.value })}
          maxLength={200}
          aria-label="Title"
          className="h-8 min-w-0 flex-1 font-medium"
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)] gap-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_6.5rem] sm:items-end">
        <label className="space-y-1">
          <span className="text-muted-foreground text-xs">{row.allDay ? "First day" : "Starts"}</span>
          <Input
            type="date"
            value={row.date}
            onChange={(e) =>
              onChange({ date: e.target.value, endDate: row.endDate < e.target.value ? e.target.value : row.endDate })
            }
            className="h-8"
          />
        </label>
        {row.allDay ? (
          <span aria-hidden="true" />
        ) : (
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">At</span>
            <Input type="time" value={row.startTime} onChange={(e) => onChange({ startTime: e.target.value })} className="h-8" />
          </label>
        )}
        <label className="col-span-2 flex h-8 items-center gap-1.5 text-xs sm:col-span-1">
          <Checkbox
            checked={row.allDay}
            onCheckedChange={(v) =>
              onChange(v === true ? { allDay: true, startTime: "", endTime: "" } : { allDay: false, startTime: "18:00", endTime: "19:00" })
            }
          />
          All day
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground text-xs">{row.allDay ? "Last day" : "Ends"}</span>
          <Input type="date" value={row.endDate} onChange={(e) => onChange({ endDate: e.target.value })} className="h-8" />
        </label>
        {row.allDay ? (
          <span aria-hidden="true" />
        ) : (
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">At</span>
            <Input type="time" value={row.endTime} onChange={(e) => onChange({ endTime: e.target.value })} className="h-8" />
          </label>
        )}
        <label
          className="col-span-2 flex h-8 items-center gap-1.5 text-xs sm:col-span-1"
          title="Show it on your public site and feed"
        >
          <Checkbox checked={row.isPublic} onCheckedChange={(v) => onChange({ isPublic: v === true })} />
          Public
        </label>
      </div>
      {!row.allDay && (
        <p className="text-muted-foreground text-xs">Times in {row.timezone.replace(/_/g, " ")}.</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-muted-foreground text-xs">Where</span>
          <Input
            value={row.location ?? ""}
            onChange={(e) => onChange({ location: e.target.value || null })}
            maxLength={300}
            placeholder="Optional"
            className="h-8"
          />
        </label>
        <div className="space-y-1">
          <span className="text-muted-foreground text-xs">Invite</span>
          <div className="flex min-h-8 flex-wrap items-center gap-1">
            {invited.map((m) => (
              <span key={m.id} className="bg-muted inline-flex items-center gap-1 rounded-full py-0.5 ps-2 pe-1 text-xs">
                {m.name}
                <button
                  type="button"
                  aria-label={`Don't invite ${m.name}`}
                  onClick={() => onChange({ attendeeIds: row.attendeeIds.filter((id) => id !== m.id) })}
                  className="hover:bg-background rounded-full p-0.5"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            {addable.length > 0 && (
              <select
                className="border-input bg-background h-7 max-w-40 rounded-md border px-1.5 text-xs"
                value=""
                aria-label="Invite someone"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "*") onChange({ attendeeIds: members.map((m) => m.id) });
                  else if (v) onChange({ attendeeIds: [...row.attendeeIds, v] });
                }}
              >
                <option value="">+ Invite</option>
                <option value="*">Everyone</option>
                {addable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>
      <Textarea
        value={row.description ?? ""}
        onChange={(e) => onChange({ description: e.target.value || null })}
        rows={2}
        maxLength={2000}
        placeholder="Details (optional)"
        aria-label="Details"
        className="text-sm"
      />
      {(row.conferenceUrl || row.recurrence) && (
        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {row.conferenceUrl && (
            <span className="inline-flex items-center gap-1">
              <Video className="size-3.5" aria-hidden="true" />
              Video link found ({row.conferenceProvider === "MEET" ? "Google Meet" : row.conferenceProvider === "ZOOM" ? "Zoom" : "Teams"})
            </span>
          )}
          {row.recurrence && (
            <span className="inline-flex items-center gap-1">
              <Repeat className="size-3.5" aria-hidden="true" />
              Repeats {row.recurrence.toLowerCase()}: only this one is added
            </span>
          )}
        </div>
      )}
      {problem && (
        <p className="text-destructive flex items-center gap-1.5 text-xs">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          {problem}
        </p>
      )}
    </li>
  );
}
