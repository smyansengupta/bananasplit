import type { ComponentType } from "react";

import type { CrmSettingsSectionId } from "@/lib/crm/settings-sections";

import { AiSection } from "./ai";
import { ApiSection } from "./api";
import { AutomationsSection } from "./automations";
import { BookingSection } from "./booking";
import { FieldsSection } from "./fields";
import { HandoverSection } from "./handover";
import { ImportSection } from "./import";
import { PhoneSection } from "./phone";
import { SendingSection } from "./sending";
import { StagesSection } from "./stages";
import { TeamSection } from "./team";
import { TemplatesSection } from "./templates";
import type { SectionProps } from "./types";
import { YouSection } from "./you";

/** Each CRM settings section's server component, by id. */
export const CRM_SETTINGS_SECTION_VIEWS: Record<
  CrmSettingsSectionId,
  ComponentType<SectionProps>
> = {
  you: YouSection,
  automations: AutomationsSection,
  sending: SendingSection,
  stages: StagesSection,
  fields: FieldsSection,
  templates: TemplatesSection,
  booking: BookingSection,
  phone: PhoneSection,
  team: TeamSection,
  handover: HandoverSection,
  ai: AiSection,
  import: ImportSection,
  api: ApiSection,
};

export type { SectionProps };
