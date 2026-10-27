import "server-only";

import type { ToolAnnotations } from "@modelcontextprotocol/server";

import {
  checkRateLimit,
  rateLimitKey,
  retryAfterText,
  type RateLimitResult,
} from "@/lib/rate-limit";
import { writeOrgAuditLog } from "@/server/audit";
import { withConnectorOrgTx, type OrgContext } from "@/server/db/context";
import { AppError } from "@/server/db/errors";

import type { ConnectorSession } from "./shared";
import { loadToolSpace, type SpaceOptions, type ToolSpace } from "./space";

/**
 * Every write tool changes its space here (docs/features/ai-connectors.md,
 * Phase 3), in this order:
 *
 *   a READ grant           refused (ReadOnlyGrantError); its server never
 *                          lists the write tools, so this is a second check
 *   120 writes an hour     per grant (connector.write), refused past it
 *                          (WriteLimitError); counted before the space opens,
 *                          so a refused write still counts, as every limit does
 *   withConnectorOrgTx     the grant's scope, membership, the club switch and
 *                          the tool's plan feature, with whenPaused "refuse":
 *                          a paused club reads but doesn't change
 *   the section            hidden from members, as for reads (owners and
 *                          admins still reach it)
 *   the write              the app's own service, in the same transaction
 *   the audit row          connector.<tool>, naming the app, committed or
 *                          rolled back with the write
 *
 * The services' own refusals (a closed poll, a task rule) come back in their
 * own words as WriteRefusedError, and roll back whatever the write began.
 */

/** connector.write: per grant, across every space it reaches. */
export const WRITE_LIMIT = { limit: 120, windowSec: 60 * 60 } as const;

/** A tool that only adds (a task, a comment, a row, a note). */
export const ADDS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** A tool that sets something to the value given, replacing what was there. */
export const OVERWRITES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/** A write from an app the member connected to read only. */
export class ReadOnlyGrantError extends AppError {
  constructor() {
    super(
      "This app was connected to read only. To let it make changes, disconnect it on your Bananasplit profile and connect it again with Read and make changes.",
      403,
      "CONNECTOR_READ_ONLY",
    );
    this.name = "ReadOnlyGrantError";
  }
}

/** More than WRITE_LIMIT writes in the window. */
export class WriteLimitError extends AppError {
  constructor(result: RateLimitResult) {
    super(
      `This app has made too many changes for now. Try again ${retryAfterText(result)}.`,
      429,
      "CONNECTOR_WRITE_LIMIT",
    );
    this.name = "WriteLimitError";
  }
}

/** What the app itself refuses, in its own words (never the tool's input). */
export class WriteRefusedError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONNECTOR_WRITE_REFUSED");
    this.name = "WriteRefusedError";
  }
}

/** A write's result, and what its audit row names. */
export interface Written<T> {
  output: T;
  target: { type: string; id: string };
}

/**
 * Runs `fn` as the member in `spaceId` for the write tool `tool`: one
 * transaction under RLS, refused before `fn` runs when the grant, the
 * limit, the wrapper or the space says no, and audited with it.
 */
export async function writeInSpace<T>(
  session: ConnectorSession,
  tool: string,
  spaceId: string,
  options: SpaceOptions,
  fn: (ctx: OrgContext, space: ToolSpace) => Promise<Written<T>>,
): Promise<T> {
  if (session.grant.access !== "WRITE") throw new ReadOnlyGrantError();
  const limited = await checkRateLimit(
    rateLimitKey("connector.write", session.grant.id),
    WRITE_LIMIT.limit,
    WRITE_LIMIT.windowSec,
  );
  if (!limited.allowed) throw new WriteLimitError(limited);
  return withConnectorOrgTx(
    session.connector,
    session.grant,
    spaceId,
    { feature: options.feature, whenPaused: "refuse" },
    async (ctx) => {
      const space = await loadToolSpace(ctx);
      if (options.section) space.requireSection(options.section);
      const { output, target } = await fn(ctx, space);
      await writeOrgAuditLog(ctx.db, {
        organizationId: ctx.organizationId,
        action: `connector.${tool}`,
        targetType: target.type,
        targetId: target.id,
        diff: { client: session.grant.clientName, clientId: session.connector.clientId },
      });
      return output;
    },
  );
}

/**
 * A service result's refusal as WriteRefusedError: `{ error }` (and the
 * service's own error class) roll the write back with its message.
 */
export function refuseOn<T extends { error?: string }>(result: T): T {
  if (result.error) throw new WriteRefusedError(result.error);
  return result;
}
