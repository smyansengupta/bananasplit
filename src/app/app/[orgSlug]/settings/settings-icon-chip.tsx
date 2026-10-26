"use client";

import {
  Bot,
  Building2,
  CalendarSync,
  Database,
  Globe,
  Mail,
  Plug,
  Sparkles,
  Video,
  type IconComponent,
} from "@/components/icons";

import { IconChip } from "@/components/ui/stat";

import { SETTINGS_ICONS } from "./settings-icons";

/** Icons the settings pages put in chips, by name (server pages can't pass the component). */
const ICONS: Record<string, IconComponent> = {
  ...SETTINGS_ICONS,
  Bot,
  CalendarSync,
  Database,
  Globe,
  Mail,
  Plug,
  Sparkles,
  Video,
};

/**
 * The shared IconChip, picked by icon name, so server-rendered settings
 * pages (the overview tiles, the integrations list) can use it.
 */
export function SettingsIconChip({
  icon,
  size = "sm",
  className,
}: {
  icon: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return <IconChip icon={ICONS[icon] ?? Building2} size={size} className={className} />;
}
