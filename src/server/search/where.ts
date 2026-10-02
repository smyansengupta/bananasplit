import { parseQuery } from "@/lib/search/text";

/**
 * Prisma filters for "every word somewhere": each word of the query must
 * occur in at least one of the given fields, in any order. Shared by the
 * ⌘K palette and the list pages its "Search all…" links open, so both find
 * the same records.
 */

export type Contains = { contains: string; mode: "insensitive" };

function contains(term: string): Contains {
  return { contains: term, mode: "insensitive" };
}

/**
 * `{ AND: [{ OR: fields(word1) }, { OR: fields(word2) }, ...] }` for the
 * words of `query`, or undefined when nothing was typed (no filter). Typed
 * text with no letters or digits ("#", "&") is matched as it is, so it
 * narrows the list instead of returning everything.
 */
export function everyWord<Where extends object>(
  query: string | readonly string[] | null | undefined,
  fields: (match: Contains) => Where[],
): Where | undefined {
  if (typeof query === "string") {
    const parsed = parseQuery(query);
    if (!parsed.terms.length) {
      return parsed.text ? ({ OR: fields(contains(parsed.text)) } as unknown as Where) : undefined;
    }
    return everyWord(parsed.terms, fields);
  }
  if (!query?.length) return undefined;
  return { AND: query.map((t) => ({ OR: fields(contains(t)) })) } as unknown as Where;
}
