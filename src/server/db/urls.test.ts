import { describe, expect, it } from "vitest";

import { deriveRoleUrl, MissingDatabaseUrlError, runtimeDatabaseUrl, usernameOf } from "./urls";

const BASE =
  "postgresql://neondb_owner:ownerpw@ep-cool-1234-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("runtimeDatabaseUrl", () => {
  it("prefers the explicit per-role URL", () => {
    const env = {
      DATABASE_URL_APP: "postgresql://app_user:test@localhost:5432/x",
      DATABASE_URL: BASE,
      APP_DB_PASSWORD: "p",
    };
    expect(runtimeDatabaseUrl("app", env)).toBe("postgresql://app_user:test@localhost:5432/x");
  });

  it("derives each role from the base URL, swapping only the user and password", () => {
    const env = {
      DATABASE_URL: BASE,
      APP_DB_PASSWORD: "a",
      SERVICE_DB_PASSWORD: "s",
      AUTH_DB_PASSWORD: "u",
    };
    const app = new URL(runtimeDatabaseUrl("app", env));
    expect(app.username).toBe("app_user");
    expect(app.password).toBe("a");
    expect(app.host).toBe("ep-cool-1234-pooler.us-east-2.aws.neon.tech");
    expect(app.pathname).toBe("/neondb");
    expect(app.searchParams.get("sslmode")).toBe("require");
    expect(usernameOf(runtimeDatabaseUrl("service", env))).toBe("app_service");
    expect(usernameOf(runtimeDatabaseUrl("auth", env))).toBe("app_auth");
  });

  it("never falls back to the owner URL when the role password is missing", () => {
    expect(() => runtimeDatabaseUrl("service", { DATABASE_URL: BASE })).toThrow(
      MissingDatabaseUrlError,
    );
    expect(() => runtimeDatabaseUrl("app", {})).toThrow(/DATABASE_URL_APP/);
  });

  it("treats an empty override as unset", () => {
    const env = { DATABASE_URL_AUTH: "", DATABASE_URL: BASE, AUTH_DB_PASSWORD: "x" };
    expect(usernameOf(runtimeDatabaseUrl("auth", env))).toBe("app_auth");
  });
});

describe("deriveRoleUrl", () => {
  it("percent-encodes passwords with reserved characters", () => {
    const url = deriveRoleUrl(BASE, "app", "p@ss:w/rd#1");
    expect(decodeURIComponent(new URL(url).password)).toBe("p@ss:w/rd#1");
  });

  it("rejects a non-postgres base URL", () => {
    expect(() => deriveRoleUrl("https://example.com/db", "app", "x")).toThrow(/postgres URL/);
  });
});
