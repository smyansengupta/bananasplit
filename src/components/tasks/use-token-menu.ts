"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { addLinkAction } from "@/app/app/[orgSlug]/links/actions";
import { searchWorkspaceAction } from "@/app/app/[orgSlug]/search/actions";
import { linkRefOfHit, type LinkRef } from "@/lib/links";
import { fileRefToken } from "@/lib/tasks/file-refs";
import { mentionToken } from "@/lib/tasks/mentions";

import { useTasks } from "./tasks-context";
import type { FileOption, MemberOption } from "./types";

/**
 * The typing menus a task's title and description share.
 *
 * `@` offers members and writes @[Name](user:id); `/` offers the organization's
 * files and writes [Name.pdf](file:id). One hook for both, because they are
 * the same interaction — a sigil at a word boundary opens a list, arrows
 * move, Enter or Tab picks, Escape closes, and the caret lands after what
 * was written — and because a field should never have two of these open at
 * once.
 *
 * With `linkFrom` (a saved task), `@` also searches the space once two
 * letters are typed: a meeting, a form, another task. Picking one writes
 * [Title](/app/...) and records an ItemLink, so each page lists the other.
 *
 * It owns no markup: the field keeps its own element and renders
 * <TokenMenu> with what this returns, so an <input> (the title) and a
 * <textarea> (the description) behave alike.
 */

