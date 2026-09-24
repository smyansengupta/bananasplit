// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import pg from "pg";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integrations end to end against the local database: the permission
 * rules, secrets that are stored encrypted and never come back to a page or
 * an action result, and the Google Calendar connect flow through the real
 * start and callback route handlers with a mocked Google.
 */

const { sessionUser } = vi.hoisted(() => ({
  sessionUser: { current: null as null | { id: string; email: string; name: string | null } },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!sessionUser.current) throw new Error("signed out");
    return sessionUser.current;
  },
  getSession: async () => (sessionUser.current ? { user: sessionUser.current } : null),
}));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { ForbiddenError } from "@/lib/auth/errors";
import { POST as startRoute } from "@/app/api/integrations/google-calendar/start/route";
import { GET as callbackRoute } from "@/app/api/integrations/google-calendar/callback/route";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withSystemOrgTx } from "@/server/db/context";
import { resolveOrgMailRouting } from "@/server/email/mailer";
import { getSecret } from "@/server/secrets";
import { createOrganization } from "@/server/settings/org-creation";

import { googleHttp, OAUTH_COOKIE } from "./google";
import { clients } from "./providers";
import {
  disconnectGoogle,
  loadIntegrations,
  removeProvider,
  resolveActor,
  saveClaude,
  saveEmailSender,
  saveNetlifyHook,
  sendTestEmail,
} from "./service";

let dbReady = false;
try {
  await authDb.$queryRaw`SELECT 1`;
  dbReady = Boolean(process.env.MIGRATE_DATABASE_URL);
} catch {
  dbReady = false;
}

type U = { id: string; email: string; name: string | null };

const CLAUDE_KEY = "sk-ant-api03-INTEGRATIONTESTKEY-0123456789-abcd";
const RESEND_KEY = "re_INTEGRATIONTEST_0123456789";
const REFRESH_TOKEN = "1//0gREFRESHTOKENFORTESTS-abcdefghijklmnop";

