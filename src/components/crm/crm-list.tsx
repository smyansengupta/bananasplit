"use client";

import {
  AlarmClock,
  ArrowUpDown,
  Building2,
  Check,
  Download,
  FileSpreadsheet,
  Hourglass,
  Sparkles,
  Trash2,
  Undo2,
  UserPlus,
  UserRound,
  Users,
} from "@/components/icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  bulkUpdateAction,
  createCompanyAction,
  createPersonAction,
  restoreAction,
  trashAction,
  undoAction,
} from "@/app/app/[orgSlug]/crm/actions";
import { EmptyState } from "@/components/empty-state";
import { PHONE_SMALL_CREATE } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CreateSplitButton } from "@/components/ui/create-split-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { ExpandChip, FilterPill, FiltersMenu } from "@/components/ui/toolbar-chips";
import { toast } from "@/components/ui/toaster";
import { crmRecordHref } from "@/lib/crm/href";
import { initials, STATUS_LABELS } from "@/lib/crm/fields";
import { strengthBand, STRENGTH_LABELS } from "@/lib/crm/strength";
import { hasModifier, isTypingTarget, overlayOpen } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

import { CrmPicker } from "./crm-picker";
import { useUrlState } from "./use-url";

/**
 * People and Companies: the Tasks bar on top (the status switch with its
 * counts, icon chips for whose and what's due, one Filters chip with the
 * sort inside, search at the right), then the list. Everything is in the
 * URL and done on the server. Pick rows to change many at once; every bulk
 * change has Undo. Keys: j and k move, Enter opens, x picks, n adds, /
 * searches.
 */

export interface ListRow {
  id: string;
  name: string;
  sub: string | null;
  email?: string | null;
  badge?: { label: string; color?: string } | null;
  owner: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  strength: number;
  extra?: string | null;
  deleted: boolean;
}

export interface ListProps {
  orgId: string;
  orgSlug: string;
  kind: "person" | "company";
  title: string;
  rows: ListRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { ACTIVE: number; INACTIVE: number; ALUMNI: number; trash: number };
  relationshipTypes: { value: string; label: string }[];
  members: { id: string; name: string }[];
  sortLabels: Record<string, string>;
  views: { name: string; href: string; active: boolean }[];
  exportHref: string;
  /** The CRM tab bar, under the title. */
  tabs?: React.ReactNode;
}

