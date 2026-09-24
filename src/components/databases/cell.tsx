"use client";

import Link from "next/link";
import { Check, ExternalLink, Minus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

import type { Cell } from "./column-config";

const TONE_CLASS: Record<string, string> = {
  success: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  warning: "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300",
};

/** Renders one database cell (server-formatted value). Works in server and client components. */
export function CellView({ cell }: { cell: Cell }) {
  if (cell === null || cell === undefined) return <span className="text-muted-foreground">—</span>;
  switch (cell.t) {
    case "text":
      return (
        <span className={cn("line-clamp-2", cell.muted && "text-muted-foreground")} title={cell.title}>
          {cell.v}
        </span>
      );
    case "number":
      return cell.v === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{cell.text ?? cell.v.toLocaleString()}</span>
      );
    case "bool":
      return cell.v ? (
        <Check className="size-4 text-emerald-600" aria-label="Yes" />
      ) : (
        <Minus className="text-muted-foreground size-4" aria-label="No" />
      );
    case "badge": {
      const tone = cell.tone ?? "secondary";
      const variant = tone === "success" || tone === "warning" ? "outline" : tone;
      return (
        <Badge variant={variant} className={TONE_CLASS[tone]}>
          {cell.v}
        </Badge>
      );
    }
    case "badges":
      return cell.v.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {cell.v.map((v) => (
            <Badge key={v} variant="outline">
              {v}
            </Badge>
          ))}
        </span>
      );
    case "person":
      return (
        <span className="flex min-w-0 items-center gap-2">
          <UserAvatar user={cell.user ?? { name: cell.name }} size="sm" />
          <span className="min-w-0">
            <span className="block truncate">{cell.name}</span>
            {cell.sub && <span className="text-muted-foreground block text-xs">{cell.sub}</span>}
          </span>
        </span>
      );
    case "link":
      return cell.external ? (
        <a
          href={cell.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-1 underline-offset-4 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {cell.label}
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      ) : (
        <Link
          href={cell.href}
          className="text-primary line-clamp-2 underline-offset-4 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {cell.label}
        </Link>
      );
  }
}
