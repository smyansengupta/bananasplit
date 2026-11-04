"use client";

import type { NamedTeam } from "@/lib/org-chart/teams";
import dynamic from "next/dynamic";
import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, UserPlus } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import type { DraftPosition } from "@/lib/org-chart/draft";
import { normalizeName } from "@/lib/org-chart/match";
import {
  applyOutline,
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
 * The editor's Type it tab: the org chart as an outline, one position per
 * line ("Title — @Name") with line numbers, and beside it how to write it,
 * the names that aren't members, the members not on the chart and a small
 * live chart. Tab indents (reports to the line above), Shift Tab outdents,
 * Esc then Tab leaves the field; Enter keeps the indent. "@" suggests
 * members. Every edit goes through parseOutline/applyOutline, so pasted
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
  canInvite: boolean;
  /** Opens the invite dialog. */
  onInvite?: () => void;
  /** The card's top row (the Chart and Type it tabs, Import a document). */
  toolbar?: ReactNode;
}

const KEYS: [string, string][] = [
  ["Tab", "Reports to the line above"],
  ["Shift Tab", "Moves back up a level"],
  ["@name", "Links a member"],
  ["Open:", "An open role"],
  ["Advisor:", "Sits beside their manager"],
];

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
  canInvite,
  onInvite,
  toolbar,
}: OutlineEditorProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => serializeOutline(positions, members));
  // Line number -> position id (serializeOutline writes one line per position).
  const [lineIds, setLineIds] = useState<Map<number, string>>(
    () => new Map(outlineOrder(positions).map((o, i) => [i, o.position.id])),
  );
  const [mention, setMention] = useState<Mention | null>(null);
  const escaped = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);

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

  const lineCount = Math.max(1, text.split("\n").length);
  const allMatched = positions.length > 0 && unknown.length === 0 && unknownAlso.length === 0;

  return (
    <div className="flex min-w-0 flex-wrap items-start gap-5">
      <section
        aria-label="Type the chart"
        className="bg-card edge rounded-card flex min-w-0 flex-[999_1_600px] flex-col gap-3.5 p-4 sm:p-5"
      >
        {toolbar}
        <div className="border-input bg-card rounded-tile focus-within:border-foreground relative flex overflow-hidden border focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--glow)_45%,transparent)]">
          <div
            aria-hidden="true"
            className="text-muted-foreground/70 pointer-events-none w-10 shrink-0 overflow-hidden py-3 pr-2.5 text-right text-xs tabular-nums select-none"
          >
            <div style={{ transform: `translateY(${-scrollTop}px)` }}>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className="h-10 leading-10">
                  {i + 1}
                </div>
              ))}
            </div>
          </div>
          <textarea
            id="outline-text"
            ref={ta}
            value={text}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label="Org chart outline"
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
            onScroll={(e) => {
              setScrollTop(e.currentTarget.scrollTop);
              setMention(null);
            }}
            className="min-h-[400px] w-full min-w-0 flex-1 resize-y overflow-x-auto bg-transparent py-3 pr-4 text-[15px] leading-10 whitespace-pre outline-none"
            style={{ tabSize: 2 }}
          />
          {mention && (
            <div
              id="outline-mentions"
              role="listbox"
              aria-label="Members"
              className="bg-popover text-popover-foreground rounded-tile shadow-e2 border-foreground/8 absolute z-20 w-72 border p-1.5"
              style={{ top: mention.top, left: Math.min(mention.left + 40, 9999) }}
            >
              {matches.length === 0 ? (
                <p className="text-muted-foreground px-2.5 py-2 text-sm">
                  No member called &ldquo;{mention.query.trim()}&rdquo;. It stays as a name
                  {canInvite ? " to invite" : ""}.
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
                      "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13.5px]",
                      i === mention.active ? "bg-muted" : "hover:bg-muted",
                    )}
                  >
                    <UserAvatar user={m} size="sm" />
                    <span className="min-w-0 flex-1 font-semibold break-words">{m.name}</span>
                    {m.title && (
                      <span className="text-muted-foreground text-xs break-words">{m.title}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <p id="outline-hint" className="text-muted-foreground text-[12.5px]">
          Every change shows on the chart as you type. Esc then Tab leaves the outline.
        </p>
      </section>

      <aside
        aria-labelledby="outline-key"
        className="bg-card edge rounded-card flex min-w-0 flex-[1_1_340px] flex-col gap-3.5 p-5"
      >
        <h2 id="outline-key" className="heading text-[15px]">
          How to write it
        </h2>
        <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-x-3.5 gap-y-1.5 text-[13.5px]">
          {KEYS.map(([key, what]) => (
            <Fragment key={key}>
              <dt>
                <kbd className="bg-muted rounded-lg px-2 py-1 font-sans text-[13px] font-bold">
                  {key}
                </kbd>
              </dt>
              <dd>{what}</dd>
            </Fragment>
          ))}
        </dl>

        <div className="border-t" />

        {allMatched && (
          <p className="bg-tint-success rounded-tile flex items-center gap-2.5 px-3.5 py-3 text-[13.5px]">
            <span className="bg-card text-tint-success-foreground grid size-6 shrink-0 place-items-center rounded-full">
              <Check className="size-3.5" aria-hidden="true" />
            </span>
            Every name so far matches a member.
          </p>
        )}

        {unknownAlso.length > 0 && (
          <section
            aria-label="Second managers not found"
            className="bg-tint-accent rounded-tile flex flex-col gap-1.5 px-3.5 py-3 text-[13.5px]"
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
                    , for {u.title}. Use a title or a full name from the chart.
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {unknown.length > 0 && (
          <section
            aria-label="Names that aren't members"
            className="bg-tint-danger rounded-tile flex flex-col gap-2 px-3.5 py-3 text-[13.5px]"
          >
            <p className="font-semibold">
              {unknown.length === 1
                ? "1 name isn't a member yet"
                : `${unknown.length} names aren't members yet`}
            </p>
            <ul className="flex flex-col gap-1.5">
              {unknown.map((p) => {
                const suggestion = p.suggestedUserIds[0]
                  ? memberById.get(p.suggestedUserIds[0])
                  : undefined;
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 flex-1">
                      <b className="font-semibold">{p.personName}</b>
                      <span className="text-muted-foreground">, {p.title}</span>
                    </span>
                    {suggestion && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setLinePerson(p.id, suggestion)}
                      >
                        It&apos;s {suggestion.name}
                      </Button>
                    )}
                    {canInvite && onInvite && (
                      <Button type="button" variant="ghost" size="sm" onClick={onInvite}>
                        <UserPlus aria-hidden="true" />
                        Invite
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {tray.length > 0 && (
          <section aria-labelledby="tray-title" className="flex flex-col gap-2">
            <p id="tray-title" className="text-[13px] font-semibold">
              Not on the chart{" "}
              <span className="text-muted-foreground font-normal">
                Click one to add a line, or drag it in.
              </span>
            </p>
            <ul className="flex flex-wrap gap-1.5">
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
                    className="bg-secondary hover:bg-muted-strong focus-glow inline-flex h-8 max-w-[14rem] items-center gap-2 rounded-full pr-3 pl-1 text-[13px] font-semibold outline-none"
                  >
                    <UserAvatar user={m} size="sm" />
                    <span className="truncate">{m.name ?? "Unnamed member"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {previewNodes.length > 0 && (
          <div className="rounded-tile h-[240px] overflow-hidden border">
            <ChartCanvas
              nodes={previewNodes}
              teams={teams}
              selectedId={selectedId}
              onSelect={(id) => {
                onSelect(id);
                focusLine(id);
              }}
              refitOnChange
              collapsible={false}
              flagUnknown
              ariaLabel="The chart as you type it"
            />
          </div>
        )}
      </aside>
    </div>
  );
}
