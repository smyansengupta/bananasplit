/**
 * Legacy entry point. The Phase 0-6 modules still import `prisma` from here;
 * it is the app_legacy client (the temporary strangler role with FOR ALL
 * policies on exactly the 23 legacy tables, and no access to any new table,
 * secret or credential). New code uses @/server/db and its wrappers instead,
 * and each legacy module moves off this import in its 0C migration. When
 * none remain, this file and the app_legacy role are deleted.
 */
export { legacyDb as prisma } from "@/server/db/clients";
