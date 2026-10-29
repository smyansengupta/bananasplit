import { spaceLimits, spaceRefusal, type SpaceInfo } from "./space";

/**
 * Storage limits (redesign guide 11.2), pure and client-safe: the numbers
 * live in PLAN_LIMITS (src/lib/billing/features.ts), the running total in
 * Organization.storageUsedBytes (kept by the database: files, receipts,
 * note history and the trash, until it is emptied). The server's upload
 * gate (src/server/storage/quota.ts) asks uploadRefusal(); the storage page
 * and the banners ask storageLevel().
 *
 *   uploadRefusal(space, size)   // null, or the 4xx to answer with
 *   storageLevel(used, limit)    // "ok" | "warning" (80%) | "full" (100%)
 *   formatStorage(bytes)         // "98.7 GB", "312 MB"
 *
 * Nothing is ever deleted for being over: a full space (or one a downgrade
 * left over its limit) refuses uploads until it is back under, and
 * everything else keeps working.
 */

/** Owners and admins (or the Personal owner) hear about storage from here. */
export const STORAGE_WARNING_RATIO = 0.8;

export type StorageLevel = "ok" | "warning" | "full";

/** Where `used` stands against `limit`: under 80%, from 80%, or at (or over) 100%. */
export function storageLevel(used: number, limit: number): StorageLevel {
  if (limit <= 0 || used >= limit) return "full";
  return used >= limit * STORAGE_WARNING_RATIO ? "warning" : "ok";
}

/** Whether going from `before` to `after` bytes crosses 80% of `limit` upwards (one email per crossing). */
export function crossesWarning(before: number, after: number, limit: number): boolean {
  const line = limit * STORAGE_WARNING_RATIO;
  return before < line && after >= line;
}

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

function trim(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.0+$/, "");
}

/**
 * Bytes as people read them: "1 GB", "98.7 GB", "312 MB", "4.5 MB", "18 KB".
 * Binary units (a GB is 1024 MB), as PLAN_LIMITS counts them.
 */
export function formatStorage(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n >= GB) return `${trim(n / GB, n >= 100 * GB ? 0 : 1)} GB`;
  if (n >= MB) return `${trim(n / MB, n >= 10 * MB ? 0 : 1)} MB`;
  if (n >= KB) return `${Math.round(n / KB)} KB`;
  return `${n} B`;
}

/** The used figure next to the limit, never rounding up to look full ("99.9 GB", not "100 GB"). */
export function formatUsed(used: number, limit: number): string {
  const text = formatStorage(used);
  if (used < limit && text === formatStorage(limit)) {
    const unit = limit >= GB ? GB : MB;
    return `${(Math.floor((used / unit) * 10) / 10).toFixed(1)} ${unit === GB ? "GB" : "MB"}`;
  }
  return text;
}

/**
 * Bytes in the unit the plan's allowance is given in, the way the guide
 * writes the meter: "0 GB of 500 GB", "62.4 GB of 100 GB", "312 MB of
 * 1 GB" stays "0.3 GB". One decimal, trailing ".0" dropped; anything above
 * zero but under a tenth reads "<0.1 GB", so a used space never shows 0.
 */
export function formatInLimitUnit(bytes: number, limit: number): string {
  const unit = limit >= GB ? GB : MB;
  const name = unit === GB ? "GB" : "MB";
  const n = Math.max(0, bytes) / unit;
  if (n === 0) return `0 ${name}`;
  if (n < 0.1) return `<0.1 ${name}`;
  // Never round up to look full: floor to the tenth.
  return `${trim(Math.floor(n * 10) / 10, 1)} ${name}`;
}

/** What the gate needs to know about the space. */
export interface StorageSpace extends SpaceInfo {
  /** Organization.storageUsedBytes (a BIGINT: Prisma hands back a bigint). */
  storageUsedBytes: bigint | number;
}

export interface StorageState {
  usedBytes: number;
  limitBytes: number;
  maxFileBytes: number;
  freeBytes: number;
  level: StorageLevel;
}

