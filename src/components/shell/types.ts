export interface OrgSummary {
  slug: string;
  name: string;
  /** The 64px WebP logo variant, when the org has uploaded a logo. */
  logoUrl?: string | null;
  /** Scheduled for deletion: the switcher lists it apart (its URL shows the cancel page). */
  pendingDeletion?: boolean;
}

export interface ShellUser {
  name: string | null;
  email: string;
  image: string | null;
}
