import {
  Bot,
  CalendarDays,
  Globe,
  Plug,
  TriangleAlert,
  Video,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { AppKind, AppsFeed as AppsFeedData } from "@/lib/overview/apps-feed";

/**
 * From your apps (Home): what the connected apps are doing right now, one
 * row each, live calls first with Join. Data from loadAppsFeed.
 */

const ICON: Record<AppKind, IconComponent> = {
  call: Video,
  website: Globe,
  calendar: CalendarDays,
  ai: Bot,
  integration: Plug,
};

export function AppsFeed({ data }: { data: AppsFeedData }) {
  if (data.rows.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing from your apps right now.</p>;
  }
  return (
    <ul className="divide-border divide-y">
      {data.rows.map((row) => {
        const Icon = row.tone === "warn" ? TriangleAlert : ICON[row.app];
        const text = row.href ? (
          <Link href={row.href} className="hover:underline">
            {row.text}
          </Link>
        ) : (
          row.text
        );
        return (
          <li key={row.key} className="flex items-center gap-3 py-3">
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-[10px]",
                row.tone === "warn"
                  ? "bg-tint-danger text-tint-danger-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] leading-snug font-semibold break-words">
                {text}
              </span>
              {row.sub && (
                <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[12.5px]">
                  {row.tone === "live" && (
                    <span aria-hidden="true" className="live-dot text-success" />
                  )}
                  {row.sub}
                </span>
              )}
            </span>
            {row.action &&
              (row.action.external ? (
                <a
                  href={row.action.href}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-foreground text-background focus-glow inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold outline-none"
                >
                  {row.action.label}
                </a>
              ) : (
                <Link
                  href={row.action.href}
                  className="ring-border focus-glow hover:bg-muted inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold ring-1 outline-none ring-inset"
                >
                  {row.action.label}
                </Link>
              ))}
          </li>
        );
      })}
    </ul>
  );
}
