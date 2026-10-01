"use client";

import { ChartColumn, Database } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** The ribbon across the top of Databases: the databases, and Reports. */
export function DatabasesTabs({ orgSlug, showReports }: { orgSlug: string; showReports: boolean }) {
  const pathname = usePathname();
  const base = `/app/${orgSlug}/databases`;
  const onReports = pathname.startsWith(`${base}/reports`);
  const tabs = [
    { href: base, label: "Databases", icon: Database, active: !onReports },
    ...(showReports
      ? [{ href: `${base}/reports`, label: "Reports", icon: ChartColumn, active: onReports }]
      : []),
  ];
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Databases sections" className="border-b">
      <ul className="-mb-px flex gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={tab.active ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  tab.active
                    ? "border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
