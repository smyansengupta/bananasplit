import type { ComponentType } from "react";

import type { CrmSettingsSectionId } from "@/lib/crm/settings-sections";

import { AutomationsSection } from "./automations";
import { ConnectionsSection } from "./connections";
import { DealsSection } from "./deals";
import { TeamSection } from "./team";
import type { SectionProps } from "./types";
import { YouSection } from "./you";

/** Each CRM settings section's server component, by id. */
export const CRM_SETTINGS_SECTION_VIEWS: Record<
  CrmSettingsSectionId,
  ComponentType<SectionProps>
> = {
  you: YouSection,
  automations: AutomationsSection,
  deals: DealsSection,
  team: TeamSection,
  connections: ConnectionsSection,
};

export type { SectionProps };
