import { Prisma } from "@/generated/prisma/client";
import { generateIcsToken, hashIcsToken } from "@/lib/ics-token";
import {
  applyNotificationPreferencesPatch,
  parseNotificationPreferences,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
} from "@/lib/notifications/preferences";
import type { ProfileValues } from "@/lib/profile/schema";
import { invalidate } from "@/server/cache/invalidate";
import { tags } from "@/server/cache/tags";
import { withUserTx, type TxClient } from "@/server/db/context";
import { deleteStoredImage, storeImage, type StoredImage } from "@/server/images";

/**
 * Profile writes (Phase 2). Every function acts on the signed-in user's own
 * row only: withUserTx sets app.user_id, the 0B policy lets app_user UPDATE
 * only its own User row, and the column grant limits it to the profile
 * columns (never email or emailVerified). Callers authenticate first
 * (requireUser / getSession) and pass the session user's id.
 *
 * A name or picture change shows everywhere a person appears: the shell
 * reads them from the database per request, and the cached org chart and
 * member lists of every org the user belongs to are invalidated after
 * commit.
 */

/** The orgs whose cached people data shows this user. */
async function ownOrgIds(db: TxClient, userId: string): Promise<string[]> {
  const rows = await db.membership.findMany({
    where: { userId },
    select: { organizationId: true },
  });
  return rows.map((r) => r.organizationId);
}

function invalidatePeopleCaches(orgIds: readonly string[]): void {
  invalidate(orgIds.flatMap((id) => [tags.members(id), tags.orgChart(id)]));
}

/**
 * Saves profile fields, already validated by the schemas in
 * src/lib/profile/schema.ts (the Details or the Links section, or both).
 * Fields left undefined are not touched.
 */
export async function updateOwnProfile(
  userId: string,
  values: Partial<ProfileValues>,
): Promise<void> {
  const data: Prisma.UserUpdateInput = {};
  if (values.name !== undefined) data.name = values.name;
  if (values.pronouns !== undefined) data.pronouns = values.pronouns;
  if (values.major !== undefined) data.major = values.major;
  if (values.gradYear !== undefined) data.gradYear = values.gradYear;
  if (values.bio !== undefined) data.bio = values.bio;
  if (values.timezone !== undefined) data.timezone = values.timezone;
  if (values.links !== undefined) data.links = values.links as unknown as Prisma.InputJsonValue;
  if (Object.keys(data).length === 0) return;

  await withUserTx(userId, async ({ db }) => {
    const before = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
    await db.user.update({ where: { id: userId }, data, select: { id: true } });
    if (values.name !== undefined && before?.name !== values.name) {
      invalidatePeopleCaches(await ownOrgIds(db, userId));
    }
  });
}

/**
 * Applies a preference patch and stores the full v2 shape. The row is
 * locked first, so two quick toggles never lose each other's change.
 */
export async function updateOwnNotificationPreferences(
  userId: string,
  patch: NotificationPreferencesPatch,
): Promise<NotificationPreferences> {
  return withUserTx(userId, async ({ db }) => {
    const rows = await db.$queryRaw<{ emailPreferences: unknown }[]>`
      SELECT "emailPreferences" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (rows.length === 0) throw new Error("user not found");
    const next = applyNotificationPreferencesPatch(
      parseNotificationPreferences(rows[0].emailPreferences),
      patch,
    );
    await db.user.update({
      where: { id: userId },
      data: { emailPreferences: next as unknown as Prisma.InputJsonValue },
      select: { id: true },
    });
    return next;
  });
}

// ---------------------------------------------------------------- calendar feed

export interface NewFeedLink {
  token: string;
  createdAt: Date;
}

/**
 * Mints a new feed token for the user, stores only its sha256 (through
 * app.set_ics_token_hash) and returns the plaintext ONCE. Any previous link
 * stops working at commit.
 */
export async function rotateOwnIcsToken(userId: string): Promise<NewFeedLink> {
  const token = generateIcsToken();
  const createdAt = await withUserTx(userId, async ({ db }) => {
    const rows = await db.$queryRaw<
      { t: Date }[]
    >`SELECT app.set_ics_token_hash(${hashIcsToken(token)}) AS t`;
    return rows[0].t;
  });
  return { token, createdAt };
}

/** Clears the user's feed token: the link stops working. True if there was one. */
export async function turnOffOwnIcsFeed(userId: string): Promise<boolean> {
  return withUserTx(userId, async ({ db }) => {
    const rows = await db.$queryRaw<
      { cleared: boolean }[]
    >`SELECT app.clear_ics_token_hash() AS cleared`;
    return rows[0]?.cleared ?? false;
  });
}

// ---------------------------------------------------------------- avatar

/** Only this user's own avatar prefix may be deleted through their row. */
export function isOwnAvatar(image: unknown, userId: string): image is StoredImage {
  if (!image || typeof image !== "object") return false;
  const key = (image as { key?: unknown }).key;
  return (
    typeof key === "string" &&
    /^avatars\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(key) &&
    key.startsWith(`avatars/${userId}/`)
  );
}

async function setAvatar(userId: string, avatar: StoredImage | null): Promise<void> {
  await withUserTx(userId, async ({ db, afterCommit }) => {
    // Lock the row: two uploads racing must each delete the one they replaced.
    const rows = await db.$queryRaw<{ avatar: unknown }[]>`
      SELECT "avatar" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (rows.length === 0) throw new Error("user not found");
    const previous = rows[0].avatar;
    await db.user.update({
      where: { id: userId },
      data: { avatar: avatar ? (avatar as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
      select: { id: true },
    });
    invalidatePeopleCaches(await ownOrgIds(db, userId));
    // The old variants go only after the new row is committed; a failure is
    // logged by the wrapper and leaves unreferenced files, never a broken
    // picture.
    if (isOwnAvatar(previous, userId) && previous.key !== avatar?.key) {
      afterCommit(() => deleteStoredImage(previous));
    }
  });
}

/**
 * Re-encodes `bytes` (JPEG, PNG or WebP; sniffed, never trusted) into the
 * 64/128/256 WebP variants in the public store, points User.avatar at them
 * and deletes the previous variants after commit. Throws ImageRejectedError
 * for anything that is not a readable image. Call outside any transaction.
 */
export async function replaceOwnAvatar(userId: string, bytes: Buffer): Promise<StoredImage> {
  const stored = await storeImage("avatars", userId, "avatar", bytes);
  try {
    await setAvatar(userId, stored);
  } catch (error) {
    // The row never pointed at the new files: remove them again.
    await deleteStoredImage(stored).catch(() => undefined);
    throw error;
  }
  return stored;
}

/** Removes the uploaded picture (the OAuth image or initials show again). */
export async function removeOwnAvatar(userId: string): Promise<void> {
  await setAvatar(userId, null);
}
