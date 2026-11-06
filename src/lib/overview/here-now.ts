/**
 * Here now's one finding, when there is a real one: someone online has
 * open a page you had open lately (a good moment to talk about it), or two
 * people are on the same page together. Pure and client-safe.
 */

export interface PresencePage {
  href: string;
  label: string;
}

export interface HerePerson {
  id: string;
  name: string | null;
  where: PresencePage | null;
}

export interface RecentPage extends PresencePage {
  /** ISO instant. */
  visitedAt: string;
}

export type HereFinding =
  | { kind: "visited"; person: HerePerson; page: PresencePage; visitedAt: string }
  | { kind: "together"; people: HerePerson[]; page: PresencePage }
  | null;

/** A page you opened this long ago or less still counts as yours lately. */
export const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const path = (href: string) => href.split(/[?#]/)[0]!.replace(/\/+$/, "");

export function hereFinding(
  others: readonly HerePerson[],
  recent: readonly RecentPage[],
  { now, homeHref }: { now: Date; homeHref: string },
): HereFinding {
  const home = path(homeHref);
  const lately = recent
    .filter((r) => now.getTime() - new Date(r.visitedAt).getTime() <= RECENT_WINDOW_MS)
    .filter((r) => path(r.href) !== home)
    .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
  for (const page of lately) {
    const person = others.find((p) => p.where && path(p.where.href) === path(page.href));
    if (person) return { kind: "visited", person, page: person.where!, visitedAt: page.visitedAt };
  }
  const byPage = new Map<string, HerePerson[]>();
  for (const p of others) {
    if (!p.where || path(p.where.href) === home) continue;
    const at = path(p.where.href);
    byPage.set(at, [...(byPage.get(at) ?? []), p]);
  }
  for (const people of byPage.values()) {
    if (people.length >= 2) return { kind: "together", people, page: people[0]!.where! };
  }
  return null;
}
