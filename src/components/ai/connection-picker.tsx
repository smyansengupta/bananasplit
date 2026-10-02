"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { listAiConnectionsAction } from "@/app/app/[orgSlug]/_shell/ai-actions";
import type { AiConnectionId, AiConnectionInfo } from "@/lib/ai/types";

/**
 * Which connected model reads the import, and where the data goes. Loaded
 * when a dialog opens (labels only; keys never reach the browser).
 */
export function useAiConnections(orgId: string, active: boolean) {
  const [list, setList] = useState<AiConnectionInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState<AiConnectionId | null>(null);
  useEffect(() => {
    if (!active || list) return;
    let live = true;
    listAiConnectionsAction(orgId)
      .then((found) => {
        if (!live) return;
        setList(found);
        setChoice((c) => c ?? found[0]?.id ?? null);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [active, list, orgId]);
  const selected = list?.find((c) => c.id === choice) ?? list?.[0] ?? null;
  return { list, failed, selected, setChoice };
}

export function ConnectionPicker({
  orgSlug,
  list,
  failed,
  selected,
  onChoose,
  what,
  sendsRoster = false,
}: {
  orgSlug: string;
  list: AiConnectionInfo[] | null;
  failed: boolean;
  selected: AiConnectionInfo | null;
  onChoose: (id: AiConnectionId) => void;
  /** "your list", "the screenshot": for the privacy line. */
  what: string;
  /** Whether members' names and titles go along (to suggest owners). */
  sendsRoster?: boolean;
}) {
  if (failed) {
    return <p className="text-destructive text-xs">Couldn&apos;t check which AI models are connected. Try again.</p>;
  }
  if (!list) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Checking which AI model is connected…
      </p>
    );
  }
  if (list.length === 0) {
    return (
      <div className="bg-muted/60 rounded-lg border p-3 text-sm">
        <p className="font-medium">No AI model is connected yet.</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          An owner or admin can connect Claude, OpenAI, Gemini or another model in{" "}
          <Link href={`/app/${orgSlug}/settings/integrations`} className="text-primary underline underline-offset-2">
            Settings › Integrations
          </Link>
          . The club&apos;s own key pays for it.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {list.length > 1 ? (
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Read with</span>
            <select
              className="border-input bg-background h-8 rounded-md border px-2 text-sm"
              value={selected?.id}
              onChange={(e) => onChoose(e.target.value as AiConnectionId)}
            >
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.detail})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span>
            <span className="text-muted-foreground">Read with </span>
            <span className="font-medium">{selected?.label}</span>
            <span className="text-muted-foreground"> · {selected?.detail}</span>
          </span>
        )}
      </div>
      <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {what[0].toUpperCase() + what.slice(1)} goes to {selected?.sentTo} to be read
          {sendsRoster ? ", with members' names and titles so it can suggest owners" : ""}. Nothing is saved until you
          add it, and Bananasplit doesn&apos;t keep a copy.
        </span>
      </p>
    </div>
  );
}
