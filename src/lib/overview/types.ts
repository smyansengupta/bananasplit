/**
 * Types Home's server reads and client widgets share, so neither imports
 * the other: what a chip points at (src/components/overview/connections.tsx
 * draws them) and a member's face.
 */

export type ChipKind =
  | "task"
  | "event"
  | "meeting"
  | "note"
  | "file"
  | "form"
  | "poll"
  | "money"
  | "person"
  | "database"
  | "decision"
  | "announcement";

export interface ItemRef {
  kind: ChipKind;
  /** What the chip says: the item's name, or a short state ("2 open actions"). */
  label: string;
  href: string;
}

/** A member as other members may see them. */
export interface PersonFace {
  id: string;
  name: string | null;
  image: string | null;
  avatar: unknown;
}
