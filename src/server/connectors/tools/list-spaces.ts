import "server-only";

import { z } from "zod";

import { appUrl } from "@/lib/app-url";
import { withConnectorUserTx } from "@/server/db/context";

import { toolError } from "../errors";
import type { ResolvedGrant } from "../grant";
import type { VerifiedConnector } from "../token";
import { jsonResult, READ_ONLY, type ToolRegistrar } from "./shared";

/**
 * list_spaces (Phase 1's one tool): the spaces this connection can use, the
 * member's Personal space first, then their clubs by name. A grant scoped to
 * one space lists only that one. Every other tool takes a space id from here.
 */

const spaceSchema = z.object({
  id: z.string().describe("The space's id, for the other tools."),
  name: z.string().describe("The organization's name, or \"Personal\" for the member's own space."),
  kind: z.enum(["personal", "club"]),
  role: z
    .enum(["owner", "admin", "treasurer", "member"])
    .describe("The member's role in the space."),
  url: z.string().describe("The space in Bananasplit."),
  connectorsOn: z
    .boolean()
    .describe(
      "Whether the organization allows AI apps. When false, every other tool refuses this space.",
    ),
});

const outputSchema = z.object({
  access: z
    .enum(["read", "read_and_change"])
    .describe("What the member let this app do when they connected it."),
  spaces: z.array(spaceSchema),
});

export type ConnectorSpace = z.infer<typeof spaceSchema>;
export type ListSpacesOutput = z.infer<typeof outputSchema>;

/** The member's spaces as list_spaces returns them, in one transaction under RLS. */
export async function listConnectorSpaces(
  connector: VerifiedConnector,
  grant: Pick<ResolvedGrant, "organizationId">,
): Promise<ConnectorSpace[]> {
  return withConnectorUserTx(connector, async ({ db }) => {
    // OrgSettings is readable only in the current org; this reads every
    // switch at once (sequential: one connection per transaction).
    const switches = await db.$queryRaw<{ organizationId: string; connectorsEnabled: boolean }[]>`
      SELECT "organizationId", "connectorsEnabled" FROM app.connector_spaces()`;
    const memberships = await db.membership.findMany({
      where: {
        userId: connector.userId,
        organization: { deletedAt: null },
        ...(grant.organizationId ? { organizationId: grant.organizationId } : {}),
      },
      select: {
        role: true,
        organization: {
          select: { id: true, name: true, slug: true, kind: true },
        },
      },
      orderBy: { organization: { name: "asc" } },
    });
    const on = new Map(switches.map((s) => [s.organizationId, s.connectorsEnabled]));
    const spaces = memberships.map(({ role, organization: org }): ConnectorSpace => {
      const personal = org.kind === "PERSONAL";
      return {
        id: org.id,
        name: personal ? "Personal" : org.name,
        kind: personal ? "personal" : "club",
        role: role.toLowerCase() as ConnectorSpace["role"],
        url: appUrl(`/app/${org.slug}`),
        connectorsOn: on.get(org.id) ?? true,
      };
    });
    return [
      ...spaces.filter((s) => s.kind === "personal"),
      ...spaces.filter((s) => s.kind === "club"),
    ];
  });
}

export const registerListSpaces: ToolRegistrar = (server, { connector, grant }) => {
  server.registerTool(
    "list_spaces",
    {
      title: "List spaces",
      description:
        "Lists the Bananasplit spaces this connection can use: the member's Personal space and the organizations they belong to. Each has its id, the member's role, a link, whether the organization allows AI apps, and whether it is paused.",
      inputSchema: z.object({}),
      outputSchema,
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const spaces = await listConnectorSpaces(connector, grant);
        return jsonResult({
          access: grant.access === "WRITE" ? "read_and_change" : "read",
          spaces,
        } satisfies ListSpacesOutput);
      } catch (error) {
        return toolError(error, { tool: "list_spaces" });
      }
    },
  );
};
