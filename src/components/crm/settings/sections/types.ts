import type { CrmSettingsShell } from "@/app/app/[orgSlug]/crm/shell";

/** What every CRM settings section gets from the page. */
export interface SectionProps {
  shell: CrmSettingsShell;
  orgSlug: string;
  sp: Record<string, string | undefined>;
}
