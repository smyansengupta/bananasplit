"use client";

import { Banknote, Download, Inbox, List, Lock, SlidersHorizontal, X } from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { chipClass, Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TransactionKind } from "@/generated/prisma/enums";
import { KIND_LABELS } from "@/components/finance/transaction-kind-select";
import { cn } from "@/lib/utils";

/** The panel's filters: what counts toward the Filters chip's number. */
const PANEL_KEYS = [
  "period",
  "category",
  "kind",
  "submitter",
  "reconciled",
  "deleted",
  "dateFrom",
  "dateTo",
] as const;

const VIEWS = [
  { value: "all", label: "All", icon: List },
  { value: "review", label: "To review", icon: Inbox },
  { value: "pay", label: "To pay", icon: Banknote },
  { value: "unreconciled", label: "Unreconciled", icon: Lock },
] as const;

/**
 * The transactions bar, shaped like the Tasks bar: the views on the left
 * (the four questions a treasurer opens this page with), one Filters chip
 * for everything else, then search and Export on the right.
 */
export function TransactionFilters({
  periods,
  categories,
  members,
  exportHref,
}: {
  periods: { id: string; label: string }[];
  categories: { id: string; name: string }[];
  members: { userId: string; name: string | null; email: string }[];
  exportHref: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value && value !== "all") params.set(key, value);
      else params.delete(key);
    }
    params.delete("open");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }
  const setParam = (key: string, value: string | null) => setParams({ [key]: value });

  const view = searchParams.get("view") ?? "all";
  const count = PANEL_KEYS.filter((k) => searchParams.has(k)).length;
  const [draft, setDraft] = useState(searchParams.get("q") ?? "");

  return (
    <div className="@container/toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Show"
          value={view}
          onSelect={(v) => setParam("view", v)}
          options={VIEWS.map((v) => ({
            value: v.value,
            label: v.label,
            icon: v.icon,
            compact: true,
          }))}
          labelsFrom="sr-only @[44rem]/toolbar:not-sr-only"
          className="shrink-0"
        />

        <Popover>
          <PopoverTrigger
            aria-label={count > 0 ? `Filters, ${count} on` : "Filters"}
            className={chipClass(count > 0)}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            Filters
            {count > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{count}</Badge>}
          </PopoverTrigger>
          <PopoverContent align="start" className="grid w-80 gap-3 p-3">
            <PanelRow name="Period">
              <Select
                value={searchParams.get("period") ?? "all"}
                onValueChange={(v) => setParam("period", v)}
              >
                <SelectTrigger className="w-full" aria-label="Period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All periods</SelectItem>
                  {periods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PanelRow>
            <PanelRow name="Category">
              <Select
                value={searchParams.get("category") ?? "all"}
                onValueChange={(v) => setParam("category", v)}
              >
                <SelectTrigger className="w-full" aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any category</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PanelRow>
            <PanelRow name="Kind">
              <Select
                value={searchParams.get("kind") ?? "all"}
                onValueChange={(v) => setParam("kind", v)}
              >
                <SelectTrigger className="w-full" aria-label="Kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any kind</SelectItem>
                  {Object.values(TransactionKind).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PanelRow>
            {members.length > 1 && (
              <PanelRow name="By">
                <Select
                  value={searchParams.get("submitter") ?? "all"}
                  onValueChange={(v) => setParam("submitter", v)}
                >
                  <SelectTrigger className="w-full" aria-label="By">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Anyone</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.name ?? m.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PanelRow>
            )}
            <PanelRow name="Reconciled">
              <Segmented
                label="Reconciled"
                value={searchParams.get("reconciled") ?? "all"}
                onSelect={(v) => setParam("reconciled", v)}
                options={[
                  { value: "all", label: "Any" },
                  { value: "yes", label: "Reconciled" },
                  { value: "no", label: "Not" },
                ]}
              />
            </PanelRow>
            <PanelRow name="Dates">
              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  aria-label="From"
                  defaultValue={searchParams.get("dateFrom") ?? ""}
                  onChange={(e) => setParam("dateFrom", e.target.value || null)}
                  className="min-w-0 flex-1"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <Input
                  type="date"
                  aria-label="To"
                  defaultValue={searchParams.get("dateTo") ?? ""}
                  onChange={(e) => setParam("dateTo", e.target.value || null)}
                  className="min-w-0 flex-1"
                />
              </div>
            </PanelRow>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                aria-pressed={searchParams.get("deleted") === "show"}
                onClick={() =>
                  setParam("deleted", searchParams.get("deleted") === "show" ? null : "show")
                }
                className={cn(
                  chipClass(searchParams.get("deleted") === "show"),
                  "h-8 px-3 text-[13px]",
                )}
              >
                Show voided
              </button>
              {count > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setParams(Object.fromEntries(PANEL_KEYS.map((k) => [k, null])))}
                >
                  <X aria-hidden="true" />
                  Clear
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <div className="ms-auto flex min-w-48 flex-1 items-center justify-end gap-2">
          <SearchField
            value={draft}
            onValueChange={setDraft}
            onClear={() => {
              setDraft("");
              setParam("q", null);
            }}
            placeholder="Search"
            aria-label="Search transactions"
            className="sm:max-w-56"
            onKeyDown={(e) => {
              if (e.key === "Enter") setParam("q", draft.trim() || null);
            }}
            onBlur={() => {
              if (draft.trim() !== (searchParams.get("q") ?? "")) {
                setParam("q", draft.trim() || null);
              }
            }}
          />
          <Button variant="outline" size="icon" asChild>
            <a href={exportHref} aria-label="Export CSV" title="Export CSV">
              <Download className="size-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function PanelRow({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-muted-foreground text-[13px] font-medium">{name}</span>
      {children}
    </div>
  );
}
