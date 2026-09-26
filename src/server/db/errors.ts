import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";

/**
 * Maps database errors to generic application errors, so no raw constraint
 * message (which can name a key value) or policy name reaches the client,
 * and a foreign parent is indistinguishable from a missing one (N4).
 *
 *   42501  insufficient privilege / RLS WITH CHECK       -> ForbiddenError
 *   23503  invalid reference (FK or app.assert_same_org) -> InvalidReferenceError
 *   23505  unique violation (incl. reserved slugs)       -> ConflictError
 *   23514  check / business rule (e.g. last OWNER)       -> RuleViolationError
 *
 * Everything else is returned unchanged. The original error is kept as
 * `cause` for server-side logging.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export class InvalidReferenceError extends AppError {
  constructor(options?: { cause?: unknown }) {
    super("A referenced item does not exist.", 400, "INVALID_REFERENCE", options);
    this.name = "InvalidReferenceError";
  }
}

export class ConflictError extends AppError {
  constructor(options?: { cause?: unknown }) {
    super("That conflicts with an existing item.", 409, "CONFLICT", options);
    this.name = "ConflictError";
  }
}

export class RuleViolationError extends AppError {
  constructor(options?: { cause?: unknown }) {
    super("That change is not allowed.", 422, "RULE_VIOLATION", options);
    this.name = "RuleViolationError";
  }
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** Prisma request-error codes that correspond to a SQLSTATE. */
const PRISMA_TO_SQLSTATE: Record<string, string> = {
  P2002: "23505",
  P2003: "23503",
  P2004: "23514",
};

type Loose = Record<string, unknown> | undefined | null;

/**
 * The Postgres SQLSTATE behind an error thrown by Prisma (driver adapter
 * errors carry it as `originalCode`, possibly nested under `cause` or
 * `meta.driverAdapterError`), by pg itself, or undefined.
 */
export function sqlStateOf(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== "object" || depth > 5) return undefined;
  const e = error as Record<string, unknown>;

  for (const key of ["originalCode", "code"] as const) {
    const v = e[key];
    if (typeof v === "string" && SQLSTATE.test(v) && !v.startsWith("P")) return v;
  }

  const meta = e.meta as Loose;
  const nested = [
    e.cause,
    meta?.driverAdapterError,
    (meta?.driverAdapterError as Loose)?.cause,
    meta?.cause,
  ];
  for (const n of nested) {
    const found = sqlStateOf(n, depth + 1);
    if (found) return found;
  }

  if (typeof e.code === "string" && e.code in PRISMA_TO_SQLSTATE) {
    return PRISMA_TO_SQLSTATE[e.code];
  }
  const metaCode = meta?.code;
  if (typeof metaCode === "string" && SQLSTATE.test(metaCode)) return metaCode;
  return undefined;
}

/** A generic AppError for a known database error, else the error itself. */
export function mapDbError(error: unknown): unknown {
  if (
    error instanceof AppError ||
    error instanceof NotFoundError ||
    error instanceof ForbiddenError
  ) {
    return error;
  }
  switch (sqlStateOf(error)) {
    case "42501": {
      const mapped = new ForbiddenError();
      (mapped as Error).cause = error;
      return mapped;
    }
    case "23503":
      return new InvalidReferenceError({ cause: error });
    case "23505":
      return new ConflictError({ cause: error });
    case "23514":
      return new RuleViolationError({ cause: error });
    default:
      return error;
  }
}
