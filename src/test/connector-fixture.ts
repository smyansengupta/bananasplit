import { randomBytes } from "node:crypto";

import { createMcpHandler } from "@modelcontextprotocol/server";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { SECTIONS, type SectionId } from "@/lib/nav/sidebar";
import type { ConnectorsConfig } from "@/server/connectors/config";
import type { ResolvedGrant } from "@/server/connectors/grant";
import { buildConnectorServer } from "@/server/connectors/server";
import { connectorAuthInfo, UID_CLAIM, verifyConnectorToken } from "@/server/connectors/token";
import type { ConnectorSession } from "@/server/connectors/tools/shared";
import { ensurePersonalSpace } from "@/server/personal/space";
import { createOrganization } from "@/server/settings/org-creation";

import { ownerDb } from "./owner-db";

/**
 * The spaces and people the AI connector tools' `*.db.test.ts` files read
 * against the real roles and policies (src/server/connectors/tools). A
 * test file mocks @/lib/auth/session and @/server/cache/invalidate, calls
 * setUpConnectorFixture in beforeAll (null when there is no local database
 * and role passwords: every test then returns early) and cleanup in
 * afterAll. Tokens are real RS256 JWTs checked against a local key set;
 * fetch answers only AuthKit's JWKS URL.
 *
 *   alice  a MEMBER of `club`, the OWNER of `paused`, with her Personal space
 *   bob    the OWNER of `club` and of `other` (Alice isn't in `other`)
 */

export interface FixtureUser {
  id: string;
  email: string;
  name: string;
}

export interface FixtureSpace {
  id: string;
  slug: string;
}

