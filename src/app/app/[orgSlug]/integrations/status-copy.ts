import type { IntegrationProvider } from "@/generated/prisma/enums";
import type { IntegrationDto } from "@/server/integrations/catalog";

/** An integration's state in words (shared by the server pages and the client panels). */
export const STATUS_COPY: Record<IntegrationDto["status"], string> = {
  CONNECTED: "Connected",
  ERROR: "Error",
  NEEDS_REAUTH: "Needs reconnecting",
  DISCONNECTED: "Not connected",
  NOT_SET_UP: "Not set up",
};

/** Its chip: success when it works, destructive when it broke, neutral otherwise. */
export function statusVariant(
  status: IntegrationDto["status"],
): "success" | "destructive" | "secondary" {
  if (status === "CONNECTED") return "success";
  if (status === "ERROR" || status === "NEEDS_REAUTH") return "destructive";
  return "secondary";
}

/** Each provider's icon (a name SettingsIconChip knows). */
export const PROVIDER_ICONS: Record<IntegrationProvider, string> = {
  EMAIL_RESEND: "Mail",
  CLAUDE: "Sparkles",
  OPENAI_COMPATIBLE: "Bot",
  GOOGLE_CALENDAR: "CalendarSync",
  SUPABASE_SOURCE: "Database",
  NETLIFY_BUILD_HOOK: "Globe",
  GOOGLE_MEET: "Video",
  ZOOM: "Video",
  MICROSOFT_TEAMS: "Video",
};

const checkedFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/**
 * The integration page's live one-line summary: its state and when it was
 * last checked ("Connected, checked Oct 12"). The key's last four
 * characters show once, in the Connection card, not here as well.
 */
export function integrationSummary(dto: IntegrationDto, _secretLabel = "key"): string {
  const parts = [STATUS_COPY[dto.status]];
  if (dto.lastVerifiedAt)
    parts.push(`checked ${checkedFormat.format(new Date(dto.lastVerifiedAt))}`);
  return parts.join(", ");
}
