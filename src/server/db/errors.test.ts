import { describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";

import {
  AppError,
  ConflictError,
  InvalidReferenceError,
  mapDbError,
  RuleViolationError,
  sqlStateOf,
} from "./errors";

describe("sqlStateOf", () => {
  it("reads a pg error code", () => {
    expect(sqlStateOf({ code: "42501", message: "permission denied" })).toBe("42501");
  });

  it("reads the driver adapter's originalCode nested in cause or meta", () => {
    expect(sqlStateOf({ code: "P2010", cause: { originalCode: "23514" } })).toBe("23514");
    expect(
      sqlStateOf({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "23503", kind: "postgres" } } } }),
    ).toBe("23503");
  });

  it("maps Prisma request codes that correspond to a SQLSTATE", () => {
    expect(sqlStateOf({ code: "P2002" })).toBe("23505");
    expect(sqlStateOf({ code: "P2003" })).toBe("23503");
  });

  it("returns undefined for anything else", () => {
    expect(sqlStateOf(new Error("boom"))).toBeUndefined();
    expect(sqlStateOf(null)).toBeUndefined();
    expect(sqlStateOf({ code: "P2025" })).toBeUndefined();
  });
});

describe("mapDbError", () => {
  it("maps each constraint class to a generic AppError that keeps the cause", () => {
    const fk = { code: "23503", message: 'invalid reference: Task.projectId (Key (id)=(p_secret))' };
    const mapped = mapDbError(fk);
    expect(mapped).toBeInstanceOf(InvalidReferenceError);
    expect((mapped as Error).message).not.toContain("p_secret");
    expect((mapped as Error).cause).toBe(fk);
    expect(mapDbError({ code: "23505" })).toBeInstanceOf(ConflictError);
    expect(mapDbError({ code: "23514" })).toBeInstanceOf(RuleViolationError);
    expect(mapDbError({ code: "42501", message: 'new row violates row-level security policy for table "Task"' })).toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("passes application errors and unknown errors through", () => {
    const nf = new NotFoundError();
    const app = new ConflictError();
    const other = new Error("network");
    expect(mapDbError(nf)).toBe(nf);
    expect(mapDbError(app)).toBe(app);
    expect(mapDbError(other)).toBe(other);
    expect(app).toBeInstanceOf(AppError);
  });
});
