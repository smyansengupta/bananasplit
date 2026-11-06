"use client";

import { Sparkles } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  acceptSuggestionAction,
  findDetailsAction,
  rejectSuggestionAction,
} from "@/app/app/[orgSlug]/crm/ai-actions";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";

import { CardPanel, useCardPanel } from "./card-panel";

/**
 * Find their details (docs/features/crm.md, enrichment): from a person's or
 * company's "…", the organization's enrichment order (Hunter, Prospeo,
 * Tavily, Claude web search; Settings, AI) runs once, and what it found
 * shows in a panel over the card as one suggestion: each field with what
 * it would become, Use these or Leave it. Nothing changes until you accept.
 * Offered only when a data connector or an AI connection is set up.
 */

type Change = { field: string; label: string; before: string | null; after: string };
type State =
  | { stage: "looking" }
  | { stage: "found"; changes: Change[]; suggestionId: string | null; from: string | null }
  | { stage: "nothing"; tried: string }
  | { stage: "failed"; error: string };

export function useFindDetails({
  orgId,
  kind,
  id,
  name,
}: {
  orgId: string;
  kind: "person" | "company";
  id: string;
  name: string;
}) {
  const router = useRouter();
  const { anchor, host, back, show, hide } = useCardPanel();
  const [state, setState] = useState<State>({ stage: "looking" });
  const [busy, setBusy] = useState(false);

  const find = async () => {
    setState({ stage: "looking" });
    show();
    const r = await findDetailsAction(orgId, kind, id).catch(() => null);
    if (!r) return setState({ stage: "failed", error: "That didn't work. Try again." });
    if (!r.ok) return setState({ stage: "failed", error: r.error });
    if (!r.changes || r.changes.length === 0) {
      const tried = r.tried
        .filter((t) => t.result !== "skipped")
        .map((t) =>
          t.step === "claude" ? "Claude web search" : t.step[0]!.toUpperCase() + t.step.slice(1),
        );
      return setState({ stage: "nothing", tried: tried.join(", ") });
    }
    setState({
      stage: "found",
      changes: r.changes,
      suggestionId: r.suggestionId ?? null,
      from: r.providerLabel ?? null,
    });
  };

  const decide = async (accept: boolean) => {
    if (state.stage !== "found" || !state.suggestionId) return hide();
    setBusy(true);
    const r = accept
      ? await acceptSuggestionAction(orgId, state.suggestionId).catch(() => null)
      : await rejectSuggestionAction(orgId, state.suggestionId).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't work. Try again.", tone: "error" });
      return;
    }
    if (accept) toast({ title: `Updated ${name}.` });
    hide();
    router.refresh();
  };

  const item = (
    <DropdownMenuItem onSelect={() => void find()}>
      <Sparkles className="size-4" aria-hidden="true" />
      {kind === "person" ? "Find their details" : "Find its details"}
    </DropdownMenuItem>
  );

  const panel = (
    <>
      <span ref={anchor} hidden />
      {host && (
        <CardPanel
          host={host}
          title={kind === "person" ? "Their details" : "Its details"}
          subtitle={
            state.stage === "found" && state.from
              ? `Found by ${state.from}. Nothing changes until you accept.`
              : `Looked up with your organization's data connectors.`
          }
          label={`Details found for ${name}`}
          onClose={hide}
          returnFocus={back}
        >
          <div className="space-y-4 px-6 py-5 max-sm:px-4">
            {state.stage === "looking" && (
              <p className="text-muted-foreground text-sm" role="status">
                Looking {name} up…
              </p>
            )}
            {state.stage === "failed" && (
              <p className="text-destructive text-sm" role="alert">
                {state.error}
              </p>
            )}
            {state.stage === "nothing" && (
              <p className="text-muted-foreground text-sm" role="status">
                Nothing new{state.tried ? ` from ${state.tried}` : ""}. What&apos;s on the card is
                all we have.
              </p>
            )}
            {state.stage === "found" && (
              <>
                <dl className="divide-border/60 divide-y text-sm">
                  {state.changes.map((c) => (
                    <div key={c.field} className="flex flex-wrap gap-x-3 gap-y-0.5 py-2.5">
                      <dt className="text-muted-foreground w-24 shrink-0">{c.label}</dt>
                      <dd className="min-w-0 flex-1 break-words">
                        {c.before && (
                          <span className="text-muted-foreground me-2 line-through">
                            {c.before}
                          </span>
                        )}
                        <b>{c.after}</b>
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" disabled={busy} onClick={() => void decide(false)}>
                    Leave it
                  </Button>
                  <Button disabled={busy} onClick={() => void decide(true)}>
                    Use these
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardPanel>
      )}
    </>
  );

  return { item, panel };
}
