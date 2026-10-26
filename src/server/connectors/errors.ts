import "server-only";

import type { CallToolResult } from "@modelcontextprotocol/server";
import { captureException } from "@sentry/nextjs";
import { ZodError } from "zod";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { AppError } from "@/server/db/errors";

/**
 * What a tool says when it fails (docs/features/ai-connectors.md). Every
 * failure is an `isError: true` tool result, never a protocol error, so the
 * model reads it and can recover (the 2025-11-25 rule for input errors).
 * Nothing here echoes the input or names a database object:
 *
 *   NotFoundError         one sentence for "no such id" and "not a member"
 *   ForbiddenError        "Your role in <club> can't do that."
 *   AppError (below 500)  its own message: SpaceRefusedError (paused, not
 *                         on the plan), ConnectorRefusedError (scope, the
 *                         club switch) and the mapped database errors
 *   ZodError              the first issue, with its field and an example
 *   anything else         "Something went wrong", plus a Sentry report
 */

export const NOT_FOUND_MESSAGE = "No space or item with that id, or you're not a member.";
export const GENERIC_MESSAGE = "Something went wrong on Bananasplit's side. Try again in a minute.";

export interface ToolErrorContext {
  /** The tool, for the Sentry report. */
  tool?: string;
  /** The club the call acted in, when known, for ForbiddenError. */
  clubName?: string;
  /** An example value per argument name, for ZodError ("an id from list_spaces"). */
  examples?: Record<string, string>;
}

function zodMessage(error: ZodError, examples: Record<string, string> = {}): string {
  const issue = error.issues[0];
  if (!issue) return "The arguments aren't valid.";
  const field = issue.path.map(String).join(".");
  const example = field ? examples[field] : undefined;
  const subject = field ? `The "${field}" argument` : "The arguments";
  return `${subject} isn't valid: ${issue.message}.${example ? ` For example: ${example}.` : ""}`;
}

export function toolErrorMessage(error: unknown, context: ToolErrorContext = {}): string {
  if (error instanceof NotFoundError) return NOT_FOUND_MESSAGE;
  if (error instanceof ForbiddenError) {
    return `Your role in ${context.clubName ?? "this club"} can't do that.`;
  }
  if (error instanceof ZodError) return zodMessage(error, context.examples);
  if (error instanceof AppError && error.status < 500) return error.message;
  console.error(
    `[connectors] ${context.tool ?? "tool"} failed`,
    error instanceof Error ? error.message : error,
  );
  captureException(error, { tags: { area: "connectors", tool: context.tool ?? "unknown" } });
  return GENERIC_MESSAGE;
}

export function toolError(error: unknown, context: ToolErrorContext = {}): CallToolResult {
  return { content: [{ type: "text", text: toolErrorMessage(error, context) }], isError: true };
}