function relative(iso: string | null): string {
  if (!iso) return "";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days === -1) return "Tomorrow";
  if (days < 0) return `In ${-days} days`;
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CrmList(props: ListProps) {
  const { orgId, orgSlug, kind, rows, total, counts } = props;
  const router = useRouter();
  const url = useUrlState();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const trash = url.get("trash") === "1";
  const status = trash ? "trash" : (url.get("status") ?? "ACTIVE");
  const noun = kind === "person" ? "person" : "company";
  const nouns = kind === "person" ? "people" : "companies";

  // New from anywhere (New › New person) lands here with ?new=1.
  const startNew = searchParams.get("new") === "1";
  useEffect(() => {
    if (!startNew) return;
    setCreating(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("new");
    router.replace(next.toString() ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [startNew, searchParams, router, pathname]);

  useEffect(() => setSelected(new Set()), [rows]);

  const open = useCallback(
    (id: string) => router.push(crmRecordHref(orgSlug, kind, id)),
    [router, orgSlug, kind],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || hasModifier(e) || isTypingTarget(e) || overlayOpen()) return;
      const k = e.key;
      if (k === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (k === "j" || k === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, rows.length - 1));
      } else if (k === "k" || k === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (k === "Enter" && rows[active]) {
        e.preventDefault();
        open(rows[active]!.id);
      } else if (k === "x" && rows[active]) {
        e.preventDefault();
        const id = rows[active]!.id;
        setSelected((s) => {
          const n = new Set(s);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        });
      } else if (k === "n" && !trash) {
        e.preventDefault();
        setCreating(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, active, open, trash]);

  const owner = url.get("owner");
  const due = url.get("due");
  const rel = url.get("rel");
  const sort = url.get("sort") ?? "name";
  const filterCount = (rel ? 1 : 0) + (owner && owner !== "me" ? 1 : 0) + (url.get("sort") ? 1 : 0);

  const bulk = async (patch: Record<string, unknown>, label: string) => {
    const ids = [...selected];
    const r = await bulkUpdateAction(orgId, kind, ids, patch).catch(() => null);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
      return;
    }
    toast({
      title: `${label}: ${r.changed} changed.`,
      action: {
        label: "Undo",
        run: async () => {
          const u = await undoAction(orgId, r.batchId).catch(() => null);
          start(() => router.refresh());
          return u && !u.ok ? u.error : undefined;
        },
      },
    });
    start(() => router.refresh());
  };

  const sortItems = Object.entries(props.sortLabels);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 max-md:flex-nowrap max-md:items-center">
        <h1 className="page-title mr-auto max-md:min-w-0">{props.title}</h1>
        <div className={cn("flex flex-wrap items-center gap-2", PHONE_SMALL_CREATE)}>
          <CreateSplitButton
            label={kind === "person" ? "New person" : "New company"}
            title={`New ${noun} (n)`}
            onClick={() => setCreating(true)}
            menuLabel={`More ways to add ${nouns}`}
          >
            <DropdownMenuItem asChild>
              <Link href={`/app/${orgSlug}/crm/import`}>
                <FileSpreadsheet className="size-4" aria-hidden="true" />
                Import a file
              </Link>
            </DropdownMenuItem>
            {kind === "person" && (
              <DropdownMenuItem asChild>
                <Link href={`/app/${orgSlug}/crm/setup`}>
                  <Users className="size-4" aria-hidden="true" />
                  Bring in members and check-ins
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <a href={props.exportHref}>
                <Download className="size-4" aria-hidden="true" />
                Export to CSV
              </a>
            </DropdownMenuItem>
          </CreateSplitButton>
        </div>
      </div>

      {props.tabs}

      {props.views.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Saved views">
          {props.views.map((v) => (
            <Link
              key={v.name}
              href={v.href}
              className={cn(chipClass(v.active), "h-8 px-3 text-[13px]")}
            >
              {v.name}
            </Link>
          ))}
        </div>
      )}

      <div className="@container/toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Status"
            value={status}
            onSelect={(v) =>
              url.set(
                v === "trash"
                  ? { trash: "1", status: undefined }
                  : { status: v === "ACTIVE" ? undefined : v, trash: undefined },
              )
            }
            options={[
              { value: "ACTIVE", label: STATUS_LABELS.ACTIVE, count: counts.ACTIVE },
              { value: "INACTIVE", label: STATUS_LABELS.INACTIVE, count: counts.INACTIVE },
              { value: "ALUMNI", label: STATUS_LABELS.ALUMNI, count: counts.ALUMNI },
              { value: "trash", label: "Trash", count: counts.trash },
            ]}
          />
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Show">
            <ExpandChip
              icon={UserRound}
              label="Mine"
              active={owner === "me"}
              onClick={() => url.set({ owner: owner === "me" ? undefined : "me" })}
            />
            <ExpandChip
              icon={AlarmClock}
              label="Follow-ups due"
              active={due === "due"}
              onClick={() => url.set({ due: due === "due" ? undefined : "due" })}
            />
            <ExpandChip
              icon={Hourglass}
              label="Going cold"
              active={due === "cold"}
              onClick={() => url.set({ due: due === "cold" ? undefined : "cold" })}
            />
            <ExpandChip
              icon={Sparkles}
              label="New this week"
              active={due === "new"}
              onClick={() => url.set({ due: due === "new" ? undefined : "new" })}
            />
          </div>
          <FiltersMenu
            count={filterCount}
            items={[
              ...(kind === "person" && props.relationshipTypes.length
                ? [
                    {
                      name: "Relationship",
                      node: (
                        <FieldSelect
                          value={rel ?? ""}
                          onChange={(e) => url.set({ rel: e.target.value || undefined })}
                          aria-label="Relationship"
                        >
                          <option value="">Any relationship</option>
                          {props.relationshipTypes.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </FieldSelect>
                      ),
                    },
                  ]
                : []),
              {
                name: "Owner",
                node: (
                  <FieldSelect
                    value={owner ?? ""}
                    onChange={(e) => url.set({ owner: e.target.value || undefined })}
                    aria-label="Owner"
                  >
                    <option value="">Anyone</option>
                    <option value="me">Me or my role</option>
                    <option value="none">Nobody</option>
                    {props.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </FieldSelect>
                ),
              },
              {
                name: "Sort",
                node: (
                  <div className="flex flex-col gap-px">
                    {sortItems.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          url.set({ sort: key === "name" ? undefined : key, dir: undefined })
                        }
                        className="hover:bg-muted flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm"
                      >
                        <ArrowUpDown className="size-3.5 opacity-60" aria-hidden="true" />
                        <span className="flex-1">{label}</span>
                        {sort === key && <Check className="size-3.5" aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                ),
              },
            ]}
          />
          <div className="ms-auto flex min-w-48 flex-1 items-center justify-end">
            <SearchField
              key={url.get("q") ?? ""}
              ref={searchRef}
              defaultValue={url.get("q") ?? ""}
              hint="/"
              placeholder={kind === "person" ? "Search people" : "Search companies"}
              aria-label={kind === "person" ? "Search people" : "Search companies"}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  url.set({ q: (e.target as HTMLInputElement).value.trim() || undefined });
                if (e.key === "Escape") (e.target as HTMLInputElement).blur();
              }}
              onClear={() => url.set({ q: undefined })}
            />
          </div>
        </div>
      </div>

      {(rel || (owner && owner !== "me") || url.get("q")) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {rel && (
            <FilterPill
              label={props.relationshipTypes.find((t) => t.value === rel)?.label ?? rel}
              onClear={() => url.set({ rel: undefined })}
            />
          )}
          {owner && owner !== "me" && (
            <FilterPill
              label={
                owner === "none"
                  ? "Nobody owns"
                  : `Owned by ${props.members.find((m) => m.id === owner)?.name ?? "someone"}`
              }
              onClear={() => url.set({ owner: undefined })}
            />
          )}
          {url.get("q") && (
            <FilterPill label={`“${url.get("q")}”`} onClear={() => url.set({ q: undefined })} />
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div
          className="bg-muted/60 flex flex-wrap items-center gap-2 rounded-full px-3 py-1.5 text-sm"
          role="toolbar"
          aria-label="Change the picked ones"
        >
          <b className="px-1">{selected.size} picked</b>
          {trash ? (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const r = await restoreAction(orgId, kind, [...selected]).catch(() => null);
                if (!r || !r.ok)
                  toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
                else toast({ title: `Restored ${r.count}.` });
                router.refresh();
              }}
            >
              <Undo2 className="size-3.5" aria-hidden="true" />
              Restore
            </Button>
          ) : (
            <>
              {(["ACTIVE", "INACTIVE", "ALUMNI"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="outline"
                  onClick={() => bulk({ status: s }, STATUS_LABELS[s])}
                >
                  {STATUS_LABELS[s]}
                </Button>
              ))}
              <FieldSelect
                value=""
                onChange={(e) =>
                  e.target.value &&
                  bulk(
                    {
                      ownerId: e.target.value === "none" ? null : e.target.value,
                      ownerRoleKey: null,
                    },
                    "Owner",
                  )
                }
                aria-label="Give them to"
                className="h-8 w-40"
              >
                <option value="">Give to…</option>
                <option value="none">Nobody</option>
                {props.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </FieldSelect>
              {kind === "person" && props.relationshipTypes.length > 0 && (
                <FieldSelect
                  value=""
                  onChange={(e) =>
                    e.target.value && bulk({ relationship: e.target.value }, "Relationship")
                  }
                  aria-label="Relationship"
                  className="h-8 w-44"
                >
                  <option value="">Relationship…</option>
                  {props.relationshipTypes.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </FieldSelect>
              )}
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                onClick={async () => {
                  const r = await trashAction(orgId, kind, [...selected]).catch(() => null);
                  if (!r || !r.ok) {
                    toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
                    return;
                  }
                  toast({
                    title: `Moved ${r.count} to the trash.`,
                    action: {
                      label: "Undo",
                      run: async () => {
                        const u = await undoAction(orgId, r.batchId).catch(() => null);
                        router.refresh();
                        return u && !u.ok ? u.error : undefined;
                      },
                    },
                  });
                  router.refresh();
                }}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Trash
              </Button>
            </>
          )}
          <button
            type="button"
            className="text-muted-foreground ms-auto text-xs hover:underline"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={kind === "person" ? Users : Building2}
          title={
            trash
              ? "The trash is empty"
              : url.get("q") || due || rel || owner
                ? `No ${nouns} match`
                : `No ${nouns} yet`
          }
          description={
            trash ? undefined : `Add one, import a file, or bring in the people Bananasplit knows.`
          }
          action={
            !trash ? (
              <Button onClick={() => setCreating(true)}>
                <UserPlus className="size-4" aria-hidden="true" />
                {kind === "person" ? "New person" : "New company"}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="bg-card ring-foreground/6 rounded-card overflow-x-auto ring-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs">
                <th className="w-10 px-3 py-2.5">
                  <Checkbox
                    aria-label="Pick all"
                    checked={selected.size === rows.length && rows.length > 0}
                    onCheckedChange={(v) =>
                      setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())
                    }
                  />
                </th>
                <th className="px-2 py-2.5 font-semibold">Name</th>
                {kind === "person" && (
                  <th className="px-2 py-2.5 font-semibold max-md:hidden">Email</th>
                )}
                <th className="px-2 py-2.5 font-semibold max-lg:hidden">
                  {kind === "person" ? "Relationship" : "People"}
                </th>
                <th className="px-2 py-2.5 font-semibold max-lg:hidden">Owner</th>
                <th className="px-2 py-2.5 font-semibold max-md:hidden">Last contacted</th>
                <th className="px-2 py-2.5 font-semibold max-sm:hidden">Follow-up</th>
                <th className="px-3 py-2.5 font-semibold max-md:hidden">Strength</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const band = strengthBand(r.strength);
                const overdue =
                  r.nextFollowUpAt && new Date(r.nextFollowUpAt).getTime() < Date.now();
                return (
                  <tr
                    key={r.id}
                    data-active={i === active}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "border-border/60 border-b last:border-0",
                      i === active && "bg-muted/50",
                      r.deleted && "opacity-70",
                    )}
                  >
                    <td className="px-3 py-2">
                      <Checkbox
                        aria-label={`Pick ${r.name}`}
                        checked={selected.has(r.id)}
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
                    <td className="px-2 py-2">
                      <Link
                        href={crmRecordHref(orgSlug, kind, r.id)}
                        className="flex min-w-0 items-center gap-2.5"
                      >
                        <span className="bg-tint-info text-tint-info-foreground grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold">
                          {initials(r.name)}
                        </span>
                        <span className="min-w-0">
                          <b className="block truncate font-semibold">{r.name}</b>
                          {r.sub && (
                            <span className="text-muted-foreground block truncate text-xs">
                              {r.sub}
                            </span>
                          )}
                        </span>
                      </Link>
                    </td>
                    {kind === "person" && (
                      <td className="text-muted-foreground px-2 py-2 max-md:hidden">{r.email}</td>
                    )}
                    <td className="px-2 py-2 max-lg:hidden">
                      {r.badge ? (
                        <Badge variant="secondary">{r.badge.label}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{r.extra}</span>
                      )}
                    </td>
                    <td className="text-muted-foreground px-2 py-2 max-lg:hidden">{r.owner}</td>
                    <td className="text-muted-foreground px-2 py-2 max-md:hidden">
                      {relative(r.lastContactedAt)}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2 max-sm:hidden",
                        overdue
                          ? "text-tint-danger-foreground font-semibold"
                          : "text-muted-foreground",
                      )}
                    >
                      {relative(r.nextFollowUpAt)}
                    </td>
                    <td className="px-3 py-2 max-md:hidden" title={STRENGTH_LABELS[band]}>
                      <span className="bg-muted block h-1.5 w-16 overflow-hidden rounded-full">
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            band === "strong"
                              ? "bg-[var(--chart-3)]"
                              : band === "fair"
                                ? "bg-[var(--chart-4)]"
                                : "bg-[var(--chart-1)]",
                          )}
                          style={{ width: `${Math.max(r.strength, r.strength > 0 ? 6 : 0)}%` }}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > props.pageSize && (
        <div className="text-muted-foreground flex items-center justify-between text-sm">
          <span>
            {((props.page - 1) * props.pageSize + 1).toLocaleString()} to{" "}
            {Math.min(total, props.page * props.pageSize).toLocaleString()} of{" "}
            {total.toLocaleString()}
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={props.page <= 1}
              onClick={() => url.set({ page: String(props.page - 1) })}
            >
              Back
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={props.page * props.pageSize >= total}
              onClick={() => url.set({ page: String(props.page + 1) })}
            >
              Next
            </Button>
          </span>
        </div>
      )}

      {creating && (
        <NewRecordDialog
          orgId={orgId}
          kind={kind}
          relationshipTypes={props.relationshipTypes}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(crmRecordHref(orgSlug, kind, id))}
        />
      )}
    </div>
  );
}

