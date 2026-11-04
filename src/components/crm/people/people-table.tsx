"use client";

import { MoreHorizontal } from "@/components/icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { bulkUpdateAction, restoreAction, trashAction, undoAction } from "@/app/app/[orgSlug]/crm/actions";
import {
  addToListAction,
  removeFromListAction,
  setNextStepAction,
} from "@/app/app/[orgSlug]/crm/people-actions";
import { AMBIENT_BUTTON, AmbientButton, AmbientWhy } from "@/components/ambient/ambient-button";
import { CrmAvatar } from "@/components/crm/card/crm-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { EmptyState } from "@/components/empty-state";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { stageTone } from "@/lib/crm/deals-tab";
import { hrefWithOpen, OPEN_PARAM, type CrmOpen } from "@/lib/crm/overlay";
import type { RowNext } from "@/lib/crm/people-view";
import { runAction } from "@/lib/run-action";
import { tagVar } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";

import { SeriesDialog } from "./series-dialog";

/**
 * People's table (People.dc.html; docs/features/crm.md, "One list"):
 * "{list} {count}" above it (with "$X in open deals" when a deal filter
 * is on), a row per person (or company) that opens its card (?open=), the
 * relationship as a tinted pill, strength as four bars, their open deal's
 * stage and value (the most advanced, "+1" when there are more), and the
 * next step as one ambient button with its reason beside it. Pick rows for
 * the selection bar: Start a deal, Add to list, Change owner, Email them,
 * and "…" with Add to a follow-up series, Merge (two picked), Export and
 * Move to trash. Every bulk change has Undo.
 */

export interface PeopleRow {
  id: string;
  name: string;
  sub: string | null;
  rel: { label: string; tone: string | null } | null;
  bars: number;
  strength: number;
  last: string;
  next: RowNext;
  mergeWith: string | null;
  owner: string | null;
  deleted: boolean;
  deal: {
    id: string;
    title: string;
    stage: string;
    stageKind: "OPEN" | "WON" | "LOST";
    openIndex: number;
    amount: string | null;
    more: number;
  } | null;
}

type Kind = "person" | "company";

/** "{list} {count}", and "$X in open deals" when there's money to show. */
export function PeopleHeading({
  name,
  total,
  money,
  children,
}: {
  name: string;
  total: number;
  money: { text: string; label: string } | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 px-1">
      <b className="heading text-lg">{name}</b>
      <span className="bg-muted grid h-7 min-w-7 place-items-center rounded-full px-2 text-sm font-semibold tabular-nums">
        {total.toLocaleString("en-US")}
      </span>
      {money && (
        <span className="text-muted-foreground text-[15px] tabular-nums">
          {money.text} {money.label}
        </span>
      )}
      {children}
    </div>
  );
}

