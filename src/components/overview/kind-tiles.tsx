import {
  Activity,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Database,
  FileText,
  Folder,
  FolderOpen,
  Inbox,
  NotebookText,
  Paperclip,
  Plug,
  User,
  Users,
  Wallet,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import type { PinKind } from "@/lib/pins/pages";
import { tagToken, type TagColor } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";

/**
 * Home's coloured tiles (Recently visited, Pinned, notes, uploads): each
 * kind of thing keeps one colour from the tag palette, so a row of tiles
 * reads as a row of different things at a glance. The kind is always named
 * in the tile's text too, so colour is never the only cue. A "page" takes
 * its section's icon (Meetings, Forms…) and the neutral ink.
 */

const KIND_COLOR: Partial<Record<PinKind, TagColor>> = {
  task: "navy",
  event: "plum",
  note: "forest",
  file: "ochre",
  folder: "ochre",
  form: "teal",
  database: "rust",
  person: "burgundy",
};

export const KIND_ICON: Record<PinKind, IconComponent> = {
  page: FileText,
  note: NotebookText,
  task: CheckSquare,
  event: CalendarDays,
  database: Database,
  person: User,
  file: Paperclip,
  folder: Folder,
  form: ClipboardList,
};

/** A section page's own colour, from its path, so a row of pages isn't all grey. */
const SECTION_COLOR: Record<string, TagColor> = {
  tasks: "navy",
  meetings: "plum",
  calendar: "plum",
  forms: "teal",
  databases: "rust",
  notes: "ochre",
  people: "burgundy",
  finance: "forest",
  inbox: "navy",
  integrations: "teal",
  pulse: "forest",
};

/** A section page's own icon, from its path (/app/<org>/<section>…). */
export const SECTION_ICON: Record<string, IconComponent> = {
  tasks: CheckSquare,
  meetings: Users,
  calendar: CalendarDays,
  forms: ClipboardList,
  databases: Database,
  notes: FolderOpen,
  people: Users,
  finance: Wallet,
  inbox: Inbox,
  integrations: Plug,
  pulse: Activity,
};

/** The section a page's path names (/app/<org>/<section>…), or "" for anything but a page. */
export function pageSection(kind: PinKind, href: string): string {
  return kind === "page" ? (href.split("/")[3] ?? "") : "";
}

/** The kind's colour (a page: its section's), or the neutral ink. */
export function kindToken(kind: PinKind, href = ""): string {
  const color = KIND_COLOR[kind] ?? SECTION_COLOR[pageSection(kind, href)];
  return color ? `var(${tagToken(color)})` : "var(--muted-foreground)";
}

/** The 40px rounded square in the kind's colour, on its own tint. */
export function KindIcon({
  color,
  children,
  className,
}: {
  /** A CSS colour (`var(--tag-plum)`). */
  color: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ "--k": color } as CSSProperties}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-[12px] text-(--k) [&_svg]:size-[19px]",
        "bg-[color-mix(in_oklab,var(--k)_14%,var(--card))] ring-1 ring-[color-mix(in_oklab,var(--k)_22%,transparent)] ring-inset",
        className,
      )}
    >
      {children}
    </span>
  );
}

export const kindTileClass =
  "group/tile bg-card hover:bg-muted/50 ring-foreground/8 rounded-tile relative flex min-w-0 items-center gap-3 p-3 ring-1 transition-[background-color,transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_6px_16px_-10px_rgb(0_0_0/0.35)] motion-reduce:hover:translate-y-0";

/** One coloured tile: the kind's icon square, a title and a line under it. */
export function KindTile({
  href,
  kind,
  title,
  sub,
  className,
  draggable,
}: {
  href: string;
  kind: PinKind;
  title: string;
  sub: ReactNode;
  className?: string;
  draggable?: boolean;
}) {
  const Icon = SECTION_ICON[pageSection(kind, href)] ?? KIND_ICON[kind] ?? FileText;
  return (
    <Link href={href} draggable={draggable} className={cn(kindTileClass, className)}>
      <KindIcon color={kindToken(kind, href)}>
        <Icon />
      </KindIcon>
      <span className="min-w-0">
        <span className="block truncate text-sm leading-tight font-semibold">{title}</span>
        <span className="text-muted-foreground mt-1 block truncate text-[12.5px]">{sub}</span>
      </span>
    </Link>
  );
}
