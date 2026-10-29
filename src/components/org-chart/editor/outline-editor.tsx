"use client";

import type { NamedTeam } from "@/lib/org-chart/teams";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Sparkles, UserPlus, Users } from "@/components/icons";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import type { DraftPosition } from "@/lib/org-chart/draft";
import { normalizeName } from "@/lib/org-chart/match";
import {
  applyOutline,
  draftFromMembers,
  membersOffChart,
  outlineOrder,
  parseOutline,
  serializeOutline,
  unknownAlsoReportsTo,
  unknownPeople,
} from "@/lib/org-chart/outline";
import type { ChartNodeDTO } from "@/lib/org-chart/types";
import { cn } from "@/lib/utils";

import type { EditorMember } from "./member-picker";

const ChartCanvas = dynamic(() => import("../chart-canvas"), {
  ssr: false,
  loading: () => <p className="text-muted-foreground p-4 text-sm">Loading the chart…</p>,
});

/**
 * The org chart you can type (Moonstone 12.3): a keyboard-first outline
 * beside a live chart. One position per line, "Title — @Name"; Tab
 * indents (reports to the line above), Shift+Tab outdents, Esc then Tab
 * leaves the field; Enter keeps the indent. "@" suggests members; a name
 * that is not a member is flagged with an invite. Members without a
 * position wait in the tray: click one (or drag it into the outline) to
 * add them. Every edit goes through parseOutline/applyOutline, so pasted
 * text, typing and the tray follow the same rules, and positions keep
 * their ids, bullets and confirmed links while you type.
 */

export interface OutlineEditorProps {
  positions: DraftPosition[];
  members: EditorMember[];
  onChange: (next: DraftPosition[]) => void;
  previewNodes: ChartNodeDTO[];
  /** The teams the draft names, for the preview's colours. */
  teams?: NamedTeam[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  orgSlug: string;
  canInvite: boolean;
}

const PLACEHOLDER = [
  "President — @Maya Patel",
  "  VP Events — @Ana Kim",
  "    Open: Events coordinator",
  "  Treasurer — @Jay Lin",
].join("\n");

const MIRROR_PROPS = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "tabSize",
] as const;

/** Where `pos` sits inside the textarea (no wrapping: white-space is pre). */
function caretPoint(
  ta: HTMLTextAreaElement,
  pos: number,
): { top: number; left: number; lineHeight: number } {
  const cs = getComputedStyle(ta);
  const div = document.createElement("div");
  for (const p of MIRROR_PROPS) div.style[p] = cs[p];
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre";
  div.style.left = "-9999px";
  div.style.top = "0";
  div.textContent = ta.value.slice(0, pos);
  const mark = document.createElement("span");
  mark.textContent = "​";
  div.appendChild(mark);
  document.body.appendChild(div);
  const point = {
    top: mark.offsetTop - ta.scrollTop,
    left: mark.offsetLeft - ta.scrollLeft,
    lineHeight: parseFloat(cs.lineHeight) || 22,
  };
  div.remove();
  return point;
}

