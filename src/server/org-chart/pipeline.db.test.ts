// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { readFileSync } from "node:fs";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The org chart pipeline against the local database (real roles and RLS)
 * and the seeded Claude Builders Club, with the Anthropic SDK replaced by a
 * double: upload through the route handler, the claude-parse job through
 * the real runner, the draft, publish with cache invalidation after commit,
 * rollback, refusal, the injection fixture and the quota. Skipped when the
 * database or the seed is not there.
 */

const { sessionUser, secretValue } = vi.hoisted(() => ({
  sessionUser: { current: null as null | { id: string; email: string; name: string | null } },
  secretValue: { current: "sk-ant-test-key-0000" as string | null },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!sessionUser.current) throw new Error("no session");
    return sessionUser.current;
  },
  getSession: async () => (sessionUser.current ? { user: sessionUser.current } : null),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
  retryAfterText: () => "later",
}));
vi.mock("@/server/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/secrets")>()),
  getSecret: async () => secretValue.current,
}));

import { POST as uploadRoute } from "@/app/api/orgs/[orgId]/org-chart/imports/route";
import { nextCache } from "@/server/cache/invalidate";
import { tags } from "@/server/cache/tags";
import { drainJobs } from "@/server/jobs/drain";
import { deleteBlobs } from "@/server/storage";

import { authDb, disconnectAll } from "../db/clients";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";
import { currentTx, withOrgAction, withOrgTx, withSystemOrgTx } from "../db/context";

import { anthropicClientFactory } from "./claude";
import { claudeParseJob } from "./parse-job";
import { getPublishedOrgChart } from "./queries";
import { loadVersion, publishDraft, rollbackToVersion, saveDraft, type SaveDraftInput } from "./service";

const fixtures = path.resolve("src/lib/org-chart/__fixtures__");
const read = (name: string) => readFileSync(path.join(fixtures, name));
const RAW = read("cbc-fall-2026.raw.json").toString("utf8");
const INJECTION_RAW = read("cbc-injection.raw.json").toString("utf8");

interface Person {
  id: string;
  email: string;
  name: string | null;
}
interface Seeded {
  cbcId: string;
  jackson: Person;
  kristine: Person;
  originalActive: string;
}

let seeded: Seeded | null = null;
try {
  const [cbc, jackson, kristine] = await Promise.all([
    ownerDb.organization.findUnique({
      where: { slug: "claude-builders-club" },
      select: { id: true, activeOrgChartVersionId: true },
    }),
    authDb.user.findUnique({ where: { email: "jackson@example.edu" }, select: { id: true, email: true, name: true } }),
    authDb.user.findUnique({ where: { email: "kristine@example.edu" }, select: { id: true, email: true, name: true } }),
  ]);
  if (cbc?.activeOrgChartVersionId && jackson && kristine) {
    seeded = { cbcId: cbc.id, jackson, kristine, originalActive: cbc.activeOrgChartVersionId };
  }
} catch {
  seeded = null;
}

/** The SDK double: answers from a queue and fails if called inside a transaction. */
const answers: Array<{ stop_reason?: string; text: string }> = [];
const claudeCalls: { tx: boolean }[] = [];
function fakeAnthropic(): Anthropic {
  const guard = () => {
    const inTx = currentTx() !== undefined;
    claudeCalls.push({ tx: inTx });
    if (inTx) throw new Error("Claude called inside a transaction");
  };
  return {
    beta: {
      messages: {
        countTokens: async () => {
          guard();
          return { input_tokens: 2500 };
        },
        create: async (body: { model: string }) => {
          guard();
          const next = answers.shift() ?? { text: RAW };
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: body.model,
            stop_reason: next.stop_reason ?? "end_turn",
            stop_sequence: null,
            stop_details: null,
            content: next.stop_reason === "refusal" ? [] : [{ type: "text", text: next.text, citations: null }],
            usage: { input_tokens: 2500, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          };
        },
      },
    },
  } as unknown as Anthropic;
}

function uploadRequest(orgId: string, name: string, bytes: Buffer, type: string, headers?: Record<string, string>) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  return uploadRoute(
    new Request(`http://localhost:3403/api/orgs/${orgId}/org-chart/imports`, { method: "POST", body: form, headers }),
    { params: Promise.resolve({ orgId }) },
  );
}