export function PeopleTable({
  orgId,
  orgSlug,
  companies,
  rows,
  total,
  page,
  pageSize,
  listId,
  listName,
  money,
  dealsOn,
  trash,
  pickedLists,
  members,
  series,
  personal = false,
}: {
  orgId: string;
  orgSlug: string;
  companies: boolean;
  rows: PeopleRow[];
  total: number;
  page: number;
  pageSize: number;
  listId: string;
  listName: string;
  money: { text: string; label: string } | null;
  /** A deal filter is on (only those with a matching deal are listed). */
  dealsOn: boolean;
  trash: boolean;
  /** The organization's hand-picked lists (Add to list adds to these). */
  pickedLists: { id: string; label: string }[];
  members: { id: string; name: string }[];
  /** Follow-up series that are on. */
  series: { id: string; name: string }[];
  /** A Personal space: one person owns everything, so no Owner column or Change owner. */
  personal?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const { hrefFor } = useCrmOpen();
  const kind: Kind = companies ? "company" : "person";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState<null | "list" | "email">(null);
  const [enrolling, setEnrolling] = useState<string[] | null>(null);

  // New rows (a page, a filter, a refresh): nothing stays picked.
  const [shown, setShown] = useState(rows);
  if (shown !== rows) {
    setShown(rows);
    setSelected(new Set());
  }

  const picked = rows.filter((r) => selected.has(r.id));
  const ids = picked.map((r) => r.id);
  const refresh = () => router.refresh();
  const clear = () => setSelected(new Set());

  /** This page with `patch` applied to its params (and `open` set or kept). */
  const hrefWith = (patch: Record<string, string | null>, open?: CrmOpen | string | null) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    if (open !== undefined) return hrefWithOpen(pathname, next, open);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const withUndo = (title: string, batchId: string) =>
    toast({
      title,
      action: {
        label: "Undo",
        run: async () => {
          const u = await runAction(() => undoAction(orgId, batchId));
          refresh();
          return u && !u.ok ? u.error : undefined;
        },
      },
    });

  const changeOwner = async (ownerId: string | null, label: string) => {
    const r = await runAction(() =>
      bulkUpdateAction(orgId, kind, ids, { ownerId, ownerRoleKey: null }),
    );
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    withUndo(`${label} owns ${r.changed === 1 ? "them" : `these ${r.changed}`} now.`, r.batchId);
    clear();
    refresh();
  };

  const moveToTrash = async () => {
    const r = await runAction(() => trashAction(orgId, kind, ids));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    withUndo(`Moved ${r.count} to the trash.`, r.batchId);
    clear();
    refresh();
  };

  const restore = async () => {
    const r = await runAction(() => restoreAction(orgId, kind, ids));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: `Restored ${r.count}.` });
    clear();
    refresh();
  };

  const addToList = async (target: { viewId: string } | { name: string }) => {
    const r = await runAction(() => addToListAction(orgId, target, ids));
    if (!r) return null;
    if (!r.ok) {
      toast({ title: r.error, tone: "error" });
      return null;
    }
    return r;
  };

  /**
   * One email to the picked people: one person opens their card (its
   * composer); several are kept as a list and the one-email card opens over
   * People with it (?open=plan:email&to=), where Send is the OK.
   */
  const emailThem = async (name: string) => {
    if (ids.length === 1) {
      router.push(hrefFor({ kind: "person", id: ids[0]! }), { scroll: false });
      return;
    }
    const r = await addToList({ name });
    if (r) router.push(hrefWith({ to: r.id }, { kind: "plan", type: "email", id: null }), { scroll: false });
  };

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const filtered = Boolean(
    listId || trash || dealsOn || params.get("q") || params.get("owner") || params.get("rel"),
  );
  const settingsHref = `/app/${orgSlug}/crm/settings/automations`;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PeopleHeading name={listName} total={total} money={money}>
        {(listId || trash) && (
          <Link
            href={hrefWith({ list: null, trash: null, page: null })}
            scroll={false}
            className={cn(AMBIENT_BUTTON, OUTLINE)}
          >
            Show everyone
          </Link>
        )}
      </PeopleHeading>

      {picked.length > 0 && (
        <div
          role="toolbar"
          aria-label="Change the picked ones"
          className="bg-card ring-foreground/6 flex flex-wrap items-center gap-2 rounded-full py-2 ps-5 pe-2 ring-1"
        >
          <b className="me-1 text-sm tabular-nums">{picked.length} selected</b>
          {trash ? (
            <Button size="sm" variant="outline" className="rounded-full" onClick={restore}>
              Restore
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" className="rounded-full" asChild>
                <Link
                  scroll={false}
                  href={hrefWith(
                    { with: `${kind}:${ids.slice(0, 20).join(",")}` },
                    { kind: "new", what: "deal" },
                  )}
                >
                  Start a deal
                </Link>
              </Button>
              {!companies && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="rounded-full">
                      Add to list
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 w-60 overflow-y-auto">
                    {pickedLists.map((l) => (
                      <DropdownMenuItem
                        key={l.id}
                        onSelect={async () => {
                          const before = ids;
                          const r = await addToList({ viewId: l.id });
                          if (!r) return;
                          toast({
                            title: r.added ? `Added ${r.added} to ${r.name}.` : `They're on ${r.name} already.`,
                            action: r.added
                              ? {
                                  label: "Undo",
                                  run: async () => {
                                    await runAction(() => removeFromListAction(orgId, l.id, before));
                                    refresh();
                                  },
                                }
                              : undefined,
                          });
                          clear();
                          refresh();
                        }}
                      >
                        {l.label}
                      </DropdownMenuItem>
                    ))}
                    {pickedLists.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={() => setNaming("list")}>A new list</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {!personal && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="rounded-full">
                    Change owner
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
                  {members.map((m) => (
                    <DropdownMenuItem key={m.id} onSelect={() => void changeOwner(m.id, m.name)}>
                      {m.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void changeOwner(null, "Nobody")}>
                    Nobody
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              )}
              {!companies && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => (ids.length === 1 ? void emailThem("") : setNaming("email"))}
                >
                  Email them
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-8 rounded-full"
                    aria-label="More: follow-up series, merge, export, move to trash"
                    title="Follow-up series, merge, export, move to trash"
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60">
                  {!companies && (
                    <DropdownMenuItem onSelect={() => setEnrolling(ids)}>
                      Add to a follow-up series
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    disabled={ids.length !== 2}
                    onSelect={() =>
                      router.push(hrefFor({ kind: "merge", ids: [ids[0]!, ids[1]!] }), { scroll: false })
                    }
                  >
                    {ids.length === 2 ? "Merge" : "Merge (pick two)"}
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a
                      href={`/app/${orgSlug}/crm/export?kind=${companies ? "companies" : "people"}&ids=${ids.join(",")}`}
                    >
                      Export
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onSelect={() => void moveToTrash()}>
                    Move to trash
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          <span className="flex-1" aria-hidden="true" />
          <Button size="sm" variant="ghost" className="rounded-full" onClick={clear}>
            Clear
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={
            trash
              ? "The trash is empty"
              : filtered
                ? `Nobody matches${listId ? ` in ${listName}` : ""}`
                : companies
                  ? "No companies yet"
                  : "Nobody here yet"
          }
          description={
            trash
              ? undefined
              : filtered
                ? "Try another list or filter, or clear the search."
                : companies
                  ? "A company is added with its first person, or from New company."
                  : undefined
          }
        />
      ) : (
        <div className="bg-card ring-foreground/6 overflow-x-auto rounded-[22px] ring-1">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-muted-foreground border-border/70 border-b text-left text-[13px]">
                <th className="w-12 py-3 ps-5 pe-1">
                  <Checkbox
                    aria-label="Select all"
                    checked={selected.size === rows.length && rows.length > 0}
                    onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
                <th className="px-3 py-3 font-semibold">Name</th>
                {!companies && <th className="px-3 py-3 font-semibold max-lg:hidden">Relationship</th>}
                <th className="px-3 py-3 font-semibold max-md:hidden">Strength</th>
                <th className="px-3 py-3 font-semibold max-md:hidden">Last talked</th>
                <th className="px-3 py-3 font-semibold max-xl:hidden">Stage</th>
                <th className="px-3 py-3 text-right font-semibold max-xl:hidden">Deal value</th>
                <th className={cn("px-3 py-3 font-semibold max-sm:hidden", personal && "pe-5")}>Next step</th>
                {!personal && <th className="px-3 py-3 pe-5 font-semibold max-lg:hidden">Owner</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOn = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-border/60 border-b last:border-0",
                      isOn ? "bg-muted/70" : "hover:bg-muted/40",
                      r.deleted && "opacity-70",
                    )}
                  >
                    <td className="py-3 ps-5 pe-1">
                      <Checkbox
                        aria-label={`Select ${r.name}`}
                        checked={isOn}
                        onCheckedChange={(v) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (v) n.add(r.id);
                            else n.delete(r.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={hrefFor({ kind, id: r.id })}
                        scroll={false}
                        className="flex min-w-0 items-center gap-3"
                      >
                        <span className={companies ? "[&>span]:!rounded-[12px]" : undefined}>
                          <CrmAvatar name={r.name} size={38} />
                        </span>
                        <span className="min-w-0">
                          <b className="block max-w-72 truncate font-semibold hover:underline">{r.name}</b>
                          {r.sub && (
                            <span className="text-muted-foreground block max-w-72 truncate text-[13px]">
                              {r.sub}
                            </span>
                          )}
                        </span>
                      </Link>
                    </td>
                    {!companies && (
                      <td className="px-3 py-3 max-lg:hidden">{r.rel && <RelationshipPill rel={r.rel} />}</td>
                    )}
                    <td className="px-3 py-3 max-md:hidden">
                      <span
                        className="flex items-center gap-[3px]"
                        role="img"
                        aria-label={`Strength ${r.bars} of 4`}
                        title={`Strength ${r.strength} of 100`}
                      >
                        {[1, 2, 3, 4].map((i) => (
                          <span
                            key={i}
                            className={cn(
                              "h-4 w-1.5 rounded-[3px]",
                              i <= r.bars ? "bg-foreground" : "bg-foreground/12",
                            )}
                          />
                        ))}
                      </span>
                    </td>
                    <td className="text-muted-foreground px-3 py-3 whitespace-nowrap max-md:hidden">
                      {r.last}
                    </td>
                    <td className="px-3 py-3 max-xl:hidden">
                      {r.deal && (
                        <Link
                          href={hrefFor({ kind: "deal", id: r.deal.id })}
                          scroll={false}
                          title={r.deal.title}
                          className="inline-flex max-w-48 items-center gap-1.5 text-sm font-semibold whitespace-nowrap hover:underline"
                        >
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: stageTone(r.deal.stageKind, r.deal.openIndex) }}
                          />
                          <span className="min-w-0 truncate">{r.deal.stage}</span>
                          {r.deal.more > 0 && (
                            <span
                              className="text-muted-foreground shrink-0 text-xs font-medium"
                              title={`${r.deal.more} more ${r.deal.more === 1 ? "deal" : "deals"}`}
                            >
                              +{r.deal.more}
                            </span>
                          )}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap tabular-nums max-xl:hidden">
                      {r.deal?.amount ?? ""}
                    </td>
                    <td className="px-3 py-3 max-sm:hidden">
                      <NextStep
                        orgId={orgId}
                        kind={kind}
                        row={r}
                        open={(o) => hrefFor(o)}
                        quoteHref={(id) => hrefWith({ tab: "quote" }, { kind: "deal", id })}
                        disabled={trash || r.deleted}
                      />
                    </td>
                    {!personal && (
                      <td className="px-3 py-3 pe-5 max-lg:hidden">
                        {r.owner ? (
                          <span title={r.owner} className="inline-flex">
                            <CrmAvatar name={r.owner} size={30} />
                            <span className="sr-only">{r.owner}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">Nobody</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > pageSize && (
        <div className="text-muted-foreground flex items-center justify-between px-1 text-sm">
          <span>
            {((page - 1) * pageSize + 1).toLocaleString("en-US")} to{" "}
            {Math.min(total, page * pageSize).toLocaleString("en-US")} of {total.toLocaleString("en-US")}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} asChild={page > 1}>
              {page > 1 ? (
                <Link href={hrefWith({ page: page - 1 > 1 ? String(page - 1) : null, [OPEN_PARAM]: null })}>
                  Back
                </Link>
              ) : (
                <span>Back</span>
              )}
            </Button>
            <Button size="sm" variant="outline" disabled={page * pageSize >= total} asChild={page * pageSize < total}>
              {page * pageSize < total ? (
                <Link href={hrefWith({ page: String(page + 1), [OPEN_PARAM]: null })}>Next</Link>
              ) : (
                <span>Next</span>
              )}
            </Button>
          </span>
        </div>
      )}

      <NameDialog
        open={naming !== null}
        title={naming === "email" ? `Email ${picked.length} people` : "A new list"}
        description={
          naming === "email"
            ? "They're saved as a list, so the email goes to exactly these people. Name it for later."
            : `${picked.length === 1 ? "This person goes" : `These ${picked.length} go`} on it. Add more any time from People.`
        }
        initial={naming === "email" ? `${picked.length} people, ${today}` : ""}
        action={naming === "email" ? "Write the email" : "Make the list"}
        onClose={() => setNaming(null)}
        onSave={async (name) => {
          if (naming === "email") {
            await emailThem(name);
            setNaming(null);
            return;
          }
          const r = await addToList({ name });
          if (!r) return;
          setNaming(null);
          toast({ title: `${r.name} has ${r.added} ${r.added === 1 ? "person" : "people"}. It's under Lists in Filters.` });
          clear();
          refresh();
        }}
      />
      {enrolling && (
        <SeriesDialog
          orgId={orgId}
          personIds={enrolling}
          series={series}
          settingsHref={settingsHref}
          onClose={() => setEnrolling(null)}
          onDone={() => {
            clear();
            refresh();
          }}
        />
      )}
    </div>
  );
}

const OUTLINE =
  "bg-transparent text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-current/8";

/** A relationship as a pill tinted its own colour, with a dot. */
export function RelationshipPill({ rel }: { rel: { label: string; tone: string | null } }) {
  const color = rel.tone ? tagVar(rel.tone) : "var(--muted-foreground)";
  return (
    <span
      className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold whitespace-nowrap"
      style={{
        background: rel.tone ? `color-mix(in oklab, ${color} 14%, var(--card))` : "var(--muted)",
        color: rel.tone ? color : "var(--foreground)",
      }}
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      {rel.label}
    </span>
  );
}

/** The next-step cell: one ambient button with its reason beside it, or the next step in words. */
function NextStep({
  orgId,
  kind,
  row,
  open,
  quoteHref,
  disabled,
}: {
  orgId: string;
  kind: Kind;
  row: PeopleRow;
  open: (o: CrmOpen) => string;
  /** The deal's card, opened on its quote. */
  quoteHref: (dealId: string) => string;
  disabled: boolean;
}) {
  const [done, setDone] = useState<string | null>(null);
  const a = row.next.action;
  if (done) return <span className="text-muted-foreground text-sm">{done}</span>;
  if (!a || disabled) {
    if (!row.next.text) return null;
    const quiet = row.next.text === "None yet";
    return <span className={cn("text-sm", quiet && "text-muted-foreground")}>{row.next.text}</span>;
  }
  let node: ReactNode;
  if (a.kind === "add") {
    node = (
      <AmbientButton
        action={{
          key: "add",
          label: a.label,
          tone: a.tone,
          reason: a.reason,
          ariaLabel: `Add a next step for ${row.name}`,
          run: async () => {
            const r = await setNextStepAction(orgId, kind, row.id, 7);
            if (r.ok) {
              const at = new Date(r.at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
              setDone(`Next step: follow up, ${at}`);
            }
            return r;
          },
        }}
      />
    );
  } else {
    const href =
      a.kind === "merge" && row.mergeWith
        ? open({ kind: "merge", ids: [row.id, row.mergeWith] })
        : a.kind === "quote" && a.dealId
          ? quoteHref(a.dealId)
          : a.kind === "deal-step" && a.dealId
            ? open({ kind: "deal", id: a.dealId })
            : open({ kind, id: row.id });
    node = (
      <AmbientButton
        action={{
          key: a.kind,
          label: a.label,
          tone: a.tone,
          reason: a.reason,
          href,
          ariaLabel: `${a.label} ${row.name}`,
        }}
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-2">
      {node}
      <AmbientWhy className="min-w-0 truncate whitespace-nowrap">{a.reason}</AmbientWhy>
    </div>
  );
}

function NameDialog({
  open,
  title,
  description,
  initial,
  action,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  description: string;
  initial: string;
  action: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [seen, setSeen] = useState(open);
  const [busy, setBusy] = useState(false);
  if (seen !== open) {
    setSeen(open);
    if (open) setName(initial);
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || busy) return;
            setBusy(true);
            await onSave(name.trim());
            setBusy(false);
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Spring donors"
            aria-label="List name"
            maxLength={80}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
