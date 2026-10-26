"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";

import { fileRefToken } from "@/lib/tasks/file-refs";
import { mentionToken } from "@/lib/tasks/mentions";

import { useTasks } from "./tasks-context";
import type { FileOption, MemberOption } from "./types";

/**
 * The typing menus a task's title and description share.
 *
 * `@` offers members and writes @[Name](user:id); `/` offers the club's
 * files and writes [Name.pdf](file:id). One hook for both, because they are
 * the same interaction — a sigil at a word boundary opens a list, arrows
 * move, Enter or Tab picks, Escape closes, and the caret lands after what
 * was written — and because a field should never have two of these open at
 * once.
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

export type TokenKind = "member" | "file";

export interface TokenChoice {
  kind: TokenKind;
  id: string;
  /** What the row reads. */
  label: string;
  member?: MemberOption;
  file?: FileOption;
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
}: {
  value: string;
  onChange: (next: string) => void;
  /** The field itself, so the caret can be put back after a pick. */
  element: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  /** Which sigils this field answers to. */
  kinds?: readonly TokenKind[];
  /** On a private task, the only people who may be mentioned. */
  audience?: readonly string[] | null;
}): TokenMenuState {
  const { members, files } = useTasks();
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

  const options = useMemo<TokenChoice[]>(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    const starts = (text: string) =>
      text
        .toLowerCase()
        .split(/[\s._-]+/)
        .some((part) => part.startsWith(q));
    if (trigger.kind === "member") {
      return mentionable
        .filter((m) => starts(m.name ?? "") || (m.name ?? "").toLowerCase().includes(q))
        .slice(0, MAX_OPTIONS)
        .map((m) => ({ kind: "member" as const, id: m.id, label: m.name ?? "Member", member: m }));
    }
    return files
      .filter((f) => starts(f.name) || f.name.toLowerCase().includes(q))
      .slice(0, MAX_OPTIONS)
      .map((f) => ({ kind: "file" as const, id: f.id, label: f.name, file: f }));
  }, [trigger, mentionable, files]);

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
          : `${fileRefToken(choice.file?.name ?? "file", choice.file?.kind ?? "file", choice.id)} `;
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
    [trigger, value, onChange, element],
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
