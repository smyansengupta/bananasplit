"use client";

import { generateJSON, generateText } from "@tiptap/core";
import {
  CalendarDays,
  ChevronRight,
  FileText,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Plus,
  Star,
  Target,
  Users,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createNote, importNote, updateNoteSettings } from "@/app/app/[orgSlug]/notes/actions";
import { toast } from "@/components/ui/toaster";
import { noteSchemaExtensions } from "@/lib/notes/schema-extensions";
import { NOTE_TEMPLATES } from "@/lib/notes/templates";
import { buildNoteTree, canNestUnder, type TreeNode, type TreeNote } from "@/lib/notes/tree";
import { cn } from "@/lib/utils";

/**
 * The notes sidebar (Moonstone 13.1): Favorites (the pages you pinned),
 * every page you can see as a tree of nested pages, and Templates. Expand
 * and collapse with the chevrons (remembered in this browser); drag a page
 * onto another to put it inside, or onto "Pages" to take it back to the
 * top level. The database refuses a move that would loop or that you may
 * not make; the tree says so.
 */

const PAGE_MIME = "application/x-bananasplit-page";

const TEMPLATE_ICONS: Record<string, IconComponent> = { Users, CalendarDays, Target, ListChecks };

export interface TreePage extends TreeNote {
  updatedAt?: Date | string;
}

