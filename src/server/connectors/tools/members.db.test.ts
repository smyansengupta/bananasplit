// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * list_members and a member through fetch, against the real roles and
 * policies (src/test/connector-fixture.ts): emails only for owners and
 * admins, or everyone when Privacy shows them to members (and always the
 * member's own), and the denials every tool has.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { disconnectAll } from "@/server/db/clients";
import { ConnectorRefusedError, SpaceRefusedError } from "@/server/db/context";
import {
  asJson,
  setUpConnectorFixture,
  type ConnectorFixture,
  type FixtureUser,
} from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { fetchItem } from "./fetch";
import { itemId } from "./ids";
import { listMembers } from "./members";
import { SectionHiddenError } from "./space";

let fx: ConnectorFixture | null = null;
let carol: FixtureUser;

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-members");
  if (!fx) return;
  carol = await fx.user("tool-members-carol", "Carol Diaz");
  await ownerDb.membership.create({
    data: { organizationId: fx.club.id, userId: carol.id, role: "ADMIN", title: "VP Outreach" },
  });
  await ownerDb.user.update({
    where: { id: carol.id },
    data: { major: "Economics", pronouns: "she/her", gradYear: 2027, bio: "Runs sponsor calls." },
  });
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

async function showEmailsToMembers<T>(on: boolean, fn: () => Promise<T>): Promise<T> {
  await ownerDb.orgSettings.update({
    where: { organizationId: fx!.club.id },
    data: { showMemberEmailsToMembers: on },
  });
  try {
    return await fn();
  } finally {
    await ownerDb.orgSettings.update({
      where: { organizationId: fx!.club.id },
      data: { showMemberEmailsToMembers: false },
    });
  }
}

describe("list_members", () => {
  it("lists the club by name with roles and titles, and only the member's own email", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const res = await listMembers(await fx.session(alice), { space: club.id });
    expect(res.total).toBe(3);
    expect(res.members.map((m) => m.name)).toEqual([alice.name, bob.name, carol.name]);
    expect(res.members.find((m) => m.name === carol.name)).toEqual({
      id: itemId("person", club.id, carol.id),
      name: carol.name,
      role: "admin",
      title: "VP Outreach",
      pronouns: "she/her",
      major: "Economics",
      gradYear: 2027,
      email: null,
      url: `http://localhost:3000/app/${club.slug}/people/${carol.id}`,
    });
    expect(res.members.find((m) => m.name === alice.name)?.email).toBe(alice.email);
    expect(res.members.find((m) => m.name === bob.name)?.email).toBeNull();
  });

  it("shows emails to owners and admins, and to members when Privacy shows them", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const owners = await listMembers(await fx.session(bob), { space: club.id });
    expect(owners.members.find((m) => m.name === carol.name)?.email).toBe(carol.email);
    await showEmailsToMembers(true, async () => {
      const members = await listMembers(await fx!.session(alice), { space: club.id });
      expect(members.members.find((m) => m.name === bob.name)?.email).toBe(bob.email);
    });
  });

  it("matches words and pages with a cursor", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice);
    const outreach = await listMembers(session, { space: club.id, query: "outreach" });
    expect(outreach.members.map((m) => m.name)).toEqual([carol.name]);
    const first = await listMembers(session, { space: club.id, limit: 2 });
    const rest = await listMembers(session, {
      space: club.id,
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect([...first.members, ...rest.members].map((m) => m.name)).toHaveLength(3);
    expect(rest.nextCursor).toBeNull();
  });

  it("refuses Personal (people are for clubs), another org, the club switch, another scope and hidden People", async () => {
    if (!fx) return;
    const { alice, bob, club, other, pausedId, personalId } = fx;
    const session = await fx.session(alice);
    await expect(listMembers(session, { space: personalId })).rejects.toBeInstanceOf(
      SpaceRefusedError,
    );
    expect((await listMembers(session, { space: pausedId })).members).toHaveLength(1);
    await expect(listMembers(session, { space: other.id })).rejects.toBeInstanceOf(NotFoundError);
    await fx.switchedOff(club.id, () =>
      expect(listMembers(session, { space: club.id })).rejects.toBeInstanceOf(
        ConnectorRefusedError,
      ),
    );
    await expect(
      listMembers(await fx.session(alice, { organizationId: pausedId }), { space: club.id }),
    ).rejects.toMatchObject({ reason: "scope" });
    await fx.hiding(club.id, ["people"], async () => {
      await expect(listMembers(session, { space: club.id })).rejects.toBeInstanceOf(
        SectionHiddenError,
      );
      expect((await listMembers(await fx!.session(bob), { space: club.id })).total).toBe(3);
    });
  });
});

describe("a member through fetch", () => {
  it("reads a profile, with the email only when the club shows it", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice);
    const id = itemId("person", club.id, carol.id);
    const profile = await fetchItem(session, { id });
    expect(profile).toMatchObject({
      id,
      title: carol.name,
      url: `http://localhost:3000/app/${club.slug}/people/${carol.id}`,
      metadata: { kind: "person", role: "admin", title: "VP Outreach" },
    });
    expect(profile.text).toContain("Runs sponsor calls.");
    expect(profile.text).not.toContain(carol.email);
    await showEmailsToMembers(true, async () => {
      expect((await fetchItem(session, { id })).text).toContain(carol.email);
    });
  });

  it("answers someone who isn't a member here, or another org, as not found", async () => {
    if (!fx) return;
    const { alice, bob, club, other } = fx;
    const session = await fx.session(alice);
    const outsider = await fx.user("tool-members-dan", "Dan Outsider");
    await expect(
      fetchItem(session, { id: itemId("person", club.id, outsider.id) }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      fetchItem(session, { id: itemId("person", other.id, bob.id) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("through the MCP server", () => {
  it("returns list_members and a member's fetch within their output schemas", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    const list = { space: fx.club.id };
    expect(await fx.call(session, "list_members", list)).toEqual(
      asJson(await listMembers(session, list)),
    );
    const id = itemId("person", fx.club.id, carol.id);
    expect(await fx.call(session, "fetch", { id })).toEqual(
      asJson(await fetchItem(session, { id })),
    );
  });
});