/** Replaces [start, end) through the editing stack, so ⌘Z undoes it like typing. */
function replaceRange(ta: HTMLTextAreaElement, start: number, end: number, text: string): void {
  ta.focus();
  ta.setSelectionRange(start, end);
  let ok = false;
  try {
    ok = document.execCommand("insertText", false, text);
  } catch {
    ok = false;
  }
  if (!ok) {
    ta.setRangeText(text, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

interface Mention {
  start: number;
  query: string;
  top: number;
  left: number;
  active: number;
}

export function OutlineEditor({
  positions,
  members,
  onChange,
  previewNodes,
  teams,
  selectedId,
  onSelect,
  orgSlug,
  canInvite,
}: OutlineEditorProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => serializeOutline(positions, members));
  // Line number -> position id (serializeOutline writes one line per position).
  const [lineIds, setLineIds] = useState<Map<number, string>>(
    () => new Map(outlineOrder(positions).map((o, i) => [i, o.position.id])),
  );
  const [mention, setMention] = useState<Mention | null>(null);
  const escaped = useRef(false);

  const outlineMembers = useMemo(
    () => members.map((m) => ({ id: m.id, name: m.name, title: m.title })),
    [members],
  );
  const tray = useMemo(() => membersOffChart(positions, members), [positions, members]);
  const unknown = useMemo(() => unknownPeople(positions), [positions]);
  // "(also reports to ...)" names that match no position: said here, not dropped silently.
  const unknownAlso = useMemo(
    () => unknownAlsoReportsTo(positions, parseOutline(text), outlineMembers),
    [positions, text, outlineMembers],
  );
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const open = positions.filter((p) => p.isOpen).length;
  const idLine = useMemo(() => new Map([...lineIds].map(([line, id]) => [id, line])), [lineIds]);

  const matches = useMemo(() => {
    if (!mention) return [];
    const q = normalizeName(mention.query);
    return members
      .filter((m) => m.name && (!q || normalizeName(m.name).includes(q)))
      .sort(
        (a, b) =>
          Number(normalizeName(b.name ?? "").startsWith(q)) -
          Number(normalizeName(a.name ?? "").startsWith(q)),
      )
      .slice(0, 6);
  }, [mention, members]);

  function apply(value: string) {
    setText(value);
    const lines = parseOutline(value);
    const next = applyOutline(positions, lines, outlineMembers);
    setLineIds(new Map(lines.map((l, i) => [l.line, next[i].id])));
    onChange(next);
  }

  function lineAt(value: string, caret: number): number {
    return value.slice(0, caret).split("\n").length - 1;
  }

  function syncCaret(el: HTMLTextAreaElement) {
    const caret = el.selectionStart;
    const id = lineIds.get(lineAt(el.value, caret));
    if (id && id !== selectedId) onSelect(id);
    // "@" before the caret on this line opens the member list.
    const lineStart = el.value.lastIndexOf("\n", caret - 1) + 1;
    const before = el.value.slice(lineStart, caret);
    const m = /(?:^|[\s—–:|-])@([^@\n—–|]{0,40})$/.exec(before);
    if (m && el.selectionStart === el.selectionEnd) {
      const start = caret - m[1].length - 1;
      const point = caretPoint(el, start);
      setMention((prev) => ({
        start,
        query: m[1],
        top: point.top + point.lineHeight + 4,
        left: Math.max(0, point.left - 4),
        active: prev?.start === start ? prev.active : 0,
      }));
    } else {
      setMention(null);
    }
  }

  function accept(member: EditorMember) {
    const el = ta.current;
    if (!el || !mention || !member.name) return;
    replaceRange(el, mention.start, el.selectionStart, `@${member.name}`);
    setMention(null);
  }

  function indent(el: HTMLTextAreaElement, outdent: boolean) {
    const { value, selectionStart: s, selectionEnd: e } = el;
    const start = value.lastIndexOf("\n", s - 1) + 1;
    const endIndex = value.indexOf("\n", e > s ? e - 1 : e);
    const end = endIndex === -1 ? value.length : endIndex;
    const block = value.slice(start, end);
    const rows = block.split("\n");
    const next = rows.map((r) => (outdent ? r.replace(/^(?: {1,2}|\t)/, "") : `  ${r}`)).join("\n");
    if (next === block) return;
    const firstDelta =
      (outdent ? rows[0].replace(/^(?: {1,2}|\t)/, "") : `  ${rows[0]}`).length - rows[0].length;
    replaceRange(el, start, end, next);
    if (s === e)
      el.setSelectionRange(Math.max(start, s + firstDelta), Math.max(start, s + firstDelta));
    else el.setSelectionRange(start, start + next.length);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    if (mention && matches.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setMention({
          ...mention,
          active: (mention.active + step + matches.length) % matches.length,
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        accept(matches[Math.min(mention.active, matches.length - 1)]);
        return;
      }
    }
    if (e.key === "Escape") {
      if (mention) {
        e.preventDefault();
        setMention(null);
        return;
      }
      // Esc, then Tab, leaves the field (Tab alone indents).
      escaped.current = true;
      return;
    }
    if (e.key === "Tab") {
      if (escaped.current) {
        escaped.current = false;
        return;
      }
      e.preventDefault();
      indent(el, e.shiftKey);
      return;
    }
    escaped.current = false;
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // A new line starts at the same depth as this one.
      const start = el.value.lastIndexOf("\n", el.selectionStart - 1) + 1;
      const lead = /^[ \t]*/.exec(el.value.slice(start))?.[0] ?? "";
      e.preventDefault();
      replaceRange(el, el.selectionStart, el.selectionEnd, `\n${lead}`);
    }
  }

  function trayLine(m: EditorMember) {
    return `${m.title?.trim() || "Member"} — @${m.name ?? "Member"}`;
  }

  function addFromTray(m: EditorMember) {
    const el = ta.current;
    if (!el) return;
    const roots = parseOutline(el.value).filter((l) => l.parent === null).length;
    const prefix = el.value.trim() ? (el.value.endsWith("\n") ? "" : "\n") : "";
    const line = `${prefix}${roots === 1 ? "  " : ""}${trayLine(m)}`;
    replaceRange(el, el.value.length, el.value.length, line);
  }

  function setLinePerson(positionId: string, member: EditorMember) {
    const el = ta.current;
    const line = idLine.get(positionId);
    if (!el || line === undefined || !member.name) return;
    const rows = el.value.split("\n");
    const raw = rows[line];
    if (raw === undefined) return;
    const start = rows.slice(0, line).join("\n").length + (line > 0 ? 1 : 0);
    const position = positions.find((p) => p.id === positionId);
    const lead = /^[ \t]*/.exec(raw)?.[0] ?? "";
    const body = `${position?.isAdvisor ? "Advisor: " : ""}${position?.title ?? "Member"} — @${member.name}`;
    replaceRange(el, start, start + raw.length, `${lead}${body}`);
  }

  function focusLine(id: string) {
    const el = ta.current;
    const line = idLine.get(id);
    if (!el || line === undefined) return;
    const rows = el.value.split("\n");
    const end = rows.slice(0, line + 1).join("\n").length;
    el.focus();
    el.setSelectionRange(end, end);
  }

  const stats = [
    `${positions.length} ${positions.length === 1 ? "position" : "positions"}`,
    open > 0 && `${open} open`,
    unknown.length > 0 && `${unknown.length} to invite`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="outline-text" className="heading text-[15px]">
            Outline
          </label>
          {members.some((m) => m.title) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const el = ta.current;
                const drafted = draftFromMembers(outlineMembers);
                if (!el || !drafted) return;
                replaceRange(el, 0, el.value.length, drafted);
              }}
              title="Replace the outline with positions drafted from members' titles"
            >
              <Sparkles aria-hidden="true" />
              Start from members
            </Button>
          )}
        </div>
        <div className="relative">
          <textarea
            id="outline-text"
            ref={ta}
            value={text}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-describedby="outline-hint"
            aria-autocomplete="list"
            aria-controls={mention ? "outline-mentions" : undefined}
            placeholder={PLACEHOLDER}
            onChange={(e) => {
              apply(e.target.value);
              syncCaret(e.target);
            }}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => {
              if (!/^(Arrow|Home|End|Page)/.test(e.key)) return;
              if (mention && (e.key === "ArrowDown" || e.key === "ArrowUp")) return;
              syncCaret(e.currentTarget);
            }}
            onClick={(e) => syncCaret(e.currentTarget)}
            onBlur={() => window.setTimeout(() => setMention(null), 150)}
            onScroll={() => setMention(null)}
            className="border-input bg-card rounded-tile focus-visible:border-foreground min-h-[360px] w-full resize-y overflow-x-auto border px-4 py-3.5 font-mono text-[13px] leading-[1.75] whitespace-pre outline-none focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--glow)_45%,transparent)]"
            style={{ tabSize: 2 }}
          />
          {mention && (
            <div
              id="outline-mentions"
              role="listbox"
              aria-label="Members"
              className="bg-popover text-popover-foreground rounded-tile shadow-e2 border-foreground/8 absolute z-20 w-64 border p-1"
              style={{ top: mention.top, left: Math.min(mention.left, 9999) }}
            >
              {matches.length === 0 ? (
                <p className="text-muted-foreground px-2.5 py-2 text-sm">
                  No member called &ldquo;{mention.query.trim()}&rdquo;.
                  {canInvite && " It stays as a name to invite."}
                </p>
              ) : (
                matches.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={i === mention.active}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      accept(m);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-sm",
                      i === mention.active ? "bg-muted" : "hover:bg-muted",
                    )}
                  >
                    <UserAvatar user={m} size="sm" />
                    <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                    {m.title && (
                      <span className="text-muted-foreground truncate text-xs">{m.title}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <p id="outline-hint" className="text-muted-foreground text-[13px]">
          One position per line: &ldquo;Title — @Name&rdquo;. <kbd className="font-mono">Tab</kbd>{" "}
          reports to the line above, <kbd className="font-mono">Shift Tab</kbd> goes back up,{" "}
          <kbd className="font-mono">Esc</kbd> then <kbd className="font-mono">Tab</kbd> leaves the
          field. &ldquo;Open:&rdquo; marks an open role, &ldquo;Advisor:&rdquo; an advisor,
          &ldquo;(also reports to Name)&rdquo; a second manager. Paste a list or a drawn tree and it
          keeps its shape.
        </p>

        {unknownAlso.length > 0 && (
          <section
            aria-label="Second managers not found"
            className="bg-tint-accent/40 rounded-tile flex flex-col gap-1.5 p-3 text-sm"
          >
            <p className="font-semibold">
              {unknownAlso.length === 1
                ? "1 second manager isn't on the chart"
                : `${unknownAlso.length} second managers aren't on the chart`}
            </p>
            <ul className="flex flex-col gap-1">
              {unknownAlso.map((u, i) => (
                <li key={`${u.title}:${u.name}:${i}`}>
                  <b className="font-semibold">{u.name}</b>
                  <span className="text-muted-foreground">
                    {" "}
                    · for {u.title}. Use a title or a full name from the chart.
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {unknown.length > 0 && (
          <section
            aria-label="Names that aren't members"
            className="bg-tint-danger/40 rounded-tile flex flex-col gap-1.5 p-3 text-sm"
          >
            <p className="font-semibold">
              {unknown.length === 1
                ? "1 name isn't a member yet"
                : `${unknown.length} names aren't members yet`}
            </p>
            <ul className="flex flex-col gap-1">
              {unknown.map((p) => {
                const suggestion = p.suggestedUserIds[0]
                  ? memberById.get(p.suggestedUserIds[0])
                  : undefined;
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0">
                      <b className="font-semibold">{p.personName}</b>
                      <span className="text-muted-foreground"> · {p.title}</span>
                    </span>
                    {suggestion && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7"
                        onClick={() => setLinePerson(p.id, suggestion)}
                      >
                        Link {suggestion.name}
                      </Button>
                    )}
                    {canInvite && (
                      <Button asChild variant="ghost" size="sm" className="h-7">
                        <Link href={`/app/${orgSlug}/settings/members`}>
                          <UserPlus aria-hidden="true" />
                          Invite
                        </Link>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section aria-labelledby="tray-title" className="flex flex-col gap-2">
          <p
            id="tray-title"
            className="text-muted-foreground flex items-center gap-2 text-[13px] font-semibold"
          >
            <Users className="size-4" aria-hidden="true" />
            Not on the chart yet
            {tray.length > 0 && <Badge variant="secondary">{tray.length}</Badge>}
          </p>
          {tray.length === 0 ? (
            <p className="text-muted-foreground text-sm">Everyone is on the chart.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {tray.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", trayLine(m));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => addFromTray(m)}
                    title={`Add ${m.name ?? "this member"} (or drag into the outline)`}
                    className="border-foreground/25 hover:bg-muted focus-glow inline-flex h-8 items-center gap-2 rounded-full border border-dashed pr-3 pl-1 text-[13px] font-medium outline-none"
                  >
                    <UserAvatar user={m} size="sm" />
                    {m.name ?? "Unnamed member"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section
        aria-label="Live chart"
        className="bg-card edge rounded-card flex min-w-0 flex-col overflow-hidden"
      >
        <div className="flex items-center gap-2 px-5 pt-4 pb-3">
          <h2 className="heading text-[15px]">Live chart</h2>
          <span className="text-muted-foreground text-[13px]">{stats}</span>
        </div>
        <div className="h-[520px] border-t">
          {previewNodes.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              Start typing a position, or add someone from the tray.
            </p>
          ) : (
            <ChartCanvas
              nodes={previewNodes}
              teams={teams}
              selectedId={selectedId}
              onSelect={(id) => {
                onSelect(id);
                focusLine(id);
              }}
              refitOnChange
              flagUnknown
              ariaLabel="Live preview of the draft chart"
            />
          )}
        </div>
      </section>
    </div>
  );
}