/** A sigil at the start of the text, after a space, or after an opening bracket. */
const MEMBER_TRIGGER = /(?:^|[\s(])@([\p{L}\p{N}._'-]{0,30})$/u;
/** `/` the same way. No spaces in the query: a file is found by a word in its name. */
const FILE_TRIGGER = /(?:^|[\s(])\/([\p{L}\p{N}._'-]{0,40})$/u;

const MAX_OPTIONS = 8;
const MAX_ITEMS = 5;
const ITEM_QUERY_MIN = 2;

export type TokenKind = "member" | "file";

export interface LinkableOption {
  ref: LinkRef;
  title: string;
  href: string;
  detail?: string | null;
}

export interface TokenChoice {
  kind: TokenKind | "item";
  id: string;
  /** What the row reads. */
  label: string;
  member?: MemberOption;
  file?: FileOption;
  item?: LinkableOption;
}

interface Trigger {
  kind: TokenKind;
  query: string;
  /** Where the sigil is, and where the caret was: the span to replace. */
  start: number;
  end: number;
}

export interface TokenMenuState {
  open: boolean;
  /** The list's id, for the field's aria-controls. */
  listId: string;
  options: TokenChoice[];
  highlight: number;
  setHighlight: (index: number) => void;
  /** Which sigil is open, for the menu's heading. */
  kind: TokenKind | null;
  /** Call on every change with the new text and where the caret is. */
  detect: (text: string, caret: number) => void;
  /** Writes the picked token in and closes. */
  pick: (choice: TokenChoice) => void;
  /** Arrow keys, Enter, Tab, Escape while the menu is open. True: handled. */
  handleKey: (event: React.KeyboardEvent) => boolean;
  close: () => void;
}

export function useTokenMenu({
  value,
  onChange,
  element,
  kinds = ["member", "file"],
  audience,
  linkFrom,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The field itself, so the caret can be put back after a pick. */
  element: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  /** Which sigils this field answers to. */
  kinds?: readonly TokenKind[];
  /** On a private task, the only people who may be mentioned. */
  audience?: readonly string[] | null;
  /** The saved task this text belongs to: `@` can then link anything to it. */
  linkFrom?: LinkRef | null;
}): TokenMenuState {
  const { members, files, org } = useTasks();
  const [found, setFound] = useState<{ query: string; items: LinkableOption[] } | null>(null);
  const listId = useId();
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [highlight, setHighlight] = useState(0);
  // Picking moves the caret, which fires another detect; this keeps the menu
  // from reopening on the sigil it has just consumed.
  const justPicked = useRef(false);

  const mentionable = useMemo(
    () => (audience ? members.filter((m) => audience.includes(m.id)) : members),
    [members, audience],
  );

  // `@` plus two letters also asks the space's search (a beat after typing stops).
  const fromKind = linkFrom?.kind;
  const fromId = linkFrom?.id;
  const itemQuery =
    fromKind && trigger?.kind === "member" && trigger.query.length >= ITEM_QUERY_MIN
      ? trigger.query
      : null;
  useEffect(() => {
    if (!itemQuery || !fromKind) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await searchWorkspaceAction(org.id, { query: itemQuery, scope: "all" });
        if (!live) return;
        const items = (result.groups ?? [])
          .flatMap((g) => g.hits)
          .flatMap((hit) => {
            const ref = linkRefOfHit(hit);
            if (!ref || ref.kind === "person") return [];
            if (ref.kind === fromKind && ref.id === fromId) return [];
            return [{ ref, title: hit.title, href: hit.href, detail: hit.detail }];
          })
          .slice(0, MAX_ITEMS);
        setFound({ query: itemQuery, items });
      } catch {
        // No search: the member list still works.
      }
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [itemQuery, fromKind, fromId, org.id]);

  const options = useMemo<TokenChoice[]>(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    const starts = (text: string) =>
      text
        .toLowerCase()
        .split(/[\s._-]+/)
        .some((part) => part.startsWith(q));
    if (trigger.kind === "member") {
      const people = mentionable
        .filter((m) => starts(m.name ?? "") || (m.name ?? "").toLowerCase().includes(q))
        .slice(0, MAX_OPTIONS)
        .map((m) => ({ kind: "member" as const, id: m.id, label: m.name ?? "Member", member: m }));
      const items =
        found && itemQuery && found.query === itemQuery
          ? found.items.map((item) => ({
              kind: "item" as const,
              id: `${item.ref.kind}:${item.ref.id}`,
              label: item.title || "Untitled",
              item,
            }))
          : [];
      return [...people, ...items];
    }
    return files
      .filter((f) => starts(f.name) || f.name.toLowerCase().includes(q))
      .slice(0, MAX_OPTIONS)
      .map((f) => ({ kind: "file" as const, id: f.id, label: f.name, file: f }));
  }, [trigger, mentionable, files, found, itemQuery]);

  const close = useCallback(() => setTrigger(null), []);

  const detect = useCallback(
    (text: string, caret: number) => {
      if (justPicked.current) {
        justPicked.current = false;
        setTrigger(null);
        return;
      }
      const before = text.slice(0, caret);
      const checks: [TokenKind, RegExp][] = [
        ["member", MEMBER_TRIGGER],
        ["file", FILE_TRIGGER],
      ];
      for (const [kind, pattern] of checks) {
        if (!kinds.includes(kind)) continue;
        const match = pattern.exec(before);
        if (!match) continue;
        const query = match[1] ?? "";
        setTrigger({ kind, query, start: caret - query.length - 1, end: caret });
        setHighlight(0);
        return;
      }
      setTrigger(null);
    },
    [kinds],
  );

  const pick = useCallback(
    (choice: TokenChoice) => {
      if (!trigger) return;
      const token =
        choice.kind === "member"
          ? `${mentionToken(choice.member?.name ?? "member", choice.id)} `
          : choice.kind === "item" && choice.item
            ? `${itemLinkToken(choice.item)} `
            : `${fileRefToken(choice.file?.name ?? "file", choice.file?.kind ?? "file", choice.id)} `;
      if (choice.kind === "item" && choice.item && fromKind && fromId) {
        void addLinkAction(org.id, org.slug, { kind: fromKind, id: fromId }, choice.item.ref);
      }
      const next = value.slice(0, trigger.start) + token + value.slice(trigger.end);
      justPicked.current = true;
      onChange(next);
      setTrigger(null);
      const caret = trigger.start + token.length;
      requestAnimationFrame(() => {
        element.current?.focus();
        element.current?.setSelectionRange(caret, caret);
      });
    },
    [trigger, value, onChange, element, fromKind, fromId, org.id, org.slug],
  );

  const open = trigger !== null && options.length > 0;

  const handleKey = useCallback(
    (event: React.KeyboardEvent) => {
      if (!open) return false;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((h) => (h + 1) % options.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((h) => (h - 1 + options.length) % options.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(options[highlight]!);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setTrigger(null);
        return true;
      }
      return false;
    },
    [open, options, highlight, pick],
  );

  return {
    open,
    listId,
    options,
    highlight,
    setHighlight,
    kind: trigger?.kind ?? null,
    detect,
    pick,
    handleKey,
    close,
  };
}

/** [Title](/app/...): an ordinary link to the thing, read by any markdown. */
function itemLinkToken(item: LinkableOption): string {
  const clean =
    item.title
      .replace(/[[\]()\n\r]/g, "")
      .trim()
      .slice(0, 120) || "Link";
  return `[${clean}](${item.href})`;
}
