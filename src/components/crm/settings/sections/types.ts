import type { CrmShell } from "@/app/app/[orgSlug]/crm/shell";

/** What every CRM settings section gets from the page. */
export interface SectionProps {
  shell: CrmShell;
  orgSlug: string;
  sp: Record<string, string | undefined>;
}
