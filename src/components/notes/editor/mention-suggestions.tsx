"use client";

import { PluginKey } from "@tiptap/pm/state";
import type { Editor, Range } from "@tiptap/core";
import { CalendarDays, FileText } from "@/components/icons";

import { UserAvatar } from "@/components/user-avatar";
import { dayLabel, todayKey } from "@/lib/notes/dates";
import { NoteMention } from "@/lib/notes/nodes";
import { addDaysToKey } from "@/lib/tasks/dates";
import { parseDueText } from "@/lib/tasks/due-text";

import { noteHooks } from "./note-hooks";
import { suggestionMenuRenderer, type MenuItem } from "./suggestion-menu";

/**
 * "@" mentions a member or drops in a date ("@tomorrow", "@next fri"), and
 * "[[" links another page by name. Both are the schema's own nodes
 * (mention, dateChip, noteLink); this is only the menus that insert them.
 */

export interface MentionMember {
  id: string;
  name: string | null;
  image?: string | null;
}

export interface MentionPage {
  id: string;
  title: string;
  icon: string | null;
}

type AtItem = MenuItem &
  ({ kind: "person"; id: string; label: string } | { kind: "date"; date: string });
type PageItem = MenuItem & { id: string; label: string };

function atItems(query: string, members: MentionMember[], selfId: string | null): AtItem[] {
  const needle = query.toLowerCase();
  const people: AtItem[] = members
    .filter((m) => m.id !== selfId && (m.name ?? "").toLowerCase().includes(needle))
    .slice(0, 8)
    .map((m) => ({
      kind: "person",
      key: `person-${m.id}`,
      id: m.id,
      label: m.name ?? "Member",
      title: m.name ?? "Member",
      group: "People",
      leading: <UserAvatar user={m} size="xs" />,
    }));
  const today = todayKey();
  const dates = new Map<string, string>();
  const parsed = query ? parseDueText(query, today) : null;
  if (parsed) dates.set(parsed, query);
  if (!query || "today".startsWith(needle)) dates.set(today, "today");
  if (!query || "tomorrow".startsWith(needle)) dates.set(addDaysToKey(today, 1), "tomorrow");
  if (!query) dates.set(addDaysToKey(today, 7), "next week");
  const dateItems: AtItem[] = [...dates.keys()].slice(0, 4).map((date) => ({
    kind: "date",
    key: `date-${date}`,
    date,
    title: dayLabel(date, today),
    description: date,
    icon: CalendarDays,
    group: "Dates",
  }));
  return [...people, ...dateItems];
}

function insert(editor: Editor, range: Range, node: Record<string, unknown>) {
  // A space after, unless one is already there.
  const after = editor.view.state.selection.$to.nodeAfter;
  const space = after?.text?.startsWith(" ") ? [] : [{ type: "text", text: " " }];
  editor
    .chain()
    .focus()
    .insertContentAt(range, [node, ...space])
    .run();
}

/** The mention node with the "@" and "[[" menus, for the editor's schema override. */
export function noteMentionWithMenus() {
  return NoteMention.configure({
    suggestions: [
      {
        char: "@",
        pluginKey: new PluginKey("noteAtMenu"),
        items: ({ query, editor }: { query: string; editor: Editor }) => {
          const hooks = noteHooks(editor);
          return atItems(query, hooks?.people() ?? [], hooks?.selfId() ?? null);
        },
        command: ({
          editor,
          range,
          props: raw,
        }: {
          editor: Editor;
          range: Range;
          props: unknown;
        }) => {
          const props = raw as AtItem;
          if (props.kind === "person") {
            insert(editor, range, { type: "mention", attrs: { id: props.id, label: props.label } });
          } else {
            insert(editor, range, { type: "dateChip", attrs: { date: props.date } });
          }
        },
        render: suggestionMenuRenderer<AtItem>("Mention someone or a date", "No one by that name"),
      },
      {
        char: "[[",
        allowSpaces: true,
        pluginKey: new PluginKey("notePageMenu"),
        items: ({ query, editor }: { query: string; editor: Editor }): PageItem[] => {
          const needle = query.toLowerCase().trim();
          const hooks = noteHooks(editor);
          const self = hooks?.noteId() ?? null;
          return (hooks?.pages() ?? [])
            .filter((p) => p.id !== self && p.title.toLowerCase().includes(needle))
            .slice(0, 10)
            .map((p) => ({
              key: p.id,
              id: p.id,
              label: p.title || "Untitled",
              title: p.title || "Untitled",
              group: "Pages",
              ...(p.icon
                ? {
                    leading: (
                      <span className="grid size-7 place-items-center text-base">{p.icon}</span>
                    ),
                  }
                : { icon: FileText }),
            }));
        },
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: unknown }) =>
          insert(editor, range, {
            type: "noteLink",
            attrs: { noteId: (props as PageItem).id, title: (props as PageItem).label },
          }),
        render: suggestionMenuRenderer<PageItem>("Link a page", "No page by that name"),
      },
    ],
  });
}
