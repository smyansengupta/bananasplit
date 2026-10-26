"use client";

import { Link2 } from "@/components/icons";
import Link from "next/link";

import { NAV_ICONS } from "@/components/shell/sidebar-nav";
import { IconChip } from "@/components/ui/stat";

/**
 * Shortcuts (redesign guide 9.2): every section the club uses, as an icon
 * chip with its name. Client-side so it can look up the sidebar's icons.
 */
export function Shortcuts({
  links,
}: {
  links: readonly { id: string; label: string; href: string; icon: string }[];
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-x-2 gap-y-3">
      {links.map((l) => (
        <li key={l.id}>
          <Link
            href={l.href}
            className="group/sc flex flex-col items-center gap-1.5 rounded-tile px-1 py-1.5 text-center text-[12px] font-medium"
          >
            <IconChip
              icon={NAV_ICONS[l.icon] ?? Link2}
              size="md"
              className="transition-transform duration-200 group-hover/sc:-translate-y-0.5"
            />
            <span className="line-clamp-2 leading-tight">{l.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