export interface ConnectorFixture {
  tag: string;
  alice: FixtureUser;
  bob: FixtureUser;
  club: FixtureSpace;
  other: FixtureSpace;
  /** A club whose trial ended: it reads, it doesn't write. */
  pausedId: string;
  /** Alice's Personal space. */
  personalId: string;
  /** A tool session for `user`, as the route builds it, under a grant of `scope`. */
  session(
    user: FixtureUser,
    scope?: { organizationId?: string | null; access?: "READ" | "WRITE" },
  ): Promise<ConnectorSession>;
  /** Runs `fn` while `spaceId` hides these sections (Settings › Sidebar). */
  hiding<T>(spaceId: string, sections: SectionId[], fn: () => Promise<T>): Promise<T>;
  /** Runs `fn` while `spaceId` has AI apps switched off (Admin panel › Privacy). */
  switchedOff<T>(spaceId: string, fn: () => Promise<T>): Promise<T>;
  /**
   * Calls `tool` through the MCP server the route serves, so the SDK checks
   * the arguments and the result against the tool's schemas: its
   * structuredContent, or an Error carrying the isError text.
   */
  call(
    session: ConnectorSession,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  /** Makes another user in the fixture (removed by cleanup). */
  user(local: string, name: string): Promise<FixtureUser>;
  /** Removes everything the fixture and the tests made in its spaces. */
  cleanup(): Promise<void>;
}

/** A tool's direct result as it crosses the wire (JSON: no undefined fields). */
export function asJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

const CONFIG: ConnectorsConfig = {
  apiKey: "sk_test_unused",
  authkitOrigin: "https://club-123.authkit.app",
  resourceUrl: "http://localhost:3000/api/mcp",
  resourceMetadataUrl: "http://localhost:3000/.well-known/oauth-protected-resource/api/mcp",
};

export async function setUpConnectorFixture(label: string): Promise<ConnectorFixture | null> {
  const tag = randomBytes(4).toString("hex");
  vi.stubEnv("PLATFORM_ORG_CREATION_ENABLED", "true");
  vi.stubEnv("ORG_CREATION_MODE", "open");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  const pair = await generateKeyPair("RS256");
  const publicJwk: JWK = {
    ...(await exportJWK(pair.publicKey)),
    kid: "k1",
    alg: "RS256",
    use: "sig",
  };
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `${CONFIG.authkitOrigin}/oauth2/jwks`) {
        return Response.json({ keys: [publicJwk] });
      }
      return realFetch(input, init);
    }),
  );

  const users: string[] = [];
  const orgs: string[] = [];
  const slugs: string[] = [];
  const pausedId = `org_tool_paused_${tag}`;

  const user = async (local: string, name: string): Promise<FixtureUser> => {
    const row = await ownerDb.user.create({
      data: {
        email: `${local}-${tag}@example.edu`,
        name: `${name} ${tag}`,
        emailVerified: new Date(),
        onboardedAt: new Date(),
      },
      select: { id: true, email: true, name: true },
    });
    users.push(row.id);
    return { id: row.id, email: row.email, name: row.name ?? name };
  };

  const cleanup = async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (orgs.length > 0) {
      await ownerDb.transaction.deleteMany({ where: { organizationId: { in: orgs } } });
      await ownerDb.organization.deleteMany({ where: { id: { in: orgs } } });
      await ownerDb.orgSlugHistory.deleteMany({ where: { slug: { in: slugs } } });
    }
    if (users.length > 0) await ownerDb.user.deleteMany({ where: { id: { in: users } } });
  };

  try {
    const alice = await user(`${label}-alice`, "Alice Nguyen");
    const bob = await user(`${label}-bob`, "Bob Okafor");
    const personalId = (await ensurePersonalSpace(alice.id)).id;
    orgs.push(personalId);
    const club = async (name: string, slug: string): Promise<FixtureSpace> => {
      const made = await createOrganization(bob, { name, slug, timezone: "UTC" });
      if (!made.ok) throw new Error(JSON.stringify(made));
      orgs.push(made.orgId);
      slugs.push(made.slug);
      return { id: made.orgId, slug: made.slug };
    };
    const main = await club(`Robotics ${tag}`, `${label}-robotics-${tag}`);
    await ownerDb.membership.create({
      data: { organizationId: main.id, userId: alice.id, role: "MEMBER" },
    });
    const other = await club(`Chess ${tag}`, `${label}-chess-${tag}`);
    // A club whose trial ended yesterday (the table owner may set any end).
    await ownerDb.organization.create({
      data: {
        id: pausedId,
        name: `Paused ${tag}`,
        slug: `${label}-paused-${tag}`,
        timezone: "UTC",
        plan: "TRIAL",
        trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    orgs.push(pausedId);
    await ownerDb.membership.create({
      data: { organizationId: pausedId, userId: alice.id, role: "OWNER" },
    });

    return {
      tag,
      alice,
      bob,
      club: main,
      other,
      pausedId,
      personalId,
      user,
      cleanup,
      async session(who, scope = {}) {
        const token = await new SignJWT({
          [UID_CLAIM]: who.id,
          client_id: `https://claude.ai/oauth/tools-${tag}`,
          sid: "app_consent_1",
        })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(CONFIG.authkitOrigin)
          .setAudience(CONFIG.resourceUrl)
          .setSubject(`user_01WORKOS_${who.id}`)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(pair.privateKey);
        const grant: ResolvedGrant = {
          id: `grant_${tag}`,
          access: scope.access ?? "READ",
          organizationId: scope.organizationId ?? null,
          clientName: null,
        };
        return { connector: await verifyConnectorToken(token, CONFIG), grant };
      },
      async call(session, tool, args) {
        const handler = createMcpHandler(() => buildConnectorServer(session), {
          responseMode: "json",
          maxSubscriptions: 0,
        });
        const response = await handler.fetch(
          new Request(CONFIG.resourceUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              "MCP-Protocol-Version": "2025-11-25",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name: tool, arguments: args },
            }),
          }),
          {
            authInfo: connectorAuthInfo(session.connector, "test-token", CONFIG, {
              grant: session.grant,
            }),
          },
        );
        // A JSON body, or a single-event SSE body.
        const raw = await response.text();
        const json = (response.headers.get("content-type") ?? "").includes("text/event-stream")
          ? (raw
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice("data:".length).trim())
              .find(Boolean) ?? "{}")
          : raw;
        const body = JSON.parse(json) as {
          error?: { message: string };
          result?: {
            isError?: boolean;
            content: { text: string }[];
            structuredContent: Record<string, unknown>;
          };
        };
        if (body.error || !body.result) throw new Error(`protocol error: ${body.error?.message}`);
        if (body.result.isError) throw new Error(body.result.content[0]?.text);
        return body.result.structuredContent;
      },
      async hiding(spaceId, sections, fn) {
        await ownerDb.orgSettings.update({
          where: { organizationId: spaceId },
          data: {
            sidebar: {
              groups: [],
              items: sections.map((id) => ({
                id,
                group: SECTIONS.find((s) => s.id === id)!.group,
                hidden: true,
                label: null,
              })),
            },
          },
        });
        try {
          return await fn();
        } finally {
          await ownerDb.orgSettings.update({
            where: { organizationId: spaceId },
            data: { sidebar: Prisma.DbNull },
          });
        }
      },
      async switchedOff(spaceId, fn) {
        await ownerDb.orgSettings.update({
          where: { organizationId: spaceId },
          data: { connectorsEnabled: false },
        });
        try {
          return await fn();
        } finally {
          await ownerDb.orgSettings.update({
            where: { organizationId: spaceId },
            data: { connectorsEnabled: true },
          });
        }
      },
    };
  } catch (error) {
    console.info(
      `[${label}.db.test] skipped:`,
      error instanceof Error ? error.message : String(error),
    );
    await cleanup().catch(() => undefined);
    return null;
  }
}
