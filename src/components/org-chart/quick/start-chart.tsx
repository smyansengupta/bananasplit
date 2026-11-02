"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startDraftAction } from "@/app/app/[orgSlug]/org-chart/actions";
import { DropZone } from "@/components/org-chart/drop-zone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { SHAPES, type ShapeId } from "@/lib/org-chart/shapes";
import { cn } from "@/lib/utils";

/**
 * The org chart's empty state for someone who can edit it (no published
 * chart, no open draft): three ways in. "Draft my chart" drafts from the
 * members' titles and opens the review; a shape opens the seat screen; a
 * dropped file or pasted text goes through the existing import.
 */

export interface StartPreviewPerson {
  id: string;
  name: string | null;
  image: string | null;
  avatar: unknown;
  title: string;
}

const card = "bg-card edge rounded-card flex min-w-0 flex-col gap-3.5 p-6";

function MiniNode({ person }: { person: StartPreviewPerson }) {
  return (
    <span className="bg-card flex max-w-[11rem] items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
      <UserAvatar user={person} size="xs" />
      <b className="truncate font-semibold">{person.title}</b>
    </span>
  );
}

function ShapeIcon({ id }: { id: ShapeId }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (id === "committees")
    return (
      <svg {...common}>
        <rect x="3" y="4" width="5" height="16" rx="1.5" />
        <rect x="9.5" y="4" width="5" height="16" rx="1.5" />
        <rect x="16" y="4" width="5" height="16" rx="1.5" />
      </svg>
    );
  if (id === "team")
    return (
      <svg {...common}>
        <rect x="9" y="3" width="6" height="5" rx="1.5" />
        <path d="M12 8v5" />
        <rect x="3" y="13" width="18" height="7" rx="2" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="9" y="3" width="6" height="5" rx="1.5" />
      <rect x="2" y="16" width="6" height="5" rx="1.5" />
      <rect x="9" y="16" width="6" height="5" rx="1.5" />
      <rect x="16" y="16" width="6" height="5" rx="1.5" />
      <path d="M12 8v4M5 16v-4h14v4" />
    </svg>
  );
}

export function StartChart({
  orgId,
  orgSlug,
  memberCount,
  preview,
}: {
  orgId: string;
  orgSlug: string;
  memberCount: number;
  /** The top of the chart drafting would make: its head first, then up to three below. */
  preview: StartPreviewPerson[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/app/${orgSlug}/org-chart/drafts`;

  const start = (from: "members" | ShapeId) =>
    startTransition(async () => {
      setError(null);
      setBusy(from);
      const result = await startDraftAction(orgId, from);
      if (result.ok && "versionId" in result) {
        router.push(`${base}/${result.versionId}/${from === "members" ? "review" : "seats"}`);
        return;
      }
      setBusy(null);
      setError("error" in result ? result.error : "The draft couldn't be started.");
    });

  const [head, ...below] = preview;

  return (
    <div className="space-y-6">
      <p className="display-title max-w-[30ch] text-[26px]">
        Your org chart can be ready in a minute. Pick how to start.
      </p>

      <div className="flex flex-wrap items-stretch gap-4">
        <section
          aria-labelledby="start-members"
          className={cn(card, "outline-primary flex-[1.25_1_380px] outline-2")}
        >
          {head && (
            <div
              aria-hidden="true"
              className="bg-tint-info flex flex-col items-center gap-2.5 rounded-2xl p-4"
            >
              <MiniNode person={head} />
              {below.length > 0 && (
                <>
                  <span className="bg-tint-info-foreground/35 h-2.5 w-0.5" />
                  <span className="flex flex-wrap justify-center gap-2">
                    {below.map((p) => (
                      <MiniNode key={p.id} person={p} />
                    ))}
                  </span>
                </>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <h2 id="start-members" className="display-title flex-1 text-[21px]">
              Draft it from your members
            </h2>
            <Badge variant="info">Fastest</Badge>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">
            We place your {memberCount} {memberCount === 1 ? "member" : "members"} using the titles
            they already have, and ask you about anyone we&apos;re not sure of.
          </p>
          <Button
            type="button"
            className="mt-auto self-start"
            disabled={pending}
            onClick={() => start("members")}
          >
            {busy === "members" ? "Drafting…" : "Draft my chart"}
          </Button>
        </section>

        <section aria-labelledby="start-shape" className={cn(card, "flex-[1_1_300px]")}>
          <h2 id="start-shape" className="display-title text-[21px]">
            Start from a shape
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Pick the one closest to yours, then drop people into the seats.
          </p>
          {SHAPES.map((shape) => (
            <button
              key={shape.id}
              type="button"
              disabled={pending}
              onClick={() => start(shape.id)}
              className="bg-muted/60 hover:bg-muted focus-visible:outline-foreground flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left text-[13.5px] font-semibold transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
            >
              <span className="bg-card grid size-[30px] shrink-0 place-items-center rounded-full">
                <ShapeIcon id={shape.id} />
              </span>
              {busy === shape.id ? "Opening…" : shape.label}
            </button>
          ))}
        </section>

        <section aria-labelledby="start-bring" className={cn(card, "flex-[1_1_300px]")}>
          <h2 id="start-bring" className="display-title text-[21px]">
            Bring what you have
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            A document with your roles. We turn it into a chart you can check.
          </p>
          <DropZone orgId={orgId} orgSlug={orgSlug} variant="tile" disabled={pending} />
        </section>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