export function NotesTree({
  orgId,
  orgSlug,
  currentId,
  pages,
  favoriteIds,
  onNavigate,
}: {
  orgId: string;
  orgSlug: string;
  currentId: string | null;
  pages: TreePage[];
  favoriteIds: string[];
  /** Called after following a link (the phone sheet closes). */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Chevrons the viewer clicked (id -> open); the pages above this one start open.
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
  const [over, setOver] = useState<string | null>(null);
  const tree = useMemo(() => buildNoteTree(pages), [pages]);
  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const base = `/app/${orgSlug}/notes`;

  const open = useMemo(() => {
    const result = new Set<string>();
    let parent = currentId ? byId.get(currentId)?.parentId : null;
    while (parent && !result.has(parent)) {
      result.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    for (const [id, isOpen] of toggled) {
      if (isOpen) result.add(id);
      else result.delete(id);
    }
    return result;
  }, [currentId, byId, toggled]);

  function setOpenFor(id: string, isOpen: boolean) {
    setToggled((prev) => new Map(prev).set(id, isOpen));
  }

  function toggle(id: string) {
    setOpenFor(id, !open.has(id));
  }

  function newPage(parentId: string | null) {
    start(async () => {
      const result = await createNote(orgId, { parentId });
      if (result.error || !result.noteId) {
        toast({ title: result.error ?? "Couldn't make the page", tone: "error" });
        return;
      }
      if (parentId) setOpenFor(parentId, true);
      onNavigate?.();
      router.push(`${base}/${result.noteId}`);
    });
  }

  function fromTemplate(templateId: string) {
    const template = NOTE_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    start(async () => {
      const extensions = noteSchemaExtensions();
      const today = new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date());
      const json = generateJSON(template.html(today), extensions);
      const result = await importNote(orgId, {
        title: template.title,
        contentJson: JSON.stringify(json),
        contentText: generateText(json, extensions).slice(0, 200_000),
        visibility: "PRIVATE",
      });
      if (result.error || !result.noteId) {
        toast({ title: result.error ?? "Couldn't start from the template", tone: "error" });
        return;
      }
      onNavigate?.();
      router.push(`${base}/${result.noteId}`);
    });
  }

  function move(id: string, parentId: string | null) {
    setOver(null);
    const page = byId.get(id);
    if (!page || page.parentId === parentId) return;
    if (!canNestUnder(pages, id, parentId)) {
      toast({ title: "A page can't go inside one of its own subpages", tone: "error" });
      return;
    }
    start(async () => {
      const result = await updateNoteSettings(orgId, id, { parentId });
      if (result.error) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      if (parentId) setOpenFor(parentId, true);
      const target = parentId ? byId.get(parentId)?.title || "Untitled" : "the top level";
      toast({
        title: `Moved into ${target}`,
        description: page.title || "Untitled",
        tone: "success",
      });
      router.refresh();
    });
  }

  const dropProps = (parentId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes(PAGE_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(parentId ?? "root");
    },
    onDragLeave: () => setOver((o) => (o === (parentId ?? "root") ? null : o)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(PAGE_MIME);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      move(id, parentId);
    },
  });

  function row(page: TreePage, depth: number, children: TreeNode<TreePage>[] | null) {
    const active = page.id === currentId;
    const expanded = open.has(page.id);
    const href = `${base}/${page.id}`;
    return (
      <div
        {...(children ? dropProps(page.id) : {})}
        className={cn(
          "group flex h-8 items-center gap-0.5 rounded-xl pr-1 text-[13px] transition-colors",
          active
            ? "bg-muted text-foreground font-semibold"
            : "text-muted-foreground hover:bg-muted/60",
          over === page.id && "ring-ring bg-muted ring-2",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {children ? (
          <button
            type="button"
            onClick={() => toggle(page.id)}
            aria-label={
              expanded
                ? `Collapse ${page.title || "Untitled"}`
                : `Expand ${page.title || "Untitled"}`
            }
            aria-expanded={children.length > 0 ? expanded : undefined}
            className={cn(
              "hover:bg-muted-strong grid size-6 shrink-0 place-items-center rounded-lg",
              children.length === 0 && "invisible",
            )}
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform duration-200", expanded && "rotate-90")}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <Link
          href={href}
          draggable
          onClick={onNavigate}
          onDragStart={(e) => {
            e.dataTransfer.setData(PAGE_MIME, page.id);
            e.dataTransfer.setData("text/uri-list", `${window.location.origin}${href}`);
            e.dataTransfer.effectAllowed = "move";
          }}
          aria-current={active ? "page" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1"
        >
          {page.icon ? (
            <span className="w-4 shrink-0 text-center text-sm leading-none" aria-hidden="true">
              {page.icon}
            </span>
          ) : (
            <FileText className="size-4 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{page.title || "Untitled"}</span>
        </Link>
        {children && (
          <button
            type="button"
            onClick={() => newPage(page.id)}
            aria-label={`New page inside ${page.title || "Untitled"}`}
            title="New page inside"
            className="hover:bg-muted-strong grid size-6 shrink-0 place-items-center rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  function branch(nodes: TreeNode<TreePage>[], depth: number): React.ReactNode {
    return nodes.map((node) => (
      <li key={node.note.id}>
        {row(node.note, depth, node.children)}
        {node.children.length > 0 && open.has(node.note.id) && (
          <ul>{branch(node.children, depth + 1)}</ul>
        )}
      </li>
    ));
  }

  const favorites = favoriteIds.map((id) => byId.get(id)).filter((p): p is TreePage => Boolean(p));

  return (
    <nav aria-label="Pages" className={cn("flex flex-col gap-1", pending && "opacity-80")}>
      <button
        type="button"
        onClick={() => newPage(null)}
        disabled={pending}
        className="text-foreground hover:bg-muted mb-1 flex h-9 items-center gap-2 rounded-xl px-2.5 text-[13px] font-medium"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="size-4" aria-hidden="true" />
        )}
        New page
      </button>

      {favorites.length > 0 && (
        <>
          <p className="text-muted-foreground px-2.5 pt-2 pb-1 text-xs font-semibold">Favorites</p>
          <ul>
            {favorites.map((page) => (
              <li key={`fav-${page.id}`}>
                <Link
                  href={`${base}/${page.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-xl px-2.5 text-[13px]",
                    page.id === currentId
                      ? "bg-muted text-foreground font-semibold"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {page.icon ? (
                    <span className="w-4 text-center text-sm leading-none" aria-hidden="true">
                      {page.icon}
                    </span>
                  ) : (
                    <Star className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{page.title || "Untitled"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <p
        {...dropProps(null)}
        className={cn(
          "text-muted-foreground rounded-lg px-2.5 pt-2 pb-1 text-xs font-semibold",
          over === "root" && "ring-ring bg-muted ring-2",
        )}
        title="Drop a page here to take it to the top level"
      >
        Pages
      </p>
      {tree.length === 0 ? (
        <p className="text-muted-foreground px-2.5 text-xs">No pages yet.</p>
      ) : (
        <ul>{branch(tree, 0)}</ul>
      )}

      <p className="text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-semibold">Templates</p>
      <ul>
        {NOTE_TEMPLATES.map((t) => {
          const Icon = TEMPLATE_ICONS[t.icon] ?? LayoutTemplate;
          return (
            <li key={t.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => fromTemplate(t.id)}
                title={t.description}
                className="text-muted-foreground hover:bg-muted/60 flex h-8 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[13px]"
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{t.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
