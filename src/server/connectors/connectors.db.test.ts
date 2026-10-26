// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * AI connectors against the real roles and policies: grant resolution, the
 * connector RLS wrappers, Disconnect and the identity plane's revoke, and
 * the club switch. Tokens are real RS256 JWTs checked against a local key
 * set (fetch answers only AuthKit's JWKS URL). Everything made here is
 * removed in afterAll. Skips (every test returns early) without the local
 * database and the role passwords.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { authDb, disconnectAll } from "@/server/db/clients";
import {
  ConnectorRefusedError,
  SpaceRefusedError,
  withConnectorOrgTx,
  withUserTx,
} from "@/server/db/context";
import { ensurePersonalSpace } from "@/server/personal/space";
import { createOrganization } from "@/server/settings/org-creation";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import type { ConnectorsConfig } from "./config";
import { disconnectApps, listConnectedApps } from "./connected-apps";
import { consentSpaces } from "./consent";
import { resolveGrant } from "./grant";
import { revokeAllConnectorGrants } from "./revoke";
import {
  ACCESS_CLAIM,
  SPACE_CLAIM,
  UID_CLAIM,
  verifyConnectorToken,
  type VerifiedConnector,
} from "./token";
import { listConnectorSpaces } from "./tools/list-spaces";

const tag = randomBytes(4).toString("hex");
const config: ConnectorsConfig = {
  apiKey: "sk_test_unused",
  authkitOrigin: "https://club-123.authkit.app",
  resourceUrl: "http://localhost:3000/api/mcp",
  resourceMetadataUrl: "http://localhost:3000/.well-known/oauth-protected-resource/api/mcp",
};

interface U {
  id: string;
  email: string;
  name: string | null;
}
let alice: U;
let bob: U;
let club = { id: "", slug: "" };
let other = { id: "", slug: "" };
let personalId = "";
const pausedId = `org_conn_paused_${tag}`;
let reachable = true;

let privateKey: CryptoKey;
let publicJwk: JWK;

async function makeUser(local: string, name: string): Promise<U> {
  return authDb.user.create({
    data: {
      email: `${local}-${tag}@example.edu`,
      name,
      emailVerified: new Date(),
      onboardedAt: new Date(),
    },
    select: { id: true, email: true, name: true },
  });
}

/** A verified connector for `user` through one app, as the route builds it. */
async function connect(
  user: U,
  claims: Record<string, unknown> = {},
  clientId = `https://claude.ai/oauth/metadata-${tag}`,
): Promise<VerifiedConnector> {
  const token = await new SignJWT({
    [UID_CLAIM]: user.id,
    client_id: clientId,
    sid: "app_consent_1",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(config.authkitOrigin)
    .setAudience(config.resourceUrl)
    .setSubject(`user_01WORKOS_${user.id}`)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return verifyConnectorToken(token, config);
}

beforeAll(async () => {
  vi.stubEnv("PLATFORM_ORG_CREATION_ENABLED", "true");
  vi.stubEnv("ORG_CREATION_MODE", "open");
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `${config.authkitOrigin}/oauth2/jwks`)
        return Response.json({ keys: [publicJwk] });
      return realFetch(input, init);
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    alice = await makeUser("conn-alice", "Alice Nguyen");
    bob = await makeUser("conn-bob", "Bob Okafor");
    personalId = (await ensurePersonalSpace(alice.id)).id;
    const made = await createOrganization(bob, {
      name: `Connectors ${tag}`,
      slug: `connectors-${tag}`,
      timezone: "UTC",
    });
    if (!made.ok) throw new Error(JSON.stringify(made));
    club = { id: made.orgId, slug: made.slug };
    await ownerDb.membership.create({
      data: { organizationId: club.id, userId: alice.id, role: "MEMBER" },
    });
    // A club Alice is not in.
    const theirs = await createOrganization(bob, {
      name: `Not Alice's ${tag}`,
      slug: `not-alices-${tag}`,
      timezone: "UTC",
    });
    if (!theirs.ok) throw new Error(JSON.stringify(theirs));
    other = { id: theirs.orgId, slug: theirs.slug };
    // A club whose trial ended yesterday (the table owner may set any end).
    await ownerDb.organization.create({
      data: {
        id: pausedId,
        name: `Paused ${tag}`,
        slug: `paused-conn-${tag}`,
        timezone: "UTC",
        plan: "TRIAL",
        trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    await ownerDb.membership.create({
      data: { organizationId: pausedId, userId: alice.id, role: "OWNER" },
    });
  } catch (error) {
    console.info("[connectors.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (reachable) {
    const ids = [club.id, other.id, pausedId, personalId].filter(Boolean);
    await ownerDb.connectorGrant.deleteMany({ where: { userId: { in: [alice.id, bob.id] } } });
    await ownerDb.organization.deleteMany({ where: { id: { in: ids } } });
    await ownerDb.orgSlugHistory.deleteMany({
      where: { slug: { in: [club.slug, other.slug].filter(Boolean) } },
    });
  }
  const users = [alice?.id, bob?.id].filter(Boolean) as string[];
  if (users.length) await ownerDb.user.deleteMany({ where: { id: { in: users } } });
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("grant resolution against the local database", () => {
  it("records a grant on the first request: READ and every space without consent claims", async () => {
    if (!reachable) return;
    const connector = await connect(alice, {}, `https://claude.ai/first-${tag}`);
    const first = await resolveGrant(connector);
    expect(first).toMatchObject({
      ok: true,
      grant: { access: "READ", organizationId: null, clientName: null },
      lookUpClientName: true,
    });
    const row = await ownerDb.connectorGrant.findFirstOrThrow({
      where: { userId: alice.id, clientId: connector.clientId },
    });
    expect(row).toMatchObject({
      consentId: "app_consent_1",
      workosUserId: `user_01WORKOS_${alice.id}`,
      revokedAt: null,
    });
    // The same consent again: the same row, no second one.
    expect(await resolveGrant(connector)).toMatchObject({ ok: true, grant: { id: row.id } });
    expect(
      await ownerDb.connectorGrant.count({
        where: { userId: alice.id, clientId: connector.clientId },
      }),
    ).toBe(1);
  });

  it("stores the member's choices, and refuses a space they aren't in without recording anything", async () => {
    if (!reachable) return;
    const scoped = await connect(
      alice,
      { [SPACE_CLAIM]: club.id, [ACCESS_CLAIM]: "write" },
      `https://claude.ai/scoped-${tag}`,
    );
    expect(await resolveGrant(scoped)).toMatchObject({
      ok: true,
      grant: { access: "WRITE", organizationId: club.id },
    });

    const elsewhere = await connect(alice, { [SPACE_CLAIM]: other.id }, `client_elsewhere_${tag}`);
    expect(await resolveGrant(elsewhere)).toEqual({ ok: false, reason: "space" });
    expect(await ownerDb.connectorGrant.count({ where: { clientId: elsewhere.clientId } })).toBe(0);
  });

  it("refuses a disconnected app while its consent lasts, and renews on a new consent", async () => {
    if (!reachable) return;
    const clientId = `https://claude.ai/disconnect-${tag}`;
    const connector = await connect(alice, {}, clientId);
    const resolved = await resolveGrant(connector);
    if (!resolved.ok) throw new Error("expected a grant");

    expect(await disconnectApps(alice.id, resolved.grant.id)).toBe(1);
    expect((await listConnectedApps(alice.id)).map((a) => a.id)).not.toContain(resolved.grant.id);
    expect(await resolveGrant(connector)).toEqual({ ok: false, reason: "revoked" });

    const renewed = await resolveGrant(
      await connect(alice, { sid: "app_consent_2", [ACCESS_CLAIM]: "write" }, clientId),
    );
    expect(renewed).toMatchObject({ ok: true, grant: { id: resolved.grant.id, access: "WRITE" } });
    expect(
      await ownerDb.connectorGrant.findUniqueOrThrow({ where: { id: resolved.grant.id } }),
    ).toMatchObject({ consentId: "app_consent_2", revokedAt: null });
  });

  it("revokes every grant from the identity plane (app_auth), which the member path can't call", async () => {
    if (!reachable) return;
    const connector = await connect(alice, {}, `https://claude.ai/reset-${tag}`);
    await resolveGrant(connector);
    const revoked = await authDb.$transaction((tx) => revokeAllConnectorGrants(tx, alice.id));
    expect(revoked).toContainEqual({
      workosUserId: `user_01WORKOS_${alice.id}`,
      clientId: connector.clientId,
    });
    expect(
      await ownerDb.connectorGrant.count({ where: { userId: alice.id, revokedAt: null } }),
    ).toBe(0);
    expect(await resolveGrant(connector)).toEqual({ ok: false, reason: "revoked" });

    await expect(
      withUserTx(alice.id, ({ db }) => revokeAllConnectorGrants(db, bob.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("RLS on ConnectorGrant", () => {
  it("lets a user read and revoke only their own grants", async () => {
    if (!reachable) return;
    const connector = await connect(
      alice,
      { sid: "app_consent_9" },
      `https://claude.ai/rls-${tag}`,
    );
    const resolved = await resolveGrant(connector);
    if (!resolved.ok) throw new Error("expected a grant");

    expect(await withUserTx(bob.id, ({ db }) => db.connectorGrant.findMany())).toEqual([]);
    expect(await disconnectApps(bob.id, resolved.grant.id)).toBe(0);
    expect(await disconnectApps(bob.id, null)).toBe(0);
    expect(
      await ownerDb.connectorGrant.findUniqueOrThrow({ where: { id: resolved.grant.id } }),
    ).toMatchObject({ revokedAt: null });
    // Nor write one in Alice's name.
    await expect(
      withUserTx(bob.id, ({ db }) =>
        db.connectorGrant.create({
          data: {
            userId: alice.id,
            clientId: `forged-${tag}`,
            workosUserId: "user_x",
            consentId: "app_consent_x",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the connector wrappers against the local database", () => {
  it("runs as the member in their space, with ctx.user loaded for OrgContext services", async () => {
    if (!reachable) return;
    const connector = await connect(alice);
    const seen = await withConnectorOrgTx(
      connector,
      { organizationId: null },
      club.id,
      { whenPaused: "allow" },
      async (ctx) => ({ user: ctx.user, role: ctx.role, org: ctx.organizationId }),
    );
    expect(seen).toEqual({
      user: { id: alice.id, email: alice.email, name: "Alice Nguyen" },
      role: "MEMBER",
      org: club.id,
    });
    expect(
      await withConnectorOrgTx(
        connector,
        { organizationId: null },
        personalId,
        {},
        async (ctx) => ctx.role,
      ),
    ).toBe("OWNER");
  });

  it("answers another org's id as not found", async () => {
    if (!reachable) return;
    const connector = await connect(alice);
    await expect(
      withConnectorOrgTx(
        connector,
        { organizationId: null },
        other.id,
        { whenPaused: "allow" },
        async () => "ran",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withConnectorOrgTx(
        connector,
        { organizationId: null },
        `org_missing_${tag}`,
        {},
        async () => "ran",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a space the grant isn't scoped to", async () => {
    if (!reachable) return;
    const connector = await connect(alice);
    await expect(
      withConnectorOrgTx(connector, { organizationId: club.id }, personalId, {}, async () => "ran"),
    ).rejects.toMatchObject({ name: "ConnectorRefusedError", reason: "scope" });
  });

  it("refuses writes in a paused club and lets reads through", async () => {
    if (!reachable) return;
    const connector = await connect(alice);
    await expect(
      withConnectorOrgTx(connector, { organizationId: null }, pausedId, {}, async () => "ran"),
    ).rejects.toBeInstanceOf(SpaceRefusedError);
    expect(
      await withConnectorOrgTx(
        connector,
        { organizationId: null },
        pausedId,
        { whenPaused: "allow" },
        async () => "ran",
      ),
    ).toBe("ran");
  });

  it("refuses every call for a club that switched AI connectors off, and restores them when on", async () => {
    if (!reachable) return;
    const connector = await connect(alice);
    const call = () =>
      withConnectorOrgTx(
        connector,
        { organizationId: null },
        club.id,
        { whenPaused: "allow" },
        async () => "ran",
      );
    await ownerDb.orgSettings.update({
      where: { organizationId: club.id },
      data: { connectorsEnabled: false },
    });
    try {
      await expect(call()).rejects.toBeInstanceOf(ConnectorRefusedError);
      const spaces = await listConnectorSpaces(connector, { organizationId: null });
      expect(spaces.find((s) => s.id === club.id)).toMatchObject({ connectorsOn: false });
      expect((await consentSpaces(alice.id)).map((s) => s.id)).not.toContain(club.id);
    } finally {
      await ownerDb.orgSettings.update({
        where: { organizationId: club.id },
        data: { connectorsEnabled: true },
      });
    }
    expect(await call()).toBe("ran");
    expect((await consentSpaces(alice.id)).map((s) => s.id)).toContain(club.id);
  });

  it("lists Personal first, then the member's clubs, and only the scoped one for a scoped grant", async () => {
    if (!reachable) return;
    const connector = await connect(alice);
    const spaces = await listConnectorSpaces(connector, { organizationId: null });
    expect(spaces[0]).toMatchObject({
      id: personalId,
      name: "Personal",
      kind: "personal",
      role: "owner",
    });
    expect(spaces.map((s) => s.id).sort()).toEqual([club.id, pausedId, personalId].sort());
    expect(spaces.find((s) => s.id === pausedId)).toMatchObject({ paused: true, role: "owner" });
    expect(spaces.map((s) => s.id)).not.toContain(other.id);

    const scoped = await listConnectorSpaces(connector, { organizationId: club.id });
    expect(scoped.map((s) => s.id)).toEqual([club.id]);
  });
});
