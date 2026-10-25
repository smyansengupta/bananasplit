// @vitest-environment node
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { UID_CLAIM } from "@/server/connectors/token";

import { GET as metadata } from "../../.well-known/oauth-protected-resource/api/mcp/route";
import { POST } from "./route";

// No database: whoami's withUserTx answers for one seeded-looking member.
vi.mock("@/server/db/context", () => ({
  assertNoTx: () => {},
  withUserTx: async (userId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({
      db: {
        user: {
          findUnique: async () => ({
            id: userId,
            name: "Alice Nguyen",
            email: "alice@example.edu",
          }),
        },
        membership: {
          findMany: async () => [
            { role: "OWNER", organization: { id: "org_1", name: "Robotics Club", kind: "CLUB" } },
          ],
        },
      },
    }),
}));

const AUTHKIT = "https://club-123.authkit.app";
const MCP_URL = "http://localhost:3000/api/mcp";
const METADATA_URL = "http://localhost:3000/.well-known/oauth-protected-resource/api/mcp";

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
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
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function accessToken(): Promise<string> {
  return new SignJWT({ [UID_CLAIM]: "user_ours_1", client_id: "client_x", sid: "app_consent_1" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(AUTHKIT)
    .setAudience(MCP_URL)
    .setSubject("user_01WORKOS")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
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
async function message(response: Response): Promise<{ result?: Record<string, unknown> }> {
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

describe("/api/mcp", () => {
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

  it("serves a 2025-era client: initialize, tools/list, then whoami as the token's member", async () => {
    const auth = { Authorization: `Bearer ${await accessToken()}` };

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
    expect((await message(init)).result).toMatchObject({ serverInfo: { name: "bananasplit" } });

    const list = await rpc("tools/list", {}, { ...auth, "MCP-Protocol-Version": LEGACY });
    const tools = (await message(list)).result?.tools as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual(["whoami"]);

    const call = await rpc(
      "tools/call",
      { name: "whoami", arguments: {} },
      { ...auth, "MCP-Protocol-Version": LEGACY },
    );
    expect((await message(call)).result).toMatchObject({
      structuredContent: {
        account: { id: "user_ours_1", email: "alice@example.edu" },
        spaces: [{ id: "org_1", name: "Robotics Club", role: "OWNER" }],
        grant: { clientId: "client_x", consentId: "app_consent_1", workosUserId: "user_01WORKOS" },
        token: { lifetimeSeconds: 300 },
      },
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
  it("serves server/discover and whoami with no initialize", async () => {
    const auth = { Authorization: `Bearer ${await accessToken()}` };

    const discover = await modernRpc("server/discover", {}, auth);
    const discovered = await message(discover);
    expect(discover.status, JSON.stringify(discovered)).toBe(200);
    expect(JSON.stringify(discovered.result)).toContain("bananasplit");

    const call = await modernRpc("tools/call", { name: "whoami", arguments: {} }, auth);
    const called = await message(call);
    expect(call.status, JSON.stringify(called)).toBe(200);
    expect(called.result).toMatchObject({
      structuredContent: { account: { id: "user_ours_1" } },
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
