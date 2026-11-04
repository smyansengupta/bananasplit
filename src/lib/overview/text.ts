/**
 * Small words for the Overview's written lines (the week's recap, the
 * insights under a list): counts with their noun, lists joined the way a
 * person writes them, money in whole dollars. Pure and client-safe: no
 * database, so the sentence builders that use them can be unit tested.
 */

import { formatDollars } from "@/lib/finance/money";

const SMALL = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** "1 task", "3 tasks"; `many` when the plural isn't the noun plus s. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Two reimbursements" at the start of a sentence, "12 reimbursements" past nine. */
export function countWord(n: number, one: string, many = `${one}s`, capital = false): string {
  const word = n >= 0 && n < SMALL.length ? SMALL[n] : String(n);
  const text = `${word} ${n === 1 ? one : many}`;
  return capital ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** "a", "a and b", "a, b and c" (no comma before "and", as the app writes it). */
export function listWords(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Whole dollars from cents: "$412", "$2,140" (Finance's own formatDollars). */
export const dollars = (cents: number): string => formatDollars(cents);

/** Exact dollars from cents: "$173.50", and "$84" for a round amount. */
export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** "+9", "-3", "" for no change: the move beside a stat. */
export function signed(n: number): string {
  if (n === 0) return "";
  return n > 0 ? `+${n}` : `${n}`;
}

/** Whole days between two instants, rounded down (never below 0). */
export function daysSince(at: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
}

/** "today", "yesterday", "3 days ago". */
export function daysAgoWord(at: Date, now: Date): string {
  const days = daysSince(at, now);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** A first name for a sentence ("Oliver"), or "Someone". */
export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Someone";
}