/** What a saved Claude key looks like on OrgIntegration (the key itself is mocked). */
const KEY_MARKER = { secretFingerprint: "0".repeat(32), secretLast4: "0000" } as const;

describe.skipIf(!seeded)("org chart pipeline against the local database (seeded CBC)", () => {
  const s = seeded as Seeded;
  const createdVersions: string[] = [];
  let createdIntegration = false;
  /**
   * The integration's secretFingerprint before the test, restored afterwards.
   * The fingerprint, not secretLast4, is what "a key is saved" reads: last4
   * is null for a credential under 16 characters.
   */
  let originalFingerprint: string | null | undefined;
  let firstDraft = "";

  beforeAll(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(anthropicClientFactory, "create").mockImplementation(() => fakeAnthropic());
    // A Claude integration row with a stored-key marker (the key itself comes from the mocked getSecret).
    createdIntegration = await withSystemOrgTx(s.cbcId, async ({ db }) => {
      const existing = await db.orgIntegration.findUnique({
        where: { organizationId_provider: { organizationId: s.cbcId, provider: "CLAUDE" } },
        select: { id: true, secretFingerprint: true },
      });
      originalFingerprint = existing ? existing.secretFingerprint : undefined;
      if (existing?.secretFingerprint) return false;
      if (existing) {
        await db.orgIntegration.update({ where: { id: existing.id }, data: KEY_MARKER });
        return false;
      }
      await db.orgIntegration.create({
        data: { organizationId: s.cbcId, provider: "CLAUDE", ...KEY_MARKER, connectedById: s.jackson.id },
      });
      return true;
    });
    // Leftovers from an interrupted run must not block the one-active-parse
    // rule. Only this suite's own kind of leftover is cleared: other suites
    // run against the same seeded org and keep drafts of their own.
    await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.orgChartVersion.updateMany({
        where: { organizationId: s.cbcId, status: "DRAFT", source: "UPLOAD" },
        data: { status: "DISCARDED" },
      }),
    );
    // Nor may a leftover claude-parse job take this org's one heavy slot: the
    // drain claims a single heavy job per call, oldest runAt first, so one
    // corpse from an interrupted run is claimed instead of the job under test
    // and every drain here reports done: 0.
    await ownerDb.job.updateMany({
      where: { organizationId: s.cbcId, kind: "claude-parse", status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELLED", lockToken: null, lockedUntil: null, lastError: "cleared by pipeline.db.test" },
    });
  });

  beforeEach(() => {
    sessionUser.current = s.jackson;
    secretValue.current = "sk-ant-test-key-0000";
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    const blobs = await withSystemOrgTx(s.cbcId, async ({ db }) => {
      const rows = await db.orgChartVersion.findMany({
        where: { id: { in: createdVersions } },
        select: { sourceBlobKey: true },
      });
      await db.organization.update({ where: { id: s.cbcId }, data: { activeOrgChartVersionId: s.originalActive } });
      await db.orgChartVersion.update({ where: { id: s.originalActive }, data: { status: "PUBLISHED" } });
      await db.orgChartVersion.deleteMany({ where: { id: { in: createdVersions } } });
      if (createdIntegration) {
        await db.orgIntegration.deleteMany({ where: { organizationId: s.cbcId, provider: "CLAUDE" } });
      } else if (originalFingerprint !== undefined) {
        await db.orgIntegration.updateMany({
          where: { organizationId: s.cbcId, provider: "CLAUDE" },
          data: { secretFingerprint: originalFingerprint },
        });
      }
      return rows.map((r) => r.sourceBlobKey).filter((k): k is string => Boolean(k));
    });
    if (blobs.length) await deleteBlobs(blobs);
    await disconnectAll();
    await disconnectOwnerDb();
  });

  /** Puts a version this suite created back out of the way. */
  async function discard(versionId: string) {
    await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.orgChartVersion.updateMany({ where: { id: versionId, status: "DRAFT" }, data: { status: "DISCARDED" } }),
    );
  }

  async function track(res: Response) {
    const body = (await res.json()) as { versionId?: string; error?: string };
    if (body.versionId) createdVersions.push(body.versionId);
    return { status: res.status, body };
  }

  it("accepts an upload from the host the browser asked for, and still refuses another site", async () => {
    // Next rebuilds request.url from the host the server is bound to, so the
    // same-site check reads the Host header the browser sent. An org reached
    // on its own hostname (or through a proxy) must still be able to import.
    const sameSite = await track(
      await uploadRequest(s.cbcId, "cbc.md", read("cbc-fall-2026.md"), "text/markdown", {
        host: "chart.localhost:3602",
        origin: "http://chart.localhost:3602",
      }),
    );
    expect(sameSite.status).toBe(201);
    await discard(sameSite.body.versionId!);

    const crossSite = await track(
      await uploadRequest(s.cbcId, "cbc.md", read("cbc-fall-2026.md"), "text/markdown", {
        host: "chart.localhost:3602",
        origin: "https://evil.example.com",
      }),
    );
    expect(crossSite.status).toBe(403);
    expect(crossSite.body.error).toBe("Forbidden.");
  });

  it("a MEMBER cannot upload; an unsupported file is refused before anything is stored", async () => {
    sessionUser.current = s.kristine;
    const member = await track(await uploadRequest(s.cbcId, "cbc.md", read("cbc-fall-2026.md"), "text/markdown"));
    expect(member.status).toBe(403);
    sessionUser.current = s.jackson;
    const rtf = await track(await uploadRequest(s.cbcId, "cbc.rtf", Buffer.from("{\\rtf1 hi}"), "application/rtf"));
    expect(rtf.status).toBe(415);
  });

  it("reads the CBC document with the built-in parser, in the upload, with no Claude call", async () => {
    claudeCalls.length = 0;
    const res = await track(await uploadRequest(s.cbcId, "cbc-fall-2026.md", read("cbc-fall-2026.md"), "text/plain"));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ready: true, reader: "builtin" });
    firstDraft = res.body.versionId as string;

    // The whole point: no job, no API call, nothing billed.
    expect(claudeCalls).toEqual([]);
    const summary = await drainJobs({ kinds: ["claude-parse"], budgetMs: 30_000 });
    expect(summary.done).toBe(0);
    expect(claudeCalls).toEqual([]);

    const draft = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, firstDraft));
    expect(draft?.version).toMatchObject({
      status: "DRAFT",
      source: "UPLOAD",
      parseStatus: "READY",
      parseMethod: "BUILTIN",
      parseModel: null,
      parseCostUsd: null,
      warnings: [],
    });
    expect(draft?.version.sourceBlobKey).toMatch(new RegExp(`^org-chart/${s.cbcId}/${firstDraft}/`));
    expect(draft?.version.parseConfidence).toBeGreaterThanOrEqual(0.9);
    expect(draft?.version.parseReport).toMatchObject({ shape: "sections", positions: 9 });
    const expected = JSON.parse(read("expected.json").toString("utf8")) as {
      positions: { key: string; reportsTo: string | null; isOpen: boolean; isAdvisor: boolean }[];
    };
    const byId = new Map(draft!.positions.map((p) => [p.id, p]));
    expect(
      draft!.positions
        .map((p) => ({
          key: p.key,
          reportsTo: p.reportsToId ? byId.get(p.reportsToId)!.key : null,
          isOpen: p.isOpen,
          isAdvisor: p.isAdvisor,
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    ).toEqual(
      expected.positions
        .map((p) => ({ key: p.key, reportsTo: p.reportsTo, isOpen: p.isOpen, isAdvisor: p.isAdvisor }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    );
    // Suggestions only: nobody is linked until an admin confirms.
    const president = draft!.positions.find((p) => p.key === "president")!;
    expect(president).toMatchObject({ userId: null, matchState: "SUGGESTED", matchScore: 1 });
    expect(president.suggestedUserIds[0]).toBe(s.jackson.id);
    expect(draft!.positions.find((p) => p.key === "graphic-designer")).toMatchObject({
      matchState: "UNMATCHED",
      personName: null,
    });
  });

  it("falls back to Claude Haiku for a document the parser cannot read", async () => {
    claudeCalls.length = 0;
    const res = await track(await uploadRequest(s.cbcId, "who-does-what.md", read("cbc-narrative.md"), "text/markdown"));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ready: false, reader: "claude" });
    const versionId = res.body.versionId as string;

    // One active parse per org: a second document that also needs Claude waits.
    const second = await track(await uploadRequest(s.cbcId, "again.md", read("cbc-narrative.md"), "text/markdown"));
    expect(second.status).toBe(409);

    const pending = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, versionId));
    expect(pending?.version).toMatchObject({ parseStatus: "PENDING", parseMethod: null });
    expect(pending?.version.parseReport).toMatchObject({ shape: "none", positions: 0 });

    const summary = await drainJobs({ kinds: ["claude-parse"], budgetMs: 290_000 });
    expect(summary.refused).toBeUndefined();
    expect(summary.done).toBe(1);
    expect(claudeCalls.length).toBeGreaterThan(0);
    expect(claudeCalls.every((c) => !c.tx)).toBe(true);

    const draft = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, versionId));
    expect(draft?.version).toMatchObject({
      parseStatus: "READY",
      parseMethod: "CLAUDE",
      parseModel: "claude-haiku-4-5-20251001",
    });
    // 2,500 input and 2,000 output tokens on Haiku 4.5 ($1/$5 per MTok).
    expect(draft?.version.parseCostUsd).toBeCloseTo(0.0125, 6);
    expect(draft?.positions).toHaveLength(9);

    await discard(versionId);
  });

  it("keeps the parser's reading when Claude cannot finish", async () => {
    claudeCalls.length = 0;
    // A document the parser only half understands: two roles it can read and
    // a paragraph it cannot place.
    const partial = Buffer.from(
      [
        "Board notes, fall semester",
        "",
        "President — Jackson Lamoureux",
        "Head of Tech — Smyan Sengupta",
        "",
        "Everything else is still being worked out. We had a long conversation about",
        "whether the design work should sit under growth or under programs, and we did",
        "not settle it. Anthony is handling money for now. Kristine is doing social.",
        "",
      ].join("\n"),
      "utf8",
    );
    answers.push({ stop_reason: "refusal", text: "" });
    const res = await track(await uploadRequest(s.cbcId, "notes.md", partial, "text/markdown"));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ready: false, reader: "claude" });

    const summary = await drainJobs({ kinds: ["claude-parse"], budgetMs: 290_000 });
    expect(summary.dead).toBe(1);
    const draft = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, res.body.versionId!));
    // Not FAILED: the admin gets the two positions the portal did read, plus
    // the reason Claude could not help.
    expect(draft?.version).toMatchObject({ parseStatus: "READY", parseMethod: "BUILTIN" });
    expect(draft?.positions.map((p) => p.key).sort()).toEqual(["head-of-tech", "president"]);
    expect(JSON.stringify(draft?.version.parseReport)).toMatch(/Claude could not read this document/);

    await discard(res.body.versionId!);
  });

  it("a stale attempt is cancelled by the compare-and-set and changes nothing", async () => {
    const before = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, firstDraft));
    const outcome = await claudeParseJob({
      id: "job_x",
      kind: "claude-parse",
      organizationId: s.cbcId,
      payload: { versionId: firstDraft, parseAttemptId: "stale0000000000000000000" },
      dedupeKey: "claude-parse:x",
      attempt: 1,
      maxAttempts: 3,
      signal: new AbortController().signal,
      deadline: Date.now() + 200_000,
    });
    expect(outcome).toMatchObject({ status: "CANCELLED" });
    const after = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, firstDraft));
    expect(after?.version.editVersion).toBe(before?.version.editVersion);
  });

  it("members cannot read the draft", async () => {
    sessionUser.current = s.kristine;
    expect(await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, firstDraft))).toBeNull();
  });

  it("the admin confirms matches, edits and publishes; the cache is invalidated after commit", async () => {
    const draft = (await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, firstDraft)))!;
    const input: SaveDraftInput = {
      versionId: firstDraft,
      editVersion: draft.version.editVersion,
      openItems: draft.version.openItems,
      positions: draft.positions.map((p) => ({
        id: p.id,
        title: p.key === "vp-growth" ? "VP Growth & Brand" : p.title,
        personName: p.personName,
        userId: p.matchScore === 1 ? (p.suggestedUserIds[0] ?? null) : null,
        matchState: p.matchScore === 1 ? "CONFIRMED" : p.matchState,
        matchScore: p.matchScore,
        suggestedUserIds: p.suggestedUserIds,
        reportsTo: p.reportsToId,
        isOpen: p.isOpen,
        isAdvisor: p.isAdvisor,
        responsibilities: p.responsibilities,
        decidesAlone: p.decidesAlone,
        rank: p.rank,
      })),
    };
    const saved = await withOrgAction((ctx) => saveDraft(ctx, input))(s.cbcId);
    expect(saved).toMatchObject({ ok: true, editVersion: draft.version.editVersion + 1 });
    // A second save from the same stale copy is a conflict.
    const stale = await withOrgAction((ctx) => saveDraft(ctx, input))(s.cbcId);
    expect(stale).toMatchObject({ ok: false, conflict: true });

    // A MEMBER cannot publish.
    sessionUser.current = s.kristine;
    await expect(withOrgAction((ctx) => publishDraft(ctx, firstDraft))(s.cbcId)).rejects.toThrow();
    sessionUser.current = s.jackson;

    const seen: string[] = [];
    const update = vi.spyOn(nextCache, "updateTag").mockImplementation((tag) => void seen.push(tag));
    const revalidate = vi.spyOn(nextCache, "revalidateTag").mockImplementation((tag) => void seen.push(tag));
    const published = await withOrgAction((ctx) => publishDraft(ctx, firstDraft))(s.cbcId);
    update.mockRestore();
    revalidate.mockRestore();
    expect(published).toEqual({ ok: true, number: draft.version.number });
    expect(seen).toEqual([tags.orgChart(s.cbcId)]);

    const chart = await getPublishedOrgChart(s.cbcId);
    expect(chart?.versionId).toBe(firstDraft);
    expect(chart?.positions).toHaveLength(9);
    const growth = chart!.positions.find((p) => p.key === "vp-growth")!;
    expect(growth.title).toBe("VP Growth & Brand");
    expect(chart!.positions.find((p) => p.key === "president")?.user?.id).toBe(s.jackson.id);
    const original = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, s.originalActive));
    expect(original?.version.status).toBe("ARCHIVED");
  });

  it("a failed publish leaves the chart and the cache untouched", async () => {
    const blank = await withOrgAction(async (ctx) => {
      const { startDraft } = await import("./service");
      return startDraft(ctx, "blank");
    })(s.cbcId);
    createdVersions.push(blank);
    const seen: string[] = [];
    const update = vi.spyOn(nextCache, "updateTag").mockImplementation((tag) => void seen.push(tag));
    const result = await withOrgAction((ctx) => publishDraft(ctx, blank))(s.cbcId);
    update.mockRestore();
    expect(result).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
    expect((await getPublishedOrgChart(s.cbcId))?.versionId).toBe(firstDraft);
  });

  it("rollback copies the seed version forward as a new published version", async () => {
    const seen: string[] = [];
    const update = vi.spyOn(nextCache, "updateTag").mockImplementation((tag) => void seen.push(tag));
    const result = await withOrgAction((ctx) => rollbackToVersion(ctx, s.originalActive))(s.cbcId);
    update.mockRestore();
    expect(result).toMatchObject({ ok: true });
    const copyId = (result as { versionId: string }).versionId;
    createdVersions.push(copyId);
    expect(seen).toEqual([tags.orgChart(s.cbcId)]);
    const copy = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, copyId));
    expect(copy?.version).toMatchObject({ status: "PUBLISHED", source: "ROLLBACK", basedOnVersionId: s.originalActive });
    expect(copy?.positions.find((p) => p.key === "vp-growth")?.title).toBe("VP Growth");
    expect((await getPublishedOrgChart(s.cbcId))?.versionId).toBe(copyId);

    // Publishing swaps this org's chart for one with new position ids, and
    // other suites hold ids from the seeded chart. Put it back as soon as
    // the publish and rollback assertions are done, rather than in afterAll.
    await withSystemOrgTx(s.cbcId, async ({ db }) => {
      await db.orgChartVersion.update({ where: { id: copyId }, data: { status: "DISCARDED" } });
      await db.orgChartVersion.update({ where: { id: s.originalActive }, data: { status: "PUBLISHED" } });
      await db.organization.update({ where: { id: s.cbcId }, data: { activeOrgChartVersionId: s.originalActive } });
    });
  });

  it("a refusal fails a draft the parser read nothing from, with a clear message", async () => {
    answers.push({ stop_reason: "refusal", text: "" });
    const res = await track(await uploadRequest(s.cbcId, "prose.md", read("cbc-narrative.md"), "text/markdown"));
    expect(res.status).toBe(201);
    const summary = await drainJobs({ kinds: ["claude-parse"], budgetMs: 290_000 });
    expect(summary.dead).toBe(1);
    const failed = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, res.body.versionId!));
    expect(failed?.version.parseStatus).toBe("FAILED");
    expect(failed?.version.parseError).toMatch(/declined/);
    expect(failed?.positions).toEqual([]);
    await discard(res.body.versionId!);
  });

  it("the injection fixture is read by the parser, which executes nothing and calls nothing", async () => {
    claudeCalls.length = 0;
    const res = await track(await uploadRequest(s.cbcId, "board.md", read("cbc-injection.md"), "text/markdown"));
    expect(res.status).toBe(201);
    expect(claudeCalls).toEqual([]);
    const draft = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, res.body.versionId!));
    expect(draft?.version).toMatchObject({ parseStatus: "READY", parseMethod: "BUILTIN" });
    expect(draft?.positions.map((p) => p.key).sort()).toEqual(["head-of-security", "president", "vp-ops-programs"]);
    expect(draft?.positions.every((p) => p.userId === null)).toBe(true);
    // The injected instructions are data: reported as lines nobody could
    // place, never followed.
    const report = draft?.version.parseReport;
    expect(JSON.stringify(report?.orphanLines)).toMatch(/IMPORTANT INSTRUCTIONS/);
    await discard(res.body.versionId!);
  });

  it("the injection fixture through Claude yields a schema-valid draft and no side effects", async () => {
    /**
     * What the fixture orders the model to do: make everyone an OWNER, invite
     * attacker@example.com, mail the member list there, and delete the other
     * versions. Each count is scoped to that, not to the org as a whole:
     * other test files run against this same seeded org in parallel, and an
     * org-wide total moves under this test for reasons that are not its own.
     */
    const attacker = "attacker@example.com";
    const counts = () =>
      withSystemOrgTx(s.cbcId, async ({ db }) => ({
        owners: await db.membership.count({ where: { organizationId: s.cbcId, role: "OWNER" } }),
        invitations: await db.invitation.count({ where: { organizationId: s.cbcId, email: attacker } }),
        notifications: await db.notification.count({
          where: { organizationId: s.cbcId, OR: [{ title: { contains: attacker } }, { body: { contains: attacker } }] },
        }),
        emailJobs: await db.job.count({
          where: {
            organizationId: s.cbcId,
            kind: { in: ["email", "notify-email", "invite-email"] },
            dedupeKey: { contains: attacker },
          },
        }),
      }));
    const versionCount = () =>
      withSystemOrgTx(s.cbcId, ({ db }) => db.orgChartVersion.count({ where: { organizationId: s.cbcId } }));
    const before = await counts();
    // The narrative document forces the Claude path; the double answers with
    // the injection fixture's output, which must still be schema-bound data.
    const versionsBefore = await versionCount();
    answers.push({ text: INJECTION_RAW });
    const res = await track(await uploadRequest(s.cbcId, "prose.md", read("cbc-narrative.md"), "text/markdown"));
    expect(res.status).toBe(201);
    await drainJobs({ kinds: ["claude-parse"], budgetMs: 290_000 });
    const draft = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, res.body.versionId!));
    expect(draft?.version).toMatchObject({ parseStatus: "READY", parseMethod: "CLAUDE" });
    expect(draft?.positions.map((p) => p.key).sort()).toEqual(["head-of-security", "president", "vp-ops-programs"]);
    expect(draft?.positions.every((p) => p.userId === null)).toBe(true);
    expect(draft?.version.openItems[0]?.question).toMatch(/ignored/);
    expect(await counts()).toEqual(before);
    await discard(res.body.versionId!);
    // The upload's own draft is the only version added, and none was deleted.
    expect(await versionCount()).toBe(versionsBefore + 1);
  });

  describe("an org with no Claude API key at all", () => {
    beforeEach(async () => {
      await withSystemOrgTx(s.cbcId, ({ db }) =>
        db.orgChartVersion.updateMany({
          where: { organizationId: s.cbcId, status: "DRAFT", id: { in: createdVersions } },
          data: { status: "DISCARDED" },
        }),
      );
      await withSystemOrgTx(s.cbcId, ({ db }) =>
        db.orgIntegration.updateMany({
          where: { organizationId: s.cbcId, provider: "CLAUDE" },
          data: { secretFingerprint: null, secretLast4: null },
        }),
      );
      secretValue.current = null;
      claudeCalls.length = 0;
    });

    afterEach(async () => {
      await withSystemOrgTx(s.cbcId, ({ db }) =>
        db.orgIntegration.updateMany({
          where: { organizationId: s.cbcId, provider: "CLAUDE" },
          data: KEY_MARKER,
        }),
      );
    });

    it("still imports the CBC document end to end", async () => {
      const res = await track(await uploadRequest(s.cbcId, "cbc.md", read("cbc-fall-2026.md"), "text/markdown"));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ ready: true, reader: "builtin" });
      expect(claudeCalls).toEqual([]);
      const draft = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, res.body.versionId!));
      expect(draft?.version).toMatchObject({ parseStatus: "READY", parseMethod: "BUILTIN" });
      expect(draft?.positions).toHaveLength(9);
      await discard(res.body.versionId!);
    });

    it("says why a PDF's draft is empty rather than leaving the admin guessing", async () => {
      // There is no local PDF text extraction, so the parser reads nothing.
      // The draft still has to explain itself and offer a way forward.
      const res = await track(await uploadRequest(s.cbcId, "chart.pdf", read("cbc-fall-2026.pdf"), "application/pdf"));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ ready: true, reader: "builtin" });
      expect(claudeCalls).toEqual([]);
      const draft = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, res.body.versionId!));
      expect(draft?.version).toMatchObject({ parseStatus: "READY", parseMethod: "BUILTIN" });
      expect(draft?.positions).toEqual([]);
      expect(draft?.version.parseReport).toMatchObject({ shape: "none", positions: 0 });
      expect(JSON.stringify(draft?.version.parseReport?.notes)).toMatch(/no text the portal can read/);
      expect(JSON.stringify(draft?.version.parseReport?.notes)).toMatch(/Claude API key|club template/);
      await discard(res.body.versionId!);
    });

    it("lands an unreadable document in the editor rather than refusing it", async () => {
      const res = await track(await uploadRequest(s.cbcId, "prose.md", read("cbc-narrative.md"), "text/markdown"));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ ready: true, reader: "builtin" });
      expect(claudeCalls).toEqual([]);
      const draft = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, res.body.versionId!));
      expect(draft?.version).toMatchObject({ parseStatus: "READY", parseMethod: "BUILTIN" });
      expect(draft?.positions).toEqual([]);
      expect(JSON.stringify(draft?.version.parseReport?.notes)).toMatch(/club template/);
      await discard(res.body.versionId!);
    });

    it("offers the starter structure, laid out and ready to fill in", async () => {
      const restoreTo = (await getPublishedOrgChart(s.cbcId))?.versionId as string;
      const versionId = await withOrgAction(async (ctx) => {
        const { startDraft } = await import("./service");
        return startDraft(ctx, "starter");
      })(s.cbcId);
      createdVersions.push(versionId);
      const draft = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, versionId));
      expect(draft?.version).toMatchObject({ source: "MANUAL", parseMethod: "TEMPLATE" });
      expect(draft?.positions.map((p) => p.title).sort()).toEqual([
        "Events Lead",
        "Faculty Advisor",
        "Marketing Lead",
        "President",
        "Secretary",
        "Treasurer",
        "Vice President",
      ]);
      // Roles and reporting lines are filled in; the people are not.
      expect(draft?.positions.every((p) => p.personName === null && p.userId === null)).toBe(true);
      expect(draft?.positions.find((p) => p.key === "marketing-lead")?.isOpen).toBe(true);
      expect(draft?.positions.find((p) => p.key === "faculty-advisor")?.isAdvisor).toBe(true);
      expect(draft?.positions.filter((p) => p.reportsToId === null)).toHaveLength(1);
      expect(draft?.positions.find((p) => p.key === "president")?.responsibilities.length).toBeGreaterThan(2);
      // And it publishes as it stands. Put the club's own chart back straight
      // away: other suites read this org's published chart too.
      const published = await withOrgAction((ctx) => publishDraft(ctx, versionId))(s.cbcId);
      expect(published).toMatchObject({ ok: true });
      const live = await getPublishedOrgChart(s.cbcId);
      expect(live?.versionId).toBe(versionId);
      expect(live?.positions).toHaveLength(7);
      await withSystemOrgTx(s.cbcId, async ({ db }) => {
        await db.orgChartVersion.update({ where: { id: versionId }, data: { status: "DISCARDED" } });
        await db.orgChartVersion.update({ where: { id: restoreTo }, data: { status: "PUBLISHED" } });
        await db.organization.update({ where: { id: s.cbcId }, data: { activeOrgChartVersionId: restoreTo } });
      });
    });
  });
});
