"use client";

import { HardDrive } from "@/components/icons";
import Link from "next/link";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MixBar } from "@/components/ui/meters";
import { formatInLimitUnit, formatStorage, storageLevel } from "@/lib/billing/storage";
import { cn } from "@/lib/utils";

/**
 * The space's storage beside the Files page's New note (redesign guide
 * 11.2): "0 GB of 500 GB" with a small bar split by what uses it (files,
 * receipts, note history, the trash) and what's free. Click it for the
 * breakdown, the largest file the plan takes, and, for owners and admins,
 * the storage page.
 */

export interface StorageParts {
  filesBytes: number;
  receiptsBytes: number;
  noteHistoryBytes: number;
  trashBytes: number;
}

export function StorageChip({
  usedBytes,
  limitBytes,
  maxFileBytes,
  parts,
  personal = false,
  href,
}: {
  usedBytes: number;
  limitBytes: number;
  maxFileBytes: number;
  parts: StorageParts;
  personal?: boolean;
  /** The storage page, for owners and admins. */
  href?: string | null;
}) {
  const free = Math.max(0, limitBytes - usedBytes);
  const level = storageLevel(usedBytes, limitBytes);
  const used = formatInLimitUnit(usedBytes, limitBytes);
  const total = formatStorage(limitBytes);
  const segments = [
    { label: "Files", value: parts.filesBytes, color: "var(--chart-1)" },
    ...(personal
      ? []
      : [{ label: "Receipts", value: parts.receiptsBytes, color: "var(--chart-2)" }]),
    { label: "Note history", value: parts.noteHistoryBytes, color: "var(--chart-3)" },
    { label: "Trash", value: parts.trashBytes, color: "var(--chart-4)" },
    { label: "Free", value: free, hatch: true },
  ];
  const label = segments.map((s) => `${s.label} ${formatStorage(s.value)}`).join(", ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Storage: ${used} of ${total} used`}
          className={cn(
            "border-input hover:bg-muted focus-glow inline-flex h-10 items-center gap-2.5 rounded-full border ps-3.5 pe-4 text-[13px] font-medium transition-colors pointer-coarse:h-11",
            level === "full" && "border-destructive text-destructive",
          )}
        >
          <HardDrive className="size-4 flex-none" strokeWidth={1.75} aria-hidden="true" />
          <span className="tabular-nums">
            <span className="font-semibold">{used}</span>
            <span className="text-muted-foreground"> of {total}</span>
          </span>
          <MixBar segments={segments} label={label} height={6} legend={false} className="w-16" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4 p-5">
        <div className="flex items-baseline gap-2">
          <b className="numeral text-[28px]">{used}</b>
          <span className="text-muted-foreground text-sm">of {total} used</span>
        </div>
        <MixBar segments={segments} label={label} height={14} legend={false} />
        <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1.5 p-0 text-[13px]">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                style={{ background: s.hatch ? undefined : s.color }}
                className={cn("size-2.5 flex-none rounded-[3px]", s.hatch && "bg-muted-strong")}
              />
              <span className="min-w-0 flex-1">{s.label}</span>
              <b className="figure font-semibold">{formatStorage(s.value)}</b>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-[13px]">
          Up to {formatStorage(maxFileBytes)} per file.{" "}
          {level === "full"
            ? "Storage is full: uploads have stopped until there's room."
            : level === "warning"
              ? "Over 80% used; uploads stop at 100%."
              : "Nothing is ever deleted for being over."}
        </p>
        {href && (
          <Link
            href={href}
            className="inline-flex text-[13px] font-semibold underline-offset-4 hover:underline"
          >
            See what&apos;s using it
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
