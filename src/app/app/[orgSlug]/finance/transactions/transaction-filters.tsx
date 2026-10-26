"use client";

import { ChevronDown, SlidersHorizontal, X } from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { TransactionKind, TransactionStatus } from "@/generated/prisma/enums";
import { KIND_LABELS } from "@/components/finance/transaction-kind-select";
import { STATUS_LABELS } from "@/components/finance/transaction-status-badge";
import { cn } from "@/lib/utils";

const FILTER_KEYS = [
  "period",
  "category",
  "kind",
  "status",
  "submitter",
  "reconciled",
  "deleted",
  "dateFrom",
  "dateTo",
] as const;

/**
 * The transactions filters: a row of 40px pill dropdowns, each labelled, and a way to clear them.
 * On a phone they fold behind one Filters button (with a count), beside Export, and open below
 * both, two to a row, so the transactions come first instead of nine controls.
 */
export function TransactionFilters({
  periods,
  categories,
  members,
}: {
  periods: { id: string; label: string }[];
  categories: { id: string; name: string }[];
  members: { userId: string; name: string | null; email: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  const count = FILTER_KEYS.filter((k) => searchParams.has(k)).length;
  const active = count > 0;
  const [open, setOpen] = useState(false);

  return (
    <div className="contents">
      <Button
        type="button"
        variant="outline"
        className="md:hidden"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal aria-hidden="true" />
        Filters
        {active && <Badge className="h-4 min-w-4 px-1 text-[10px]">{count}</Badge>}
        <ChevronDown
          className={cn("opacity-60 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </Button>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          "max-md:order-last max-md:grid max-md:w-full max-md:grid-cols-2 max-md:[&_[data-slot=select-trigger]]:w-full",
          !open && "max-md:hidden",
        )}
      >
        <Select
          value={searchParams.get("period") ?? "all"}
          onValueChange={(v) => setParam("period", v)}
        >
          <SelectTrigger className="w-40 rounded-full" aria-label="Period">
            <SelectValue placeholder="Period" />
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
        <Select
          value={searchParams.get("category") ?? "all"}
          onValueChange={(v) => setParam("category", v)}
        >
          <SelectTrigger className="w-40 rounded-full" aria-label="Category">
            <SelectValue placeholder="Category" />
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
        <Select
          value={searchParams.get("kind") ?? "all"}
          onValueChange={(v) => setParam("kind", v)}
        >
          <SelectTrigger className="w-40 rounded-full" aria-label="Kind">
            <SelectValue placeholder="Kind" />
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
        <Select
          value={searchParams.get("status") ?? "all"}
          onValueChange={(v) => setParam("status", v)}
        >
          <SelectTrigger className="w-36 rounded-full" aria-label="Status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {Object.values(TransactionStatus).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={searchParams.get("submitter") ?? "all"}
          onValueChange={(v) => setParam("submitter", v)}
        >
          <SelectTrigger className="w-40 rounded-full" aria-label="Submitted by">
            <SelectValue placeholder="Submitter" />
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
        <Select
          value={searchParams.get("reconciled") ?? "all"}
          onValueChange={(v) => setParam("reconciled", v)}
        >
          <SelectTrigger className="w-40 rounded-full" aria-label="Reconciled">
            <SelectValue placeholder="Reconciled" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any</SelectItem>
            <SelectItem value="yes">Reconciled</SelectItem>
            <SelectItem value="no">Not reconciled</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={searchParams.get("deleted") === "show" ? "show" : "hide"}
          onValueChange={(v) => setParam("deleted", v === "show" ? "show" : null)}
        >
          <SelectTrigger className="w-40 rounded-full" aria-label="Deleted transactions">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hide">Hide deleted</SelectItem>
            <SelectItem value="show">Include deleted</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5 max-md:col-span-2">
          <Input
            type="date"
            aria-label="From"
            defaultValue={searchParams.get("dateFrom") ?? ""}
            onChange={(e) => setParam("dateFrom", e.target.value || null)}
            className="w-38 rounded-full max-md:w-auto max-md:flex-1"
          />
          <span className="text-muted-foreground text-sm">–</span>
          <Input
            type="date"
            aria-label="To"
            defaultValue={searchParams.get("dateTo") ?? ""}
            onChange={(e) => setParam("dateTo", e.target.value || null)}
            className="w-38 rounded-full max-md:w-auto max-md:flex-1"
          />
        </div>
        {active && (
          <Button type="button" variant="ghost" onClick={() => router.replace(pathname)}>
            <X aria-hidden="true" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
