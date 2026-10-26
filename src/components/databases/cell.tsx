"use client";

import Link from "next/link";
import { ArrowUpRight, Check, CircleAlert, Minus } from "@/components/icons";

import { Badge } from "@/components/ui/badge";
import { TagChip } from "@/components/ui/chip";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

import type { Cell } from "./column-config";
import { chartColor } from "./styles";

const LINK =
  "decoration-foreground/25 hover:decoration-foreground underline underline-offset-4 transition-colors";

/**
 * Renders one database cell (server-formatted value). Works in server and
 * client components. Values are chips (Moonstone): a category (a check-in
 * method, a source) is a TagChip in a stable chart colour, a state is a
 * Badge: success, a warning (secondary with the warning icon), or neutral.
 */
export function CellView({ cell }: { cell: Cell }) {
  if (cell === null || cell === undefined) return <span className="text-muted-foreground">—</span>;
  switch (cell.t) {
    case "text":
      return (
        <span
          className={cn("line-clamp-2", cell.muted && "text-muted-foreground")}
          title={cell.title}
        >
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
        <Check className="text-success size-4" aria-label="Yes" />
      ) : (
        <Minus className="text-muted-foreground size-4" aria-label="No" />
      );
    case "badge": {
      const tone = cell.tone ?? "secondary";
      if (tone === "outline") return <TagChip color={chartColor(cell.v)}>{cell.v}</TagChip>;
      if (tone === "warning")
        return (
          <Badge variant="secondary" className="text-foreground">
            <CircleAlert className="text-warning" aria-hidden="true" />
            {cell.v}
          </Badge>
        );
      return (
        <Badge variant={tone === "default" ? "info" : tone === "success" ? "success" : tone}>
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
            <TagChip key={v} color={chartColor(v)}>
              {v}
            </TagChip>
          ))}
        </span>
      );
    case "person":
      return (
        <span className="flex min-w-0 items-center gap-2.5">
          <UserAvatar user={cell.user ?? { name: cell.name }} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{cell.name}</span>
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
          className={cn("inline-flex items-center gap-1", LINK)}
          onClick={(e) => e.stopPropagation()}
        >
          {cell.label}
          <ArrowUpRight className="text-muted-foreground size-3.5" aria-hidden="true" />
        </a>
      ) : (
        <Link
          href={cell.href}
          className={cn("line-clamp-2", LINK)}
          onClick={(e) => e.stopPropagation()}
        >
          {cell.label}
        </Link>
      );
  }
}
