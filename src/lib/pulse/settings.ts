import { z } from "zod";

import { Role, type PulseAudience } from "@/generated/prisma/enums";

/**
 * The weekly pulse's settings (OrgSettings.pulse*): picked during club
 * setup (the Weekly pulse step) and changed later in Admin panel › Weekly
 * pulse. Pure and client-safe.
 */

/** Mon to Sun, in the order the segmented control shows them (values: 0 Sunday … 6 Saturday). */
export const PULSE_DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

export const DEFAULT_PULSE_DAY = 5;
export const DEFAULT_PULSE_HOUR = 17;

/** "5:00 PM" for an hour 0-23. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${h < 12 ? "AM" : "PM"}`;
}

/** Every hour of the day, for the time select. */
export const PULSE_HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: hourLabel(hour),
}));

export const PULSE_AUDIENCES: readonly { value: PulseAudience; label: string; hint: string }[] = [
  { value: "EVERYONE", label: "Everyone", hint: "Every member of the organization." },
  { value: "OFFICERS", label: "Officers", hint: "Owners, admins and treasurers." },
];

export const pulseSettingsSchema = z
  .object({
    pulseEnabled: z.boolean(),
    pulseDay: z.number().int().min(0).max(6),
    pulseHourLocal: z.number().int().min(0).max(23),
    pulseAudience: z.enum(["EVERYONE", "OFFICERS"]),
    pulseEmail: z.boolean(),
    pulseInApp: z.boolean(),
  })
  .strict();

export type PulseSettings = z.infer<typeof pulseSettingsSchema>;

export const DEFAULT_PULSE_SETTINGS: PulseSettings = {
  pulseEnabled: true,
  pulseDay: DEFAULT_PULSE_DAY,
  pulseHourLocal: DEFAULT_PULSE_HOUR,
  pulseAudience: "EVERYONE",
  pulseEmail: true,
  pulseInApp: true,
};

/** The roles "Officers" means. */
const OFFICER_ROLES: ReadonlySet<Role> = new Set([Role.OWNER, Role.ADMIN, Role.TREASURER]);

export function isOfficer(role: Role): boolean {
  return OFFICER_ROLES.has(role);
}

/** Whether a member with `role` gets the pulse under `audience`. */
export function inPulseAudience(audience: PulseAudience, role: Role): boolean {
  return audience === "EVERYONE" || isOfficer(role);
}

/** Which members get it, and by which channels (the job's recipient list). */
export function pulseRecipients<M extends { userId: string; role: Role }>(
  settings: Pick<PulseSettings, "pulseAudience" | "pulseEmail" | "pulseInApp">,
  members: readonly M[],
  emailOn: (member: M) => boolean,
): { inApp: string[]; email: string[] } {
  const audience = members.filter((m) => inPulseAudience(settings.pulseAudience, m.role));
  return {
    inApp: settings.pulseInApp ? audience.map((m) => m.userId) : [],
    email: settings.pulseEmail ? audience.filter(emailOn).map((m) => m.userId) : [],
  };
}

/** "Fridays at 5:00 PM, to everyone" for the settings page and the archive. */
export function describePulseSchedule(
  settings: Pick<PulseSettings, "pulseDay" | "pulseHourLocal" | "pulseAudience">,
): string {
  const day = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][
    settings.pulseDay
  ];
  const who = settings.pulseAudience === "OFFICERS" ? "officers" : "everyone";
  return `${day} at ${hourLabel(settings.pulseHourLocal)}, to ${who}`;
}
