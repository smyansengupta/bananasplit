import { HardDrive } from "@/components/icons";
import Link from "next/link";

import { MixBar } from "@/components/ui/meters";
import { formatInLimitUnit, formatStorage, storageLevel } from "@/lib/billing/storage";
import { cn } from "@/lib/utils";

import type { StorageParts } from "./storage-chip";

/**
 * The space's storage at a glance (redesign guide 11.2): "0 GB of 500 GB",
 * a bar split by what uses it (files, receipts, note history, the trash)
 * and what's free, and the largest file the plan takes. On Settings › Plan and storage › Plan, so the number is where the
 * plan is chosen; the Storage tab has the breakdown.
 */
export function StorageMeter({
  usedBytes,
  limitBytes,
  maxFileBytes,
  planName,
  parts,
  personal = false,
  href,
  className,
}: {
  usedBytes: number;
  limitBytes: number;
  maxFileBytes: number;
  planName: string;
  parts: StorageParts;
  personal?: boolean;
  /** The Storage tab, for the breakdown. */
  href?: string;
  className?: string;
}) {
  const level = storageLevel(usedBytes, limitBytes);
  const free = Math.max(0, limitBytes - usedBytes);
  const segments = [
    { label: "Files", value: parts.filesBytes, color: "var(--chart-1)" },
    ...(personal
      ? []
      : [{ label: "Receipts", value: parts.receiptsBytes, color: "var(--chart-2)" }]),
    { label: "Note history", value: parts.noteHistoryBytes, color: "var(--chart-3)" },
    { label: "Trash", value: parts.trashBytes, color: "var(--chart-4)" },
    { label: "Free", value: free, hatch: true },
  ];
  return (
    <section
      aria-label="Storage"
      className={cn("bg-card edge rounded-card flex flex-col gap-4 p-6", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="bg-muted grid size-10 place-items-center rounded-full">
            <HardDrive className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div>
            <h2 className="heading text-[17px]">Storage</h2>
            <p className="text-muted-foreground text-[13px]">
              {planName} includes {formatStorage(limitBytes)}, up to {formatStorage(maxFileBytes)}{" "}
              per file
            </p>
          </div>
        </div>
        {href && (
          <Link
            href={href}
            className="text-[14px] font-semibold underline-offset-4 hover:underline"
          >
            See what&apos;s using it
          </Link>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <b className="numeral text-[32px]">{formatInLimitUnit(usedBytes, limitBytes)}</b>
        <span className="text-muted-foreground text-[15px]">
          of {formatStorage(limitBytes)} used
        </span>
      </div>
      <MixBar
        segments={segments}
        label={segments.map((s) => `${s.label} ${formatStorage(s.value)}`).join(", ")}
        height={14}
        legend={false}
      />
      <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1.5 p-0 text-[13px]">
        {segments.map((s) => (
          <li key={s.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              style={{ background: s.hatch ? undefined : s.color }}
              className={cn("size-2.5 rounded-[3px]", s.hatch && "bg-muted-strong")}
            />
            {s.label} <b className="figure font-semibold">{formatStorage(s.value)}</b>
          </li>
        ))}
      </ul>
      {level !== "ok" && (
        <p className="text-[13px] font-medium">
          {level === "full"
            ? "Storage is full: uploads have stopped. Nothing is deleted; empty the trash or change plan."
            : "Over 80% used. Uploads stop at 100%."}
        </p>
      )}
    </section>
  );
}
