// @vitest-environment node
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ACCESS_CLAIM, SPACE_CLAIM, UID_CLAIM } from "@/server/connectors/token";

/**
 * The MCP endpoint end to end, minus Postgres: real token checks against a
 * local JWKS, real grant resolution and list_spaces over an in-memory grant
 * table and two memberships (the RLS side is in
 * src/server/connectors/connectors.db.test.ts and pnpm test:rls).
 */

interface FakeGrant {
  id: string;
  userId: string;
  clientId: string;
  workosUserId: string;
  consentId: string;
  access: "READ" | "WRITE";
  organizationId: string | null;
  clientName: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
}

const { state, rateLimit } = vi.hoisted(() => ({
  state: {
    grant: null as FakeGrant | null,
    failSpaces: false,
  },
  rateLimit: vi.fn(),
}));

const MEMBERSHIPS = [
  {
    role: "OWNER",
    organization: {
      id: "org_personal",
      name: "Alice Nguyen",
      slug: "alice-nguyen",
      kind: "PERSONAL",
      plan: "FREE",
      trialEndsAt: null,
    },
  },
  {
    role: "MEMBER",
    organization: {
      id: "org_club",
      name: "Robotics Club",
      slug: "robotics-club",
      kind: "CLUB",
      plan: "TRIAL",
      trialEndsAt: new Date("2026-01-01T00:00:00Z"),
    },
  },
];

vi.mock("@/server/db/context", () => {
  const db = {
    connectorGrant: {
      findUnique: async () => (state.grant ? { ...state.grant } : null),
      create: async ({ data }: { data: Omit<FakeGrant, "id" | "clientName" | "revokedAt"> }) => {
        state.grant = { id: "grant_1", clientName: null, revokedAt: null, ...data };
        return { ...state.grant };
      },
      update: async ({ data }: { data: Partial<FakeGrant> }) => {
        state.grant = { ...state.grant!, ...data };
        return { ...state.grant };
      },
      updateMany: async ({ data }: { data: Partial<FakeGrant> }) => {
        state.grant = { ...state.grant!, ...data };
        return { count: 1 };
      },
    },
    membership: {
      findFirst: async ({ where }: { where: { organizationId: string } }) =>
        MEMBERSHIPS.some((m) => m.organization.id === where.organizationId)
          ? { organizationId: where.organizationId }
          : null,
      findMany: async ({ where }: { where: { organizationId?: string } }) => {
        if (state.failSpaces) throw new Error("connection reset by peer");
        return MEMBERSHIPS.filter(
          (m) => !where.organizationId || m.organization.id === where.organizationId,
        );
      },
    },
    // app.connector_spaces(): the club has switched AI apps off.
    $queryRaw: async () => [
      { organizationId: "org_personal", connectorsEnabled: true },
      { organizationId: "org_club", connectorsEnabled: false },
    ],
  };
  return {
    assertNoTx: () => {},
    withConnectorUserTx: async (_connector: unknown, fn: (ctx: unknown) => Promise<unknown>) =>
      fn({ db }),
  };
});
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: rateLimit,
  rateLimitKey: (scope: string, ...parts: string[]) => [scope, ...parts].join(":"),
  retryAfterText: () => "in 12 minutes",
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { GET as metadata } from "../../.well-known/oauth-protected-resource/api/mcp/route";
import { POST } from "./route";

