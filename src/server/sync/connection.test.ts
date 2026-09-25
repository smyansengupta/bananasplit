// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The website data source's connection: the host derivation that closes
 * SSRF by construction, the local stand-in mode, and the connection test
 * that Settings > Integrations and the guided setup both run.
 *
 * pg is replaced wholesale (openSourceClient constructs pg.Client itself,
 * with no seam), so the assertions are on what the driver was handed and
 * what each driver error turns into.
 */

const { clientCtor, connect, query, end } = vi.hoisted(() => ({
  clientCtor: vi.fn(),
  connect: vi.fn(async () => undefined),
  query: vi.fn(async (_sql: string) => ({ rows: [] as Record<string, unknown>[] })),
  end: vi.fn(async () => undefined),
}));

vi.mock("pg", () => {
  class Client {
    constructor(config: unknown) {
      clientCtor(config);
    }
    on() {
      return this;
    }
    connect = connect;
    query = query;
    end = end;
  }
  return { default: { Client }, Client };
});
vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);

import {
  clientOptions,
  describeConnectionError,
  parseSourceConfig,
  sourceEndpoint,
  testSupabaseSource,
  type SourceConfig,
} from "./connection";

const remote = {
  projectRef: "abcdefghijklmnopqrst",
  poolerRegion: "us-east-1",
  poolerPrefix: "aws-0" as const,
  roleName: "cbc_suite_reader",
};

const local = {
  mode: "local" as const,
  host: "localhost" as const,
  port: 5432,
  database: "standin",
};
const allowLocal = { SOURCE_SYNC_ALLOW_LOCAL: "1" };

beforeEach(() => {
  vi.clearAllMocks();
  query.mockImplementation(async () => ({ rows: [] }));
});

describe("host derivation", () => {
  it("builds the pooler host and user from the structured fields only", () => {
    const cfg = parseSourceConfig(remote);
    expect(sourceEndpoint(cfg)).toEqual({
      host: "aws-0-us-east-1.pooler.supabase.com",
      port: 5432,
      user: "cbc_suite_reader.abcdefghijklmnopqrst",
      database: "postgres",
    });
  });

  it("refuses anything that could smuggle a host of its own", () => {
    for (const bad of [
      { ...remote, poolerRegion: "evil.example.com" },
      { ...remote, projectRef: "x.evil.com" },
      { ...remote, projectRef: "abcdefghijklmnopqrs" },
      { ...remote, poolerPrefix: "aws-9" },
      { ...remote, roleName: "reader; DROP" },
      {},
    ]) {
      expect(() => parseSourceConfig(bad)).toThrow();
    }
  });

  it("verifies TLS against the derived host, and pins the root CA when one is set", () => {
    const cfg = parseSourceConfig(remote);
    expect(clientOptions(cfg, "pw", {}).ssl).toMatchObject({
      rejectUnauthorized: true,
      servername: "aws-0-us-east-1.pooler.supabase.com",
    });
    const pinned = clientOptions(cfg, "pw", {
      SUPABASE_ROOT_CA_PEM: "-----BEGIN CERTIFICATE-----\\nX",
    });
    expect(pinned.ssl).toMatchObject({ ca: "-----BEGIN CERTIFICATE-----\nX" });
  });

  it("allows the local stand-in only in local development", () => {
    expect(() => parseSourceConfig(local, {})).toThrow(/only allowed in local development/);
    expect(() => parseSourceConfig(local, { ...allowLocal, VERCEL: "1" })).toThrow();
    const cfg = parseSourceConfig(local, allowLocal);
    expect(sourceEndpoint(cfg)).toMatchObject({ host: "localhost", database: "standin" });
    // No TLS to a loopback stand-in; never an option for a real project.
    expect(clientOptions(cfg, "pw", allowLocal).ssl).toBe(false);
    expect(() => parseSourceConfig({ ...local, host: "10.0.0.1" }, allowLocal)).toThrow();
  });
});

describe("testSupabaseSource", () => {
  function answerVersion(v: unknown) {
    query.mockImplementation(async (sql: string) =>
      sql.includes("contract_version") ? { rows: [{ v }] } : { rows: [] },
    );
  }

  it("connects read-only, checks the contract version and always closes", async () => {
    answerVersion(1);
    const result = await testSupabaseSource({ secret: "pw", config: remote });
    expect(result).toEqual({ ok: true, config: { contractVersion: 1 } });
    expect(query.mock.calls[0][0]).toBe("SET default_transaction_read_only = on");
    expect(end).toHaveBeenCalled();
    expect(clientCtor.mock.calls[0][0]).toMatchObject({
      host: "aws-0-us-east-1.pooler.supabase.com",
      user: "cbc_suite_reader.abcdefghijklmnopqrst",
    });
  });

  it("works against a local stand-in", async () => {
    vi.stubEnv("SOURCE_SYNC_ALLOW_LOCAL", "1");
    answerVersion(1);
    expect(await testSupabaseSource({ secret: "pw", config: local })).toMatchObject({ ok: true });
    expect(clientCtor.mock.calls[0][0]).toMatchObject({ host: "localhost", database: "standin" });
    vi.unstubAllEnvs();
  });

  it("refuses a contract version this suite cannot read", async () => {
    answerVersion(99);
    expect(await testSupabaseSource({ secret: "pw", config: remote })).toEqual({
      ok: false,
      reason: "The website export is version 99; this suite understands version 1.",
    });
  });

  it("needs a password, and says so before opening a socket", async () => {
    expect(await testSupabaseSource({ secret: null, config: remote })).toMatchObject({ ok: false });
    expect(clientCtor).not.toHaveBeenCalled();
  });

  it("turns a malformed config into a reason, not a crash", async () => {
    const result = await testSupabaseSource({ secret: "pw", config: { projectRef: "nope" } });
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/20-character id/) });
    expect(clientCtor).not.toHaveBeenCalled();
  });

  it("explains each driver failure in the club's terms", async () => {
    const cases: [Error, RegExp][] = [
      [
        Object.assign(new Error("password authentication failed"), { code: "28P01" }),
        /refused the password/,
      ],
      [
        Object.assign(new Error("function suite_export.contract_version() does not exist"), {
          code: "42883",
        }),
        /suite-export\.sql/,
      ],
      [Object.assign(new Error("permission denied"), { code: "42501" }), /missing a grant/],
      [Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }), /region and prefix/],
      [Object.assign(new Error("refused"), { code: "ECONNREFUSED" }), /did not answer/],
      [new Error("self-signed certificate in chain"), /TLS certificate/],
    ];
    for (const [error, pattern] of cases) {
      vi.clearAllMocks();
      connect.mockRejectedValueOnce(error);
      const result = await testSupabaseSource({ secret: "pw", config: remote });
      expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(pattern) });
    }
  });

  it("never lets a driver message through with the password in it", () => {
    const leak = new Error('password authentication failed for user "cbc_suite_reader" (hunter2)');
    expect(describeConnectionError(leak)).not.toMatch(/hunter2/);
  });
});

describe("clientOptions bounds every connection", () => {
  it("is read-only-able, time-limited and named", () => {
    const cfg: SourceConfig = parseSourceConfig(remote);
    const opts = clientOptions(cfg, "pw", {});
    expect(opts.statement_timeout).toBe(10_000);
    expect(opts.application_name).toBe("cbc-suite-source-sync");
  });
});
