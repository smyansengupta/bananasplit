"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={searchParams.get("period") ?? "all"}
        onValueChange={(v) => setParam("period", v)}
      >
        <SelectTrigger className="w-40">
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
        <SelectTrigger className="w-40">
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
      <Select value={searchParams.get("kind") ?? "all"} onValueChange={(v) => setParam("kind", v)}>
        <SelectTrigger className="w-40">
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
        <SelectTrigger className="w-36">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any status</SelectItem>
          {Object.values(TransactionStatus).map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={searchParams.get("submitter") ?? "all"}
        onValueChange={(v) => setParam("submitter", v)}
      >
        <SelectTrigger className="w-40">
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
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Reconciled" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any</SelectItem>
          <SelectItem value="yes">Reconciled</SelectItem>
          <SelectItem value="no">Not reconciled</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1">
        <Input
          type="date"
          aria-label="From"
          defaultValue={searchParams.get("dateFrom") ?? ""}
          onChange={(e) => setParam("dateFrom", e.target.value || null)}
          className="w-36"
        />
        <span className="text-muted-foreground text-sm">–</span>
        <Input
          type="date"
          aria-label="To"
          defaultValue={searchParams.get("dateTo") ?? ""}
          onChange={(e) => setParam("dateTo", e.target.value || null)}
          className="w-36"
        />
      </div>
    </div>
  );
}