export function storageState(space: StorageSpace): StorageState {
  const limits = spaceLimits(space);
  const usedBytes = Number(space.storageUsedBytes);
  return {
    usedBytes,
    limitBytes: limits.storageBytes,
    maxFileBytes: limits.maxFileBytes,
    freeBytes: Math.max(0, limits.storageBytes - usedBytes),
    level: storageLevel(usedBytes, limits.storageBytes),
  };
}

/** Why an upload is refused: the space, the file's size, or the space's room. */
export type UploadRefusalReason = "feature" | "too-large" | "full";

export interface UploadRefusal {
  /** The HTTP status the routes answer with (always a 4xx). */
  status: 403 | 413;
  /** A sentence for the person, with the numbers. */
  error: string;
  code: "SPACE_FEATURE" | "FILE_TOO_LARGE" | "STORAGE_FULL";
  refused: UploadRefusalReason;
  sizeBytes: number;
  usedBytes: number;
  limitBytes: number;
  maxFileBytes: number;
}

export interface UploadCheckOptions {
  /** The feature the upload belongs to: Notes files ("files") or receipts ("finance"). */
  feature: "files" | "finance";
  /**
   * The route's own cap, when it is lower than the plan's largest file
   * (receipts stop at 4 MB, whatever the plan).
   */
  routeMaxBytes?: number;
  /** Owners and admins (and the Personal owner) are told to upgrade; members to ask them. */
  canManagePlan?: boolean;
  now?: Date;
}

/**
 * Whether an upload of `sizeBytes` may start: the space includes the
 * feature (spaceRefusal, the same gate as actions), the
 * file is within the plan's largest file (and the route's cap), and it
 * fits: used + size ≤ the plan's storage. The trash counts until it is
 * emptied, so emptying it is one way to make room.
 */
export function uploadRefusal(
  space: StorageSpace,
  sizeBytes: number,
  options: UploadCheckOptions,
): UploadRefusal | null {
  const state = storageState(space);
  const base = {
    sizeBytes,
    usedBytes: state.usedBytes,
    limitBytes: state.limitBytes,
    maxFileBytes: state.maxFileBytes,
  };
  const refusal = spaceRefusal(space, { feature: options.feature }, options.now);
  if (refusal) {
    return {
      ...base,
      status: 403,
      error: refusal.error,
      code: "SPACE_FEATURE",
      refused: refusal.refused,
    };
  }
  const cap = Math.min(state.maxFileBytes, options.routeMaxBytes ?? Infinity);
  if (sizeBytes > cap) {
    const byPlan = cap === state.maxFileBytes;
    return {
      ...base,
      status: 413,
      error: byPlan
        ? `This file is ${formatStorage(sizeBytes)}. Your plan allows files up to ${formatStorage(cap)}.`
        : `This file is ${formatStorage(sizeBytes)}. Files here can be up to ${formatStorage(cap)}.`,
      code: "FILE_TOO_LARGE",
      refused: "too-large",
    };
  }
  if (state.usedBytes + sizeBytes > state.limitBytes) {
    return {
      ...base,
      status: 403,
      error: fullMessage(state, options),
      code: "STORAGE_FULL",
      refused: "full",
    };
  }
  return null;
}

function fullMessage(state: StorageState, options: UploadCheckOptions): string {
  const used = `${formatUsed(state.usedBytes, state.limitBytes)} of ${formatStorage(state.limitBytes)} used`;
  return options.canManagePlan === false
    ? `Not enough space: ${used}. Ask an owner or admin to make room.`
    : `Not enough space: ${used}. Empty the trash or upgrade.`;
}

/** The refusal for a space found over its limit after the file's row was written (a race lost). */
export function fullRefusal(
  space: StorageSpace,
  sizeBytes: number,
  canManagePlan = true,
): UploadRefusal {
  const state = storageState(space);
  return {
    status: 403,
    error: fullMessage(state, { feature: "files", canManagePlan }),
    code: "STORAGE_FULL",
    refused: "full",
    sizeBytes,
    usedBytes: state.usedBytes,
    limitBytes: state.limitBytes,
    maxFileBytes: state.maxFileBytes,
  };
}