describe.skipIf(!dbReady)("integrations against the local database", () => {
  const stamp = Date.now().toString(36);
  let owner: U;
  let admin: U;
  let member: U;
  let orgId = "";
  let otherOrgId = "";
  let client: pg.Client;

  async function user(role: string): Promise<U> {
    return authDb.user.create({
      data: {
        email: `b1-int-${role}-${stamp}@example.edu`,
        name: `Int ${role}`,
        emailVerified: new Date(),
      },
      select: { id: true, email: true, name: true },
    });
  }

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
    await client.connect();
    owner = await user("owner");
    admin = await user("admin");
    member = await user("member");
    const a = await createOrganization(owner, {
      name: "Integrations Club",
      slug: `b1-int-${stamp}`,
      timezone: "UTC",
    });
    if (!a.ok) throw new Error(a.error);
    orgId = a.orgId;
    for (const [u, role] of [
      [admin, "ADMIN"],
      [member, "MEMBER"],
    ] as const) {
      await withSystemOrgTx(orgId, { userId: u.id }, ({ db }) =>
        db.membership.create({ data: { organizationId: orgId, userId: u.id, role } }),
      );
    }
    const b = await createOrganization(admin, {
      name: "Other Club",
      slug: `b1-int-other-${stamp}`,
      timezone: "UTC",
    });
    if (!b.ok) throw new Error(b.error);
    otherOrgId = b.orgId;
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "test-client");
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "test-secret");
    vi.stubEnv("EMAIL_DELIVERY", "sink");
  });

  beforeEach(() => {
    sessionUser.current = admin;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await client.query(`DELETE FROM "Organization" WHERE id = ANY($1)`, [
      [orgId, otherOrgId].filter(Boolean),
    ]);
    await authDb.user.deleteMany({
      where: { id: { in: [owner, admin, member].filter(Boolean).map((u) => u.id) } },
    });
    await client.end();
    await disconnectAll();
  });

  it("a MEMBER cannot save a key; an ADMIN saves one that is stored encrypted and never returned", async () => {
    sessionUser.current = member;
    const memberActor = await resolveActor(orgId);
    await expect(saveClaude(orgId, memberActor, { apiKey: CLAUDE_KEY })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    sessionUser.current = admin;
    vi.spyOn(clients, "anthropic").mockReturnValue({
      models: {
        list: () =>
          (async function* () {
            yield { id: "claude-opus-5" };
          })(),
      },
    } as never);
    const actor = await resolveActor(orgId);
    const result = await saveClaude(orgId, actor, {
      apiKey: CLAUDE_KEY,
      defaultModel: "claude-opus-5",
    });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain(CLAUDE_KEY);

    // The page DTO: status and last four only.
    const dtos = await loadIntegrations(orgId);
    const claude = dtos.find((d) => d.provider === "CLAUDE")!;
    expect(claude).toMatchObject({
      status: "CONNECTED",
      last4: CLAUDE_KEY.slice(-4),
      hasSecret: true,
    });
    expect(JSON.stringify(dtos)).not.toContain(CLAUDE_KEY);
    expect(JSON.stringify(dtos)).not.toContain(CLAUDE_KEY.slice(0, 20));

    // At rest: ciphertext only; readable only through the accessor.
    const raw = await client.query(
      `SELECT ciphertext FROM "OrgSecret" WHERE "organizationId" = $1`,
      [orgId],
    );
    expect(raw.rows.length).toBe(1);
    expect(Buffer.from(raw.rows[0].ciphertext).toString("utf8")).not.toContain(CLAUDE_KEY);
    expect(await getSecret({ orgId, provider: "CLAUDE", kind: "API_KEY" })).toBe(CLAUDE_KEY);

    // Audited, and every OWNER is alerted.
    const audit = await client.query(
      `SELECT action, "diffJson" FROM "OrgAuditLog" WHERE "organizationId" = $1 AND action LIKE 'integration.%'`,
      [orgId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["integration.secret_set", "integration.tested"]),
    );
    expect(JSON.stringify(audit.rows)).not.toContain(CLAUDE_KEY);
    const alert = await client.query(
      `SELECT 1 FROM "Notification" WHERE "organizationId" = $1 AND "userId" = $2 AND type = 'SECURITY_ALERT'`,
      [orgId, owner.id],
    );
    expect(alert.rowCount).toBeGreaterThan(0);
  });

  it("only an OWNER removes a key", async () => {
    const adminActor = await resolveActor(orgId);
    await expect(removeProvider(orgId, adminActor, "CLAUDE")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    sessionUser.current = owner;
    expect(await removeProvider(orgId, await resolveActor(orgId), "CLAUDE")).toMatchObject({
      ok: true,
    });
    const claude = (await loadIntegrations(orgId)).find((d) => d.provider === "CLAUDE")!;
    expect(claude).toMatchObject({ status: "DISCONNECTED", hasSecret: false, last4: null });
    expect(await getSecret({ orgId, provider: "CLAUDE", kind: "API_KEY" })).toBeNull();
  });

  it("a verified Resend sender routes org mail to itself and clears the platform fallback; the test email goes to the admin only", async () => {
    await client.query(
      `UPDATE "OrgSettings" SET "platformMailFallback" = true WHERE "organizationId" = $1`,
      [orgId],
    );
    vi.spyOn(clients, "resend").mockReturnValue({
      domains: {
        list: async () => ({
          data: { data: [{ name: "mail.club.org", status: "verified" }] },
          error: null,
        }),
      },
    } as never);
    const actor = await resolveActor(orgId);
    const saved = await saveEmailSender(orgId, actor, {
      fromName: "Integrations Club",
      fromAddress: "team@mail.club.org",
      apiKey: RESEND_KEY,
    });
    expect(saved).toMatchObject({
      ok: true,
      message: expect.stringMatching(/platform fallback is off/),
    });
    const routing = await resolveOrgMailRouting(orgId);
    expect(routing).toMatchObject({ mode: "org", platformMailFallback: false });
    expect(JSON.stringify(routing)).not.toContain(RESEND_KEY);

    const sent = await sendTestEmail(orgId, actor);
    expect(sent).toMatchObject({ ok: true, message: expect.stringMatching(/mail sink/) });
    expect(JSON.stringify(sent)).not.toContain(RESEND_KEY);
  });

  it("the Netlify hook must be a build_hooks URL", async () => {
    const actor = await resolveActor(orgId);
    expect(
      await saveNetlifyHook(orgId, actor, "https://evil.example.com/build_hooks/abc"),
    ).toMatchObject({ ok: false });
    expect(
      await saveNetlifyHook(orgId, actor, "https://api.netlify.com/build_hooks/abc123def"),
    ).toMatchObject({ ok: true });
    const hook = (await loadIntegrations(orgId)).find((d) => d.provider === "NETLIFY_BUILD_HOOK")!;
    expect(hook).toMatchObject({ status: "CONNECTED", last4: "3def" });
  });

  // ---------------------------------------------------------------- Google

  function mockGoogle() {
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "club@gmail.example", email_verified: true })).toString("base64url")}.y`;
    return vi.spyOn(googleHttp, "fetch").mockImplementation(async (url: string) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return Response.json({
          access_token: "ya29.ACCESS",
          refresh_token: REFRESH_TOKEN,
          expires_in: 3599,
          scope:
            "openid https://www.googleapis.com/auth/calendar.events.owned https://www.googleapis.com/auth/calendar.calendarlist.readonly email",
          id_token: idToken,
        });
      }
      if (url.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList")) {
        return Response.json({
          items: [
            { id: "club@gmail.example", summary: "Club", primary: true, accessRole: "owner" },
            {
              id: "events@group.calendar.google.com",
              summary: "Public events",
              accessRole: "owner",
            },
          ],
        });
      }
      if (url.startsWith("https://oauth2.googleapis.com/revoke"))
        return new Response("", { status: 200 });
      return new Response("not found", { status: 404 });
    });
  }

  async function start(org: string) {
    const form = new FormData();
    form.set("orgId", org);
    const res = await startRoute(
      new NextRequest("http://localhost:3401/api/integrations/google-calendar/start", {
        method: "POST",
        body: form,
      }),
    );
    const cookie = res.cookies.get(OAUTH_COOKIE)?.value ?? null;
    const location = res.headers.get("location") ?? "";
    return { res, cookie, state: new URL(location, "http://x").searchParams.get("state") };
  }

  async function callback(state: string | null, cookie: string | null, code = "auth-code") {
    const url = new URL("http://localhost:3401/api/integrations/google-calendar/callback");
    if (state) url.searchParams.set("state", state);
    url.searchParams.set("code", code);
    const res = await callbackRoute(
      new NextRequest(url, { headers: cookie ? { cookie: `${OAUTH_COOKIE}=${cookie}` } : {} }),
    );
    return new URL(res.headers.get("location") ?? "", "http://x").searchParams.get("google");
  }

  it("a MEMBER cannot start the Google flow", async () => {
    sessionUser.current = member;
    const { res } = await start(orgId);
    expect(res.status).toBe(403);
  });

  it("connects Google Calendar end to end (mocked Google): PKCE, signed state, refresh token stored as a secret", async () => {
    const google = mockGoogle();
    const { res, cookie, state } = await start(orgId);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
    );
    expect(cookie && state).toBeTruthy();

    expect(await callback(state, cookie)).toBe("connected");
    const tokenCall = google.mock.calls.find((c) =>
      String(c[0]).includes("oauth2.googleapis.com/token"),
    )!;
    expect(String((tokenCall[1] as RequestInit).body)).toContain("code_verifier=");

    expect(await getSecret({ orgId, provider: "GOOGLE_CALENDAR", kind: "REFRESH_TOKEN" })).toBe(
      REFRESH_TOKEN,
    );
    const dto = (await loadIntegrations(orgId)).find((d) => d.provider === "GOOGLE_CALENDAR")!;
    expect(dto).toMatchObject({ status: "CONNECTED", last4: REFRESH_TOKEN.slice(-4) });
    expect(dto.config).toMatchObject({ accountEmail: "club@gmail.example" });
    expect((dto.config.calendars as unknown[]).length).toBe(2);
    expect(JSON.stringify(dto)).not.toContain(REFRESH_TOKEN);
    expect(JSON.stringify(dto)).not.toContain("ya29.ACCESS");
  });

  it("refuses a replayed, tampered, cross-org or other-user callback", async () => {
    mockGoogle();
    const first = await start(orgId);
    // Replay without the (cleared) nonce cookie.
    expect(await callback(first.state, null)).toBe("invalid_state");
    // Tampered state.
    expect(await callback(`${first.state}x`, first.cookie)).toBe("invalid_state");
    // A state for this org with the cookie from a flow started for another org.
    const other = await start(otherOrgId);
    expect(await callback(first.state, other.cookie)).toBe("invalid_state");
    // Someone else finishing the admin's flow.
    sessionUser.current = owner;
    expect(await callback(first.state, first.cookie)).toBe("wrong_user");
  });

  it("disconnect stops the connection and queues the Google revoke", async () => {
    const actor = await resolveActor(orgId);
    expect(await disconnectGoogle(orgId, actor)).toMatchObject({ ok: true });
    const dto = (await loadIntegrations(orgId)).find((d) => d.provider === "GOOGLE_CALENDAR")!;
    expect(dto.status).toBe("DISCONNECTED");
    const job = await client.query(
      `SELECT status FROM "Job" WHERE "organizationId" = $1 AND kind = 'google-revoke'`,
      [orgId],
    );
    expect(job.rows.map((r) => r.status)).toEqual(["PENDING"]);
  });
});
