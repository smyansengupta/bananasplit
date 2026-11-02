"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Check } from "@/components/icons";
import { MemberPicker, type EditorMember } from "@/components/org-chart/editor/member-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import {
  addPosition,
  confirmMember,
  setManager,
  toTree,
  type DraftPosition,
} from "@/lib/org-chart/draft";
import { membersOffChart, outlineOrder } from "@/lib/org-chart/outline";
import { reviewQuestions, type ReviewQuestion } from "@/lib/org-chart/quick";
import type { NamedTeam } from "@/lib/org-chart/teams";
import { descendantIds } from "@/lib/org-chart/tree";
import type { ChartNodeDTO, OpenItem } from "@/lib/org-chart/types";

import { useDraftSaver } from "./use-draft-saver";

const ChartCanvas = dynamic(() => import("../chart-canvas"), {
  ssr: false,
  loading: () => <p className="text-muted-foreground p-4 text-sm">Loading the chart…</p>,
});

/**
 * "Draft my chart", step two: the chart drafted from the members' titles,
 * the members not on it, a short list of things to check (only what the
 * drafting itself flagged: unconfirmed names and placements guessed from a
 * shared word in two titles), and Publish. "Edit by hand" opens the full
 * draft editor on the same draft.
 */

export interface ReviewMember extends EditorMember {
  role?: string;
}

const selectClass =
  "border-input bg-card h-9 w-full rounded-xl border px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

