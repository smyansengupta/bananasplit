/**
 * Tags (stored as Label): names, matching and the `#tag` shorthand. Pure,
 * shared by the actions (src/app/app/[orgSlug]/settings/labels/actions.ts)
 * and the pickers.
 *
 * A tag's name is unique in its club regardless of case: "Catering" and
 * "catering" are one tag, and typing either picks the one that exists.
 */

export const MAX_TAG_NAME = 40;

/** "  #Fall  showcase " -> "Fall showcase". Empty when nothing is left. */
export function cleanTagName(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, MAX_TAG_NAME).trim();
}

/** The key two names are the same tag under. */
export function tagKey(name: string): string {
  return cleanTagName(name).toLocaleLowerCase();
}

/** The existing tag with this name, ignoring case. */
export function findTag<T extends { name: string }>(tags: readonly T[], name: string): T | null {
  const key = tagKey(name);
  return key ? (tags.find((t) => tagKey(t.name) === key) ?? null) : null;
}

/**
 * A looser key for near-duplicates the Tags page offers to merge:
 * "Design", "designs" and "de-sign" all come out as "design".
 */
export function looseTagKey(name: string): string {
  const bare = tagKey(name).replace(/[^\p{L}\p{N}]+/gu, "");
  return bare.length > 3 && bare.endsWith("s") ? bare.slice(0, -1) : bare;
}

/** Groups of two or more tags that look like the same tag, biggest first. */
export function nearDuplicateGroups<T extends { name: string }>(tags: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const tag of tags) {
    const key = looseTagKey(tag.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), tag]);
  }
  return [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
}

// A tag token: "#" at the start or after a space, then letters, digits, "-" or "_".
const HASH_TAG = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

/**
 * `#tag` in a title: "Book a photographer #showcase" is the title "Book a
 * photographer" tagged "showcase". Each tag once (ignoring case), in the
 * order typed. A "#" inside a word ("C#", "issue#4") is left alone.
 */
export function extractHashTags(
  text: string,
  /** Only take out these (lower-cased names); the rest stay in the title as typed. */
  only?: ReadonlySet<string>,
): { title: string; tags: string[] } {
  const tags: string[] = [];
  const seen = new Set<string>();
  const title = text
    .replace(HASH_TAG, (match, lead: string, name: string) => {
      const clean = cleanTagName(name);
      const key = clean.toLocaleLowerCase();
      if (only && !only.has(key)) return match;
      if (clean && !seen.has(key)) {
        seen.add(key);
        tags.push(clean);
      }
      return lead;
    })
    .replace(/\s+/g, " ")
    .trim();
  return { title, tags };
}

export interface TagActor {
  isAdmin: boolean;
  /** OrgSettings.memberCanCreateTags (true when the club has no settings row). */
  membersCanCreate: boolean;
}

export function canCreateTags(actor: TagActor): boolean {
  return actor.isAdmin || actor.membersCanCreate;
}

export const TAG_CREATE_DENIED = "Only an owner or admin can make new tags in this organization.";
