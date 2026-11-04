// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The typed org chart against the local database (real roles and RLS) and
 * the seeded Claude Builders Club: "Start from members" drafts positions
 * from members' titles, and an outline typed in the editor saves through
 * the existing draft model (editVersion locking) and reads back as the
 * same outline. Only drafts are created, and they are deleted afterwards.
 * Skipped when the database or the seed is not there.
 */

const { sessionUser } = vi.hoisted(() => ({
  sessionUser: { current: null as null | { id: string; email: string; name: string | null } },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!sessionUser.current) throw new Error("no session");
    return sessionUser.current;
  },
}));

import type { DraftPosition } from "@/lib/org-chart/draft";
import { applyOutline, parseOutline, serializeOutline } from "@/lib/org-chart/outline";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgAction, withOrgTx, withSystemOrgTx } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { loadVersion, saveDraft, startDraft } from "./service";

type Person = { id: string; email: string; name: string | null };
let seeded: { cbcId: string; jackson: Person; kristine: Person } | null = null;
try {
  const cbc = await ownerDb.organization.findUnique({ where: { slug: "claude-builders-club" }, select: { id: true } });
  const jackson = await authDb.user.findUnique({ where: { email: "jackson@example.edu" }, select: { id: true, email: true, name: true } });
  const kristine = await authDb.user.findUnique({ where: { email: "kristine@example.edu" }, select: { id: true, email: true, name: true } });
  if (cbc && jackson && kristine) seeded = { cbcId: cbc.id, jackson, kristine };
} catch {
  seeded = null;
}

describe.skipIf(!seeded)("the typed org chart against the local database", () => {
  const s = seeded as NonNullable<typeof seeded>;
  const created: string[] = [];

  beforeEach(() => {
    sessionUser.current = s.jackson;
  });

  afterAll(async () => {
    await withSystemOrgTx(s.cbcId, ({ db }) => db.orgChartVersion.deleteMany({ where: { id: { in: created }, status: "DRAFT" } }));
    await disconnectAll();
    await disconnectOwnerDb();
  });

  const members = () =>
    withOrgTx(s.cbcId, async ({ db }) =>
      (await db.membership.findMany({ where: { organizationId: s.cbcId }, select: { userId: true, user: { select: { name: true } } } })).map(
        (m) => ({ id: m.userId, name: m.user.name }),
      ),
    );

  it("starts a draft from members' titles, each position linked to its member", async () => {
    const versionId = await withOrgAction((ctx) => startDraft(ctx, "members"))(s.cbcId);
    created.push(versionId);
    const draft = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, versionId));
    expect(draft?.version).toMatchObject({ status: "DRAFT", source: "MANUAL", parseMethod: "MANUAL" });
    const positions = draft?.positions ?? [];
    const president = positions.find((p) => p.title === "President");
    expect(president).toMatchObject({ userId: s.jackson.id, matchState: "CONFIRMED", reportsToId: null });
    expect(positions.find((p) => p.title === "Founder & Advisor")?.isAdvisor).toBe(true);
    expect(positions.find((p) => p.title === "Head of Social & Membership")).toMatchObject({ userId: s.kristine.id });
    expect(positions.filter((p) => p.reportsToId === null)).toHaveLength(1);
    expect(positions.every((p) => p.userId && p.matchState === "CONFIRMED")).toBe(true);
    expect(new Set(positions.map((p) => p.key)).size).toBe(positions.length);
  });

  it("saves a typed outline with optimistic locking and reads it back as the same outline", async () => {
    const versionId = await withOrgAction((ctx) => startDraft(ctx, "blank"))(s.cbcId);
    created.push(versionId);
    const list = await members();
    const text = [
      "President — @Jackson Lamoureux",
      "  Advisor: Founder & Advisor — @Mehr Anand",
      "  VP Growth — @Lucas Salzgeber",
      "    Head of Social & Membership — @Kristine Min",
      "    Open: Graphic Designer",
      "  Alumni liaison — Pat Doe",
    ].join("\n");
    const positions = applyOutline([], parseOutline(text), list);
    const payload = (editVersion: number, ps: DraftPosition[]) => ({
      versionId,
      editVersion,
      openItems: [],
      positions: ps.map((p) => ({
        id: p.id,
        title: p.title,
        personName: p.personName,
        userId: p.userId,
        matchState: p.matchState,
        matchScore: p.matchScore,
        suggestedUserIds: p.suggestedUserIds,
        reportsTo: p.reportsTo,
        isOpen: p.isOpen,
        isAdvisor: p.isAdvisor,
        responsibilities: p.responsibilities,
        decidesAlone: p.decidesAlone,
        rank: p.rank,
      })),
    });
    const saved = await withOrgAction((ctx) => saveDraft(ctx, payload(1, positions)))(s.cbcId);
    expect(saved).toMatchObject({ ok: true, editVersion: 2 });
    // A second autosave from a stale copy is refused, not merged.
    const stale = await withOrgAction((ctx) => saveDraft(ctx, payload(1, positions)))(s.cbcId);
    expect(stale).toMatchObject({ ok: false, conflict: true });

    const back = await withOrgTx(s.cbcId, (ctx) => loadVersion(ctx, versionId));
    const asDraft: DraftPosition[] = (back?.positions ?? []).map((p) => ({ ...p, reportsTo: p.reportsToId }));
    expect(serializeOutline(asDraft, list)).toBe(text);
  });

  it("lets any member start a draft, as themselves", async () => {
    sessionUser.current = s.kristine;
    const versionId = await withOrgAction((ctx) => startDraft(ctx, "members"))(s.cbcId);
    created.push(versionId);
    const row = await withOrgTx(s.cbcId, ({ db }) =>
      db.orgChartVersion.findUnique({ where: { id: versionId }, select: { createdById: true, status: true } }),
    );
    expect(row).toEqual({ createdById: s.kristine.id, status: "DRAFT" });
  });
});