export function ReviewScreen({
  orgId,
  orgSlug,
  version,
  positions: initial,
  members,
  canSetTitles,
}: {
  orgId: string;
  orgSlug: string;
  version: {
    id: string;
    number: number;
    editVersion: number;
    openItems: OpenItem[];
    teams: NamedTeam[];
  };
  positions: DraftPosition[];
  members: ReviewMember[];
  canSetTitles: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [publishing, startPublish] = useTransition();
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [otherFor, setOtherFor] = useState<string | null>(null);
  const [adding, setAdding] = useState<{
    memberId: string;
    title: string;
    managerId: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** Published with a change that came in too late: stay, say so, edit nothing more. */
  const [published, setPublished] = useState(false);
  const locked = pending || publishing || published;

  const onRemap = (ids: Record<string, string>) => {
    const remap = (id: string) => ids[id] ?? id;
    setAnswered(
      (prev) =>
        new Set([...prev].map((k) => k.replace(/:(.*)$/, (_m, id: string) => `:${remap(id)}`))),
    );
    setAdding((a) => (a ? { ...a, managerId: remap(a.managerId) } : a));
  };
  const { positions, change, flush, publish, error } = useDraftSaver({
    orgId,
    version,
    initial,
    onRemap,
  });

  const byId = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const ordered = useMemo(() => outlineOrder(positions).map((o) => o.position), [positions]);
  const keyOfQuestion = (q: ReviewQuestion) => `${q.kind}:${q.positionId}`;
  const asked = useMemo(() => reviewQuestions(positions, members), [positions, members]);
  const questions = asked.filter((q) => !answered.has(keyOfQuestion(q)));
  const offChart = useMemo(() => membersOffChart(positions, members), [positions, members]);
  const advisors = positions.filter((p) => p.isAdvisor && (p.userId || p.personName));

  const personOf = (p: DraftPosition) =>
    (p.userId ? membersById.get(p.userId)?.name : null) ?? p.personName ?? p.title;

  const nodes: ChartNodeDTO[] = useMemo(
    () =>
      positions.map((p) => {
        const m = p.userId ? membersById.get(p.userId) : undefined;
        return {
          id: p.id,
          key: p.key || p.id,
          title: p.title || "Untitled position",
          personName: p.personName,
          userId: p.userId,
          user: m ? { id: m.id, name: m.name, image: m.image, avatar: m.avatar } : null,
          reportsToId: p.reportsTo,
          alsoReportsToIds: p.alsoReportsTo,
          isOpen: p.isOpen,
          isAdvisor: p.isAdvisor,
          responsibilities: p.responsibilities,
          decidesAlone: p.decidesAlone,
          rank: p.rank,
          teamId: p.teamId ?? null,
        };
      }),
    [positions, membersById],
  );

  const answer = (q: ReviewQuestion) => {
    setAnswered((prev) => new Set([...prev, keyOfQuestion(q)]));
    setOtherFor(null);
  };

  /** Who a position could report to: not itself, nobody below it, no advisor. */
  const managerOptions = (id: string) => {
    const below = descendantIds(toTree(positions), id);
    return ordered.filter((p) => p.id !== id && !below.has(p.id) && !p.isAdvisor);
  };

  const label = (p: DraftPosition) => {
    const who = p.userId ? membersById.get(p.userId)?.name : p.personName;
    return who ? `${who}, ${p.title}` : p.title;
  };

  const top = ordered.find((p) => p.reportsTo === null && !p.isAdvisor) ?? null;

  const addMember = () => {
    if (!adding) return;
    const member = membersById.get(adding.memberId);
    const title = adding.title.trim();
    if (!member || !title) return;
    const managerId = adding.managerId || null;
    change((current) => {
      const id = `new-${member.id}-${current.length}`;
      return addPosition(current, managerId, id).map((p) =>
        p.id === id
          ? {
              ...p,
              title,
              userId: member.id,
              personName: member.name,
              matchState: "CONFIRMED" as const,
              matchScore: 1,
            }
          : p,
      );
    });
    setAdding(null);
  };

  const onEditByHand = () =>
    startTransition(async () => {
      if (await flush()) router.push(`/app/${orgSlug}/org-chart/drafts/${version.id}`);
    });

  const onPublish = () =>
    startPublish(async () => {
      setStatus(null);
      const result = await publish(canSetTitles);
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      toast({ title: "Org chart published" });
      if (result.unsaved) {
        setPublished(true);
        setStatus(
          "Published. Your last change came in after publishing, so it isn't on the chart. Make it again with Edit chart.",
        );
        return;
      }
      router.push(`/app/${orgSlug}/people?view=chart`);
      router.refresh();
    });

  const lead =
    positions.length === 0
      ? "Nobody has a title yet, so nobody could be placed. Give people a position below, or edit by hand."
      : `We drafted your chart from your members' titles. ${
          questions.length === 0
            ? "It's ready to publish."
            : questions.length === 1
              ? "One question left and it's ready."
              : `${questions.length} questions left and it's ready.`
        }`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="page-title flex-1">Org chart</h1>
        <Badge variant="accent">Draft</Badge>
        {published ? (
          <Button type="button" onClick={() => router.push(`/app/${orgSlug}/people?view=chart`)}>
            Go to the chart
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" disabled={locked} onClick={onEditByHand}>
              Edit by hand
            </Button>
            <Button type="button" disabled={locked || positions.length === 0} onClick={onPublish}>
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          </>
        )}
      </header>

      <p className="display-title max-w-[40ch] text-2xl">{lead}</p>

      {(status || error) && (
        <p role="alert" className="text-destructive text-sm">
          {status ?? error}
        </p>
      )}

      <fieldset disabled={locked} className="flex min-w-0 flex-wrap items-start gap-5">
        <section
          aria-label="Drafted chart"
          className="bg-card edge rounded-card flex min-w-0 flex-[999_1_640px] flex-col overflow-hidden"
        >
          <div className="h-[440px]">
            {nodes.length === 0 ? (
              <p className="text-muted-foreground p-6 text-sm">Nobody is on the chart yet.</p>
            ) : (
              <ChartCanvas
                nodes={nodes}
                teams={version.teams}
                selectedId={questions[0]?.positionId ?? null}
                refitOnChange
                ariaLabel="The drafted chart"
              />
            )}
          </div>
          {offChart.length > 0 && (
            <div className="space-y-3 border-t px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold">Not on the chart</span>
                {offChart.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={adding?.memberId === m.id}
                    onClick={() =>
                      setAdding(
                        adding?.memberId === m.id
                          ? null
                          : { memberId: m.id, title: m.title ?? "", managerId: top?.id ?? "" },
                      )
                    }
                    className="bg-secondary hover:bg-muted-strong aria-pressed:bg-muted-strong focus-visible:outline-foreground inline-flex h-10 max-w-[14rem] min-w-0 items-center gap-2 rounded-full pr-3.5 pl-1 text-[13px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <UserAvatar user={m} size="sm" className="shrink-0" />
                    <span className="truncate">{m.name ?? "Unnamed member"}</span>
                  </button>
                ))}
                <span className="text-muted-foreground text-[12.5px]">
                  Members without a position. Tap one to give them a position.
                </span>
              </div>
              {adding && (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addMember();
                  }}
                >
                  <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs font-semibold">
                    {membersById.get(adding.memberId)?.name ?? "Their"} position
                    <Input
                      autoFocus
                      value={adding.title}
                      placeholder="Title, like Treasurer"
                      onChange={(e) => setAdding({ ...adding, title: e.target.value })}
                    />
                  </label>
                  <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs font-semibold">
                    Reports to
                    <select
                      className={selectClass}
                      value={adding.managerId}
                      onChange={(e) => setAdding({ ...adding, managerId: e.target.value })}
                    >
                      <option value="">Nobody (top of the chart)</option>
                      {ordered
                        .filter((p) => !p.isAdvisor)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {label(p)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Button type="submit" disabled={!adding.title.trim()}>
                    Add
                  </Button>
                </form>
              )}
            </div>
          )}
        </section>

        <aside
          aria-labelledby="check-these"
          className="bg-card edge rounded-card flex min-w-0 flex-[1_1_340px] flex-col gap-3.5 p-5"
        >
          <h2 id="check-these" className="heading text-[15px]">
            Check these
          </h2>

          {advisors.map((p) => {
            const manager = p.reportsTo ? byId.get(p.reportsTo) : undefined;
            return (
              <div key={p.id} className="bg-tint-success flex flex-col gap-1.5 rounded-2xl p-4">
                <span className="flex items-center gap-2">
                  <span className="bg-card text-tint-success-foreground grid size-5 place-items-center rounded-full">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                  <b className="text-[13.5px]">{personOf(p)} is an advisor</b>
                </span>
                <p className="text-muted-foreground text-[13px]">
                  Shown beside {manager ? `the ${manager.title}` : "the top of the chart"}, outside
                  the line of reporting.
                </p>
              </div>
            );
          })}

          {questions.map((q) => {
            const p = byId.get(q.positionId);
            if (!p) return null;
            const k = keyOfQuestion(q);
            return (
              <div key={k} className="bg-muted/60 flex flex-col gap-2.5 rounded-2xl p-4">
                {q.kind === "match" ? (
                  <p className="text-sm leading-relaxed">
                    The {p.title} is listed as <b>{p.personName}</b>. Is that{" "}
                    <b>{membersById.get(q.userId)?.name ?? "this member"}</b>?
                  </p>
                ) : (
                  <p className="text-sm leading-relaxed">
                    <b>{personOf(p)}</b> ({p.title}) is placed under{" "}
                    <b>{personOf(byId.get(q.managerId) ?? p)}</b>
                    {byId.get(q.managerId) ? ` (${byId.get(q.managerId)!.title})` : ""}. Is that
                    right?
                  </p>
                )}
                {otherFor === k ? (
                  q.kind === "match" ? (
                    <MemberPicker
                      members={members}
                      value={null}
                      suggestedIds={p.suggestedUserIds}
                      onSelect={(m) => {
                        change((current) =>
                          current.map((x) =>
                            x.id === p.id
                              ? { ...confirmMember(x, m.id, m.name), personName: m.name }
                              : x,
                          ),
                        );
                        answer(q);
                      }}
                    />
                  ) : (
                    <label className="flex flex-col gap-1 text-xs font-semibold">
                      Reports to
                      <select
                        className={selectClass}
                        value={p.reportsTo ?? ""}
                        onChange={(e) => {
                          const managerId = e.target.value || null;
                          change((current) => setManager(current, p.id, managerId));
                          answer(q);
                        }}
                      >
                        <option value="">Nobody (top of the chart)</option>
                        {managerOptions(p.id).map((m) => (
                          <option key={m.id} value={m.id}>
                            {label(m)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        if (q.kind === "match") {
                          const m = membersById.get(q.userId);
                          change((current) =>
                            current.map((x) =>
                              x.id === p.id ? confirmMember(x, q.userId, m?.name ?? null) : x,
                            ),
                          );
                        }
                        answer(q);
                      }}
                    >
                      Yes
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setOtherFor(k)}>
                      Something else
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          {questions.length === 0 && advisors.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {positions.length === 0 ? "Nothing to check yet." : "Nothing to check."}
            </p>
          )}

          {canSetTitles && positions.length > 0 && (
            <p className="text-muted-foreground border-t pt-3.5 text-[13px] leading-relaxed">
              Members&apos; profiles pick up their new titles when you publish.
            </p>
          )}
        </aside>
      </fieldset>
    </div>
  );
}