const AUTHKIT = "https://club-123.authkit.app";
const MCP_URL = "http://localhost:3000/api/mcp";
const METADATA_URL = "http://localhost:3000/.well-known/oauth-protected-resource/api/mcp";

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  vi.stubEnv("CONNECTORS_ENABLED", "true");
  vi.stubEnv("WORKOS_API_KEY", "sk_test_unused");
  vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", AUTHKIT);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("VERCEL_ENV", "");
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return url === `${AUTHKIT}/oauth2/jwks`
        ? Response.json({ keys: [publicJwk] })
        : new Response("not found", { status: 404 });
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  state.grant = null;
  state.failSpaces = false;
  rateLimit.mockReset();
  rateLimit.mockResolvedValue({ allowed: true });
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function accessToken(claims: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({
    [UID_CLAIM]: "user_ours_1",
    client_id: "https://claude.ai/oauth/claude-code-client-metadata",
    sid: "app_consent_1",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(AUTHKIT)
    .setAudience(MCP_URL)
    .setSubject("user_01WORKOS")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

async function bearer(claims?: Record<string, unknown>): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await accessToken(claims)}` };
}

let nextId = 1;

async function rpc(
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return POST(
    new Request(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
}

/** The JSON-RPC message from a JSON body or a single-event SSE body. */
async function message(
  response: Response,
): Promise<{ result?: Record<string, unknown>; error?: { message: string } }> {
  const text = await response.text();
  if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return JSON.parse(text);
  }
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .find(Boolean);
  return JSON.parse(data ?? "{}");
}

const LEGACY = "2025-11-25";

function callTool(name: string, headers: Record<string, string>) {
  return rpc("tools/call", { name, arguments: {} }, { ...headers, "MCP-Protocol-Version": LEGACY });
}

describe("/api/mcp: the gates", () => {
  it("answers no token with a real 401 naming the resource metadata", async () => {
    const response = await rpc("tools/list", {});
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${METADATA_URL}"`,
    );
  });

  it("refuses a browser request from another site", async () => {
    const response = await rpc("tools/list", {}, { Origin: "https://evil.example" });
    expect(response.status).toBe(403);
  });

  it("answers 404 while AI connectors are off", async () => {
    vi.stubEnv("CONNECTORS_ENABLED", "");
    try {
      const response = await rpc("tools/list", {}, await bearer());
      expect(response.status).toBe(404);
    } finally {
      vi.stubEnv("CONNECTORS_ENABLED", "true");
    }
  });

  it("refuses a disconnected app with the same 401 challenge until it consents again", async () => {
    const auth = await bearer();
    expect((await callTool("list_spaces", auth)).status).toBe(200);
    state.grant!.revokedAt = new Date();

    const refused = await callTool("list_spaces", auth);
    expect(refused.status).toBe(401);
    const challenge = refused.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain("disconnected");
    expect(challenge).toContain(`resource_metadata="${METADATA_URL}"`);

    // A new consent (a new sid) takes its claims and clears revokedAt.
    const again = await callTool("list_spaces", await bearer({ sid: "app_consent_2" }));
    expect(again.status).toBe(200);
    expect(state.grant).toMatchObject({ consentId: "app_consent_2", revokedAt: null });
  });

  it("refuses a consent naming a space the member is no longer in", async () => {
    const response = await callTool("list_spaces", await bearer({ [SPACE_CLAIM]: "org_left" }));
    expect(response.status).toBe(401);
    expect(state.grant).toBeNull();
  });

  it("limits each grant to 600 requests an hour, keyed by the grant", async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 720_000 });
    const response = await callTool("list_spaces", await bearer());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("720");
    expect(await response.json()).toMatchObject({
      error: { message: "Too many requests from this app. Try again in 12 minutes." },
    });
    expect(rateLimit).toHaveBeenCalledWith("connector.call:grant_1", 600, 3600);
  });
});