/** New person or company: the few fields that matter, the rest on its page. */
export function NewRecordDialog({
  orgId,
  kind,
  relationshipTypes,
  onClose,
  onCreated,
  initialCompany,
}: {
  orgId: string;
  kind: "person" | "company";
  relationshipTypes: { value: string; label: string }[];
  onClose: () => void;
  onCreated: (id: string) => void;
  initialCompany?: { id: string; name: string } | null;
}) {
  const [pending, setPending] = useState(false);
  const [company, setCompany] = useState<{ id: string; label: string } | null>(
    initialCompany ? { id: initialCompany.id, label: initialCompany.name } : null,
  );
  const [companyText, setCompanyText] = useState("");
  const [rel, setRel] = useState("");
  const typing = useMemo(() => company === null, [company]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === "person" ? "New person" : "New company"}</DialogTitle>
          <DialogDescription>
            {kind === "person"
              ? "A name or an email is enough."
              : "A name is enough; the domain links their people."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setPending(true);
            const r =
              kind === "person"
                ? await createPersonAction(orgId, {
                    name: String(data.get("name") ?? ""),
                    primaryEmail: String(data.get("email") ?? ""),
                    title: String(data.get("title") ?? ""),
                    phone: String(data.get("phone") ?? ""),
                    companyId: company?.id,
                    companyName: typing ? companyText : undefined,
                    relationship: rel || undefined,
                  }).catch(() => null)
                : await createCompanyAction(orgId, {
                    name: String(data.get("name") ?? ""),
                    domain: String(data.get("domain") ?? "") || undefined,
                    industry: String(data.get("industry") ?? "") || undefined,
                  }).catch(() => null);
            setPending(false);
            if (!r || !r.ok) {
              toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
              return;
            }
            onCreated(r.id);
          }}
        >
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Name</span>
            <Input name="name" autoFocus />
          </label>
          {kind === "person" ? (
            <>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Email</span>
                <Input name="email" type="email" />
              </label>
              <div className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Company</span>
                <div className="flex flex-wrap items-center gap-2">
                  <CrmPicker
                    orgId={orgId}
                    kind="company"
                    value={company?.id ?? null}
                    display={company?.label}
                    placeholder="Pick one"
                    onPick={(h) => setCompany(h ? { id: h.id, label: h.label } : null)}
                  />
                  {typing && (
                    <Input
                      value={companyText}
                      onChange={(e) => setCompanyText(e.target.value)}
                      placeholder="or type a new one"
                      aria-label="New company"
                      className="min-w-0 flex-1"
                    />
                  )}
                </div>
              </div>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Title</span>
                <Input name="title" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Phone</span>
                <Input name="phone" type="tel" />
              </label>
              {relationshipTypes.length > 0 && (
                <div className="grid gap-1.5 text-sm">
                  <span className="text-muted-foreground">Relationship</span>
                  <div className="flex flex-wrap gap-1.5">
                    {relationshipTypes.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        aria-pressed={rel === t.value}
                        onClick={() => setRel(rel === t.value ? "" : t.value)}
                        className={cn(chipClass(rel === t.value), "h-8 px-3 text-[13px]")}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Domain</span>
                <Input name="domain" placeholder="example.com" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Industry</span>
                <Input name="industry" />
              </label>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
