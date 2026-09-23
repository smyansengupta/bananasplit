import type { NotificationType } from "@/generated/prisma/enums";

/**
 * Whether a user's User.emailPreferences allow email for `type`. A type
 * absent from the map is enabled (opt-out, not opt-in). Understands both the
 * flat map ({ TASK_DUE_SOON: false }) and the Phase 6 v2 shape
 * ({ v: 2, types: { ... } }). Pure and client-safe.
 */
export function isEmailEnabled(preferences: unknown, type: NotificationType): boolean {
  if (!preferences || typeof preferences !== "object") return true;
  const prefs = preferences as Record<string, unknown>;
  const map =
    prefs.v === 2 && prefs.types && typeof prefs.types === "object"
      ? (prefs.types as Record<string, unknown>)
      : prefs;
  return map[type] !== false;
}