describe("/api/mcp, 2025-11-25", () => {
  it("serves initialize, tools/list and list_spaces as the token's member", async () => {
    const auth = await bearer();

    const init = await rpc(
      "initialize",
      {
        protocolVersion: LEGACY,
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
      auth,
    );
    expect(init.status).toBe(200);
    expect((await message(init)).result).toMatchObject({
      serverInfo: { name: "bananasplit", title: "Bananasplit" },
      instructions: expect.stringContaining("list_spaces"),
    });
    // The first request recorded the grant: no consent claims, so READ and every space.
    expect(state.grant).toMatchObject({
      userId: "user_ours_1",
      clientId: "https://claude.ai/oauth/claude-code-client-metadata",
      workosUserId: "user_01WORKOS",
      consentId: "app_consent_1",
      access: "READ",
      organizationId: null,
    });

    const list = await rpc("tools/list", {}, { ...auth, "MCP-Protocol-Version": LEGACY });
    const tools = (await message(list)).result?.tools as {
      name: string;
      annotations: Record<string, boolean>;
    }[];
    expect(tools.map((t) => t.name)).toEqual(["list_spaces"]);
    expect(tools[0]?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    const call = await callTool("list_spaces", auth);
    expect((await message(call)).result).toMatchObject({
      structuredContent: {
        access: "read",
        spaces: [
          {
            id: "org_personal",
            name: "Personal",
            kind: "personal",
            role: "owner",
            url: "http://localhost:3000/app/alice-nguyen",
            connectorsOn: true,
            paused: false,
          },
          {
            id: "org_club",
            name: "Robotics Club",
            kind: "club",
            role: "member",
            url: "http://localhost:3000/app/robotics-club",
            connectorsOn: false,
            paused: true,
          },
        ],
      },
    });
  });

  it("lists only the space a scoped grant names, and no write tools yet for a WRITE grant", async () => {
    const auth = await bearer({ [SPACE_CLAIM]: "org_club", [ACCESS_CLAIM]: "write" });
    const list = await rpc("tools/list", {}, { ...auth, "MCP-Protocol-Version": LEGACY });
    expect(((await message(list)).result?.tools as { name: string }[]).map((t) => t.name)).toEqual([
      "list_spaces",
    ]);
    expect(state.grant).toMatchObject({ access: "WRITE", organizationId: "org_club" });

    const call = await callTool("list_spaces", auth);
    const result = (await message(call)).result as {
      structuredContent: { access: string; spaces: { id: string }[] };
    };
    expect(result.structuredContent.access).toBe("read_and_change");
    expect(result.structuredContent.spaces.map((s) => s.id)).toEqual(["org_club"]);
  });

  it("turns a failure inside a tool into an isError result, not a protocol error", async () => {
    state.failSpaces = true;
    const call = await callTool("list_spaces", await bearer());
    expect(call.status).toBe(200);
    expect((await message(call)).result).toEqual({
      content: [{ type: "text", text: expect.stringMatching(/^Something went wrong/) }],
      isError: true,
    });
  });
});

const MODERN = "2026-07-28";

/** 2026-07-28: no initialize; every request carries the envelope and the method headers. */
function modernRpc(
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  return rpc(
    method,
    {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
      },
    },
    {
      ...headers,
      "MCP-Protocol-Version": MODERN,
      "Mcp-Method": method,
      ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
    },
  );
}

describe("/api/mcp, 2026-07-28", () => {
  it("serves server/discover and list_spaces with no initialize", async () => {
    const auth = await bearer();

    const discover = await modernRpc("server/discover", {}, auth);
    const discovered = await message(discover);
    expect(discover.status, JSON.stringify(discovered)).toBe(200);
    expect(JSON.stringify(discovered.result)).toContain("bananasplit");

    const call = await modernRpc("tools/call", { name: "list_spaces", arguments: {} }, auth);
    const called = await message(call);
    expect(call.status, JSON.stringify(called)).toBe(200);
    expect(called.result).toMatchObject({
      structuredContent: { spaces: [{ id: "org_personal" }, { id: "org_club" }] },
    });
  });
});

describe("/.well-known/oauth-protected-resource/api/mcp", () => {
  it("names AuthKit as the only authorization server for the exact MCP URL", async () => {
    const response = metadata();
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({
      resource: MCP_URL,
      authorization_servers: [AUTHKIT],
      bearer_methods_supported: ["header"],
      resource_name: "Bananasplit",
    });
  });
});
