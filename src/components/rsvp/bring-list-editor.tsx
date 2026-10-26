"use client";

import { Plus, Trash2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveBringList } from "@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

/**
 * The host's bring list: lines like "Chips" or "Help set up at 5", each
 * with how many people it needs. Saved as a whole; a line taken out takes
 * its claims with it, so the button says so when that would happen.
 */

export interface BringLine {
  id?: string;
  label: string;
  slots: number;
  /** Guests bringing it now (existing lines). */
  taken?: number;
}

const IDEAS = ["Snacks", "Drinks", "Speaker", "Help set up", "Help clean up"];

export function BringListEditor({
  orgId,
  eventId,
  initial,
}: {
  orgId: string;
  eventId: string;
  initial: BringLine[];
}) {
  const router = useRouter();
  const [lines, setLines] = useState<BringLine[]>(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(lines) !== JSON.stringify(initial);
  const dropped = initial.filter(
    (i) => i.id && (i.taken ?? 0) > 0 && !lines.some((l) => l.id === i.id),
  );

  function update(index: number, patch: Partial<BringLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function save() {
    const cleaned = lines
      .map((l) => ({ id: l.id, label: l.label.trim(), slots: l.slots }))
      .filter((l) => l.label);
    start(async () => {
      const result = await saveBringList(orgId, eventId, cleaned);
      if (result.error) {
        toast({ title: "Couldn't save the bring list", description: result.error });
        return;
      }
      toast({ title: "Bring list saved" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {lines.length > 0 && (
        <ul className="space-y-2">
          {lines.map((line, i) => (
            <li key={line.id ?? `new-${i}`} className="flex items-center gap-2">
              <Input
                aria-label={`Line ${i + 1}`}
                value={line.label}
                maxLength={80}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Chips, a speaker, help setting up…"
                className="min-w-0 flex-1"
              />
              <Input
                aria-label={`How many people for line ${i + 1}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                value={line.slots}
                onChange={(e) =>
                  update(i, {
                    slots: Math.max(1, Math.min(50, Number.parseInt(e.target.value, 10) || 1)),
                  })
                }
                className="w-20"
              />
              <span className="text-muted-foreground hidden w-24 text-xs sm:block">
                {line.taken ? `${line.taken} bringing` : line.slots > 1 ? "people" : "person"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${line.label || `line ${i + 1}`}`}
                onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLines((prev) => [...prev, { label: "", slots: 1 }])}
          disabled={lines.length >= 40}
        >
          <Plus aria-hidden="true" />
          Add a line
        </Button>
        {lines.length < 8 &&
          IDEAS.filter((idea) => !lines.some((l) => l.label.trim() === idea)).map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setLines((prev) => [...prev, { label: idea, slots: 1 }])}
              className="bg-muted hover:bg-muted-strong rounded-full px-2.5 py-1 text-xs font-medium"
            >
              + {idea}
            </button>
          ))}
        {dirty && (
          <Button size="sm" className="ms-auto" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save bring list"}
          </Button>
        )}
      </div>
      {dirty && dropped.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Removing {dropped.map((d) => `“${d.label}”`).join(", ")} also clears who said they&apos;d
          bring it.
        </p>
      )}
    </div>
  );
}
