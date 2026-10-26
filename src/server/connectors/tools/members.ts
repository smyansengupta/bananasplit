import "server-only";

import { z } from "zod";

import type { Role } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { parseStoredLinks } from "@/lib/profile/links";
import type { OrgContext } from "@/server/db/context";
import {
  countOrgPeopleInTx,
  listOrgPeopleInTx,
  userProfileSelect,
} from "@/server/profiles/queries";

import { decodeCursor, listFingerprint, pageOf } from "./cursor";
import { itemId, type ItemRef } from "./ids";
import {
  cursorArg,
  limitArg,
  nextCursor,
  READ_ONLY,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type FetchedItem,
  type ToolRegistrar,
} from "./shared";
import { inSpace, type ToolSpace } from "./space";
import { dayOf } from "./text";

/**
 * list_members and a member for fetch (docs/features/ai-connectors.md):
 * the club's current members as its people pages show them. Emails only
 * when the app shows them to this member: owners and admins
 * (members.viewEmails), everyone when Admin panel › Privacy shows member
 * emails to members, and always the member's own.
 */

const PEOPLE = { feature: "people", section: "people" } as const;

const ROLE_OUT: Record<Role, "owner" | "admin" | "treasurer" | "member"> = {
  OWNER: "owner",
  ADMIN: "admin",
  TREASURER: "treasurer",
  MEMBER: "member",
};

const memberSummary = z.object({
  id: z.string().describe("The member's id, for list_tasks' assignee and fetch."),
  name: z.string(),
  role: z.enum(["owner", "admin", "treasurer", "member"]),
  title: z.string().nullable().describe("Their title in this club."),
  pronouns: z.string().nullable(),
  major: z.string().nullable(),
  gradYear: z.number().int().nullable(),
  email: z.string().nullable().describe("Only when the club shows emails to this member."),
  url: urlField,
});

const listOutput = z.object({
  space: spaceRef,
  members: z.array(memberSummary),
  total: z.number().int().describe("Members matching, on every page."),
  nextCursor,
});

/** Whether the app shows other members' emails to this member here. */
async function emailsShown(ctx: OrgContext): Promise<boolean> {
  if (can({ role: ctx.role }, "members.viewEmails")) return true;
  const settings = await ctx.db.orgSettings.findUnique({
    where: { organizationId: ctx.organizationId },
    select: { showMemberEmailsToMembers: true },
  });
  return settings?.showMemberEmailsToMembers === true;
}

// ---------------------------------------------------------------- list_members

const listInput = z.object({
  space: spaceArg,
  query: z
    .string()
    .max(80)
    .optional()
    .describe("Words in their name, their title in the club, or their major."),
  limit: limitArg,
  cursor: cursorArg,
});

export async function listMembers(
  session: ConnectorSession,
  raw: z.input<typeof listInput>,
): Promise<z.infer<typeof listOutput>> {
  const args = listInput.parse(raw);
  const list = listFingerprint("list_members", { space: args.space, query: args.query });
  const position = decodeCursor(args.cursor, list);
  return inSpace(session, args.space, PEOPLE, async (ctx, space) => {
    const withEmails = await emailsShown(ctx);
    // One after another: a transaction has one connection.
    const total = await countOrgPeopleInTx(ctx.db, space.id, args.query);
    const rows = await listOrgPeopleInTx(ctx.db, space.id, {
      q: args.query,
      skip: position.offset,
      take: args.limit + 1,
      withEmails,
    });
    const page = pageOf(rows, args.limit, list, position);
    return {
      space: { id: space.id, name: space.name },
      members: page.items.map((p) => ({
        id: itemId("person", space.id, p.id),
        name: p.name?.trim() || "Member",
        role: ROLE_OUT[p.role],
        title: p.title,
        pronouns: p.pronouns,
        major: p.major,
        gradYear: p.gradYear,
        email: withEmails ? (p.email ?? null) : p.id === ctx.userId ? ctx.user.email : null,
        url: space.url(`/people/${p.id}`),
      })),
      total,
      nextCursor: page.nextCursor,
    };
  });
}

// ---------------------------------------------------------------- fetch

async function loadPerson(ctx: OrgContext, space: ToolSpace, userId: string) {
  const withEmail = userId === ctx.userId || (await emailsShown(ctx));
  const membership = await ctx.db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: space.id } },
    select: {
      role: true,
      title: true,
      joinedAt: true,
      user: { select: { ...userProfileSelect, email: withEmail } },
    },
  });
  if (!membership) throw new NotFoundError();
  return { ...membership, email: withEmail ? (membership.user.email ?? null) : null };
}

/** A current member for fetch: their profile as the club's people page shows it. */
export async function fetchPerson(session: ConnectorSession, ref: ItemRef): Promise<FetchedItem> {
  const { person, space } = await inSpace(session, ref.spaceId, PEOPLE, async (ctx, space) => ({
    person: await loadPerson(ctx, space, ref.id),
    space,
  }));
  const name = person.user.name?.trim() || "Member";
  const study = [person.user.major, person.user.gradYear && `class of ${person.user.gradYear}`]
    .filter(Boolean)
    .join(", ");
  const links = parseStoredLinks(person.user.links);
  const facts = [
    `Role: ${ROLE_OUT[person.role]}${person.title ? `, ${person.title}` : ""}`,
    person.user.pronouns && `Pronouns: ${person.user.pronouns}`,
    study && `Studies: ${study}`,
    person.email && `Email: ${person.email}`,
    `Member since: ${dayOf(person.joinedAt)}`,
    links.length > 0 && `Links: ${links.map((l) => l.url).join(", ")}`,
  ].filter(Boolean);
  return {
    id: itemId("person", space.id, ref.id),
    title: name,
    text: [`# ${name}`, facts.join("\n"), person.user.bio].filter(Boolean).join("\n\n"),
    url: space.url(`/people/${ref.id}`),
    metadata: {
      kind: "person",
      spaceId: space.id,
      space: space.name,
      role: ROLE_OUT[person.role],
      title: person.title,
    },
  };
}

// ---------------------------------------------------------------- registration

export const registerMemberTools: ToolRegistrar = (server, session) => {
  server.registerTool(
    "list_members",
    {
      title: "List members",
      description:
        "Lists a club's current members by name, with their role and title in the club, pronouns, major and year, and their email when the club shows emails to this member.",
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("list_members", () => listMembers(session, args)),
  );
};
