import { shortHash } from "@/lib/sidebar-mode";

/**
 * Your own arrangement of the sidebar, on top of the organization's
 * (OrgSettings.sidebar, src/lib/nav/sidebar.ts): the order of the rows
 * inside each group, and the rows you'd rather not see. It only tidies
 * your sidebar: a hidden page is still in Search and still opens.
 *
 * Kept per member and per organization in a cookie, like the sidebar's mode
 * (src/lib/sidebar-mode.ts), so the server renders it from the first byte.
 * A display preference with nothing to protect. Pure and client-safe.
 */

export interface MySidebar {
  /** Row ids in the order you put them; rows not listed keep their place after these. */
  order: string[];
  /** Row ids you hid. */
  hidden: string[];
}

export const EMPTY_MY_SIDEBAR: MySidebar = { order: [], hidden: [] };

/** Home can't be hidden: it's where the logo and every "back" lead. */
export const ALWAYS_SHOWN = new Set(["overview"]);

const ID = /^[a-z0-9-]{1,40}$/;
const MAX_IDS = 40;

/** The cookie for this member in this organization. */
export function mySidebarCookieName(userId: string, orgId: string): string {
  return `sbrows_${shortHash(userId)}_${shortHash(orgId)}`;
}

function ids(part: string | undefined): string[] {
  if (!part) return [];
  return [...new Set(part.split(".").filter((id) => ID.test(id)))].slice(0, MAX_IDS);
}

/** A stored value as an arrangement; anything unreadable is the organization's own. */
export function parseMySidebar(raw: string | null | undefined): MySidebar {
  if (!raw) return EMPTY_MY_SIDEBAR;
  let text: string;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return EMPTY_MY_SIDEBAR;
  }
  const [order, hidden] = text.split("~");
  return { order: ids(order), hidden: ids(hidden).filter((id) => !ALWAYS_SHOWN.has(id)) };
}

/** The document.cookie assignment that stores `value` under `name` for a year. */
export function serializeMySidebarCookie(name: string, value: MySidebar, secure: boolean): string {
  const empty = value.order.length === 0 && value.hidden.length === 0;
  const body = encodeURIComponent(`${value.order.join(".")}~${value.hidden.join(".")}`);
  const parts = [`${name}=${empty ? "" : body}`, "Path=/", "SameSite=Lax"];
  parts.push(empty ? "Max-Age=0" : `Max-Age=${60 * 60 * 24 * 365}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * The organization's groups in your order, without the rows you hid
 * (`keepHidden` keeps them, for editing). Groups left empty drop out.
 */
export function arrangeSections<S extends { items: { id: string }[] }>(
  sections: readonly S[],
  my: MySidebar,
  { keepHidden = false }: { keepHidden?: boolean } = {},
): S[] {
  const rank = new Map(my.order.map((id, i) => [id, i]));
  const hidden = new Set(my.hidden);
  return sections
    .map((section) => {
      const items = section.items
        .map((item, i) => ({ item, i }))
        .sort(
          (a, b) => (rank.get(a.item.id) ?? MAX_IDS + a.i) - (rank.get(b.item.id) ?? MAX_IDS + b.i),
        )
        .map(({ item }) => item)
        .filter((item) => keepHidden || !hidden.has(item.id) || ALWAYS_SHOWN.has(item.id));
      return { ...section, items };
    })
    .filter((section) => section.items.length > 0);
}

/** `my` with one group's rows now in `groupIds` order (the rest of the order kept). */
export function reorderGroup(
  my: MySidebar,
  sections: readonly { items: { id: string }[] }[],
  groupIds: string[],
): MySidebar {
  const arranged = arrangeSections(sections, my, { keepHidden: true });
  const moved = new Set(groupIds);
  const order = arranged.flatMap((section) =>
    section.items.some((item) => moved.has(item.id)) ? groupIds : section.items.map((i) => i.id),
  );
  return { ...my, order };
}

/** `my` with `id` hidden, or shown again. */
export function toggleHidden(my: MySidebar, id: string): MySidebar {
  if (ALWAYS_SHOWN.has(id)) return my;
  const hidden = my.hidden.includes(id) ? my.hidden.filter((h) => h !== id) : [...my.hidden, id];
  return { ...my, hidden };
}
