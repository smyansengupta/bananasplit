"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { placeSelfAction, reviewPlacementAction } from "@/app/app/[orgSlug]/org-chart/actions";
import { Copy, UserPlus } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";

/**
 * "Ask everyone where they sit" on People's Org chart view: the question a
 * member answers (their best guess already picked, or a role that isn't
 * listed), and what the admin sees: how many have answered, the answers to
 * approve, and a link to send the rest.
 */

export interface PlaceOption {
  id: string;
  /** "Graphic Designer, under VP Growth". */
  label: string;
}

const NEW = "__new__";

export function SelfPlaceCard({
  orgId,
  versionId,
  options,
  guessId,
  managers,
}: {
  orgId: string;
  versionId: string;
  options: PlaceOption[];
  guessId: string | null;
  /** Who a new role could report to. */
  managers: PlaceOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState(guessId ?? options[0]?.id ?? NEW);
  const [adding, setAdding] = useState(options.length === 0);
  const [title, setTitle] = useState("");
  const [managerId, setManagerId] = useState(managers[0]?.id ?? "");

  const send = (payload: unknown) =>
    start(async () => {
      const result = await runAction(() => placeSelfAction(orgId, versionId, payload));
      if (!result) return;
      if (!result.ok) {
        toast({
          title: "error" in result ? result.error : "That didn't go through.",
          tone: "error",
        });
        return;
      }
      toast({ title: "Thanks. An admin will check it." });
      router.refresh();
    });

  return (
    <section aria-labelledby="sp-q" className="bg-card edge rounded-card flex flex-col gap-3.5 p-5">
      <h2 id="sp-q" className="heading text-lg">
        Where do you sit on the org chart?
      </h2>
      {adding ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) send({ title: title.trim(), managerId: managerId || null });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sp-title">Your role</Label>
              <Input
                id="sp-title"
                autoFocus
                value={title}
                maxLength={120}
                placeholder="Events Lead"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            {managers.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sp-manager">Under</Label>
                <Select value={managerId} onValueChange={setManagerId}>
                  <SelectTrigger id="sp-manager" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {managers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || !title.trim()}>
              Add my role
            </Button>
            {options.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Pick from the list
              </Button>
            )}
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sp-pos">Your position</Label>
            <Select
              value={choice}
              onValueChange={(v) => (v === NEW ? setAdding(true) : setChoice(v))}
            >
              <SelectTrigger id="sp-pos" className="w-full sm:max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={() => send({ positionId: choice })}>
              That&apos;s me
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(true)}>
              My role isn&apos;t listed
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export interface PendingAnswer {
  positionId: string;
  name: string;
  /** "Events Lead, under VP Ops and Programs". */
  label: string;
  added: boolean;
}

export function PlacementProgress({
  orgId,
  orgSlug,
  versionId,
  placed,
  total,
  pending: answers,
}: {
  orgId: string;
  orgSlug: string;
  versionId: string;
  placed: number;
  total: number;
  pending: PendingAnswer[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const first = answers[0];
  const waiting = Math.max(0, total - placed);

  const review = (approve: boolean) =>
    first &&
    start(async () => {
      const result = await runAction(() =>
        reviewPlacementAction(orgId, versionId, first.positionId, approve),
      );
      if (!result) return;
      if (!result.ok) {
        toast({
          title: "error" in result ? result.error : "That didn't go through.",
          tone: "error",
        });
        return;
      }
      router.refresh();
    });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/app/${orgSlug}/people?view=chart`,
      );
      toast({ title: "Link copied. Send it to the ones who haven't answered." });
    } catch {
      toast({ title: "Couldn't copy the link.", tone: "error" });
    }
  };

  return (
    <section aria-labelledby="sp-a" className="bg-card edge rounded-card flex flex-col gap-3.5 p-5">
      <div className="flex items-center gap-3">
        <h2 id="sp-a" className="heading flex-1 text-lg">
          {placed} of {total} have placed themselves
        </h2>
        <Badge variant="info">Org chart</Badge>
      </div>
      <div
        className="bg-muted h-2.5 overflow-hidden rounded-full"
        role="progressbar"
        aria-label="Members who have answered"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={placed}
      >
        <div
          className="h-full rounded-full bg-(--chart-1)"
          style={{ width: `${total ? Math.round((placed / total) * 100) : 0}%` }}
        />
      </div>
      {first && (
        <p className="flex items-start gap-3 text-sm leading-relaxed">
          <span className="bg-tint-accent text-tint-accent-foreground grid size-6 shrink-0 place-items-center rounded-full">
            <UserPlus className="size-3.5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="font-semibold">{first.name}</b>{" "}
            {first.added ? "added a role that isn't on the chart:" : "says they're"} {first.label}.
            {answers.length > 1 && (
              <span className="text-muted-foreground"> {answers.length - 1} more after this.</span>
            )}
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {first && (
          <>
            <Button type="button" disabled={busy} onClick={() => review(true)}>
              {first.added ? "Add it" : "Approve"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => review(false)}>
              Not right
            </Button>
          </>
        )}
        <Button asChild variant="outline">
          <Link href={`/app/${orgSlug}/org-chart/drafts/${versionId}`}>See the chart</Link>
        </Button>
        <span className="flex-1" />
        {waiting > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => void copyLink()}>
            <Copy aria-hidden="true" />
            Copy a link for the other {waiting}
          </Button>
        )}
      </div>
    </section>
  );
}
