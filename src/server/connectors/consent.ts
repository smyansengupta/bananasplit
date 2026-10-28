import "server-only";

import { withUserTx } from "@/server/db/context";

import { ACCESS_CLAIM, ALL_SPACES, READ_ACCESS, SPACE_CLAIM, WRITE_ACCESS } from "./token";
import type { ConsentOption } from "./workos";

/**
 * The two questions AuthKit asks when a member connects an app
 * (user_consent_options on /connect's complete call). The answers land in
 * the token as SPACE_CLAIM and ACCESS_CLAIM, and grant resolution stores
 * them (src/server/connectors/grant.ts).
 *
 *   Which spaces it can use   Personal and all my clubs; or one space:
 *                             Personal, or a club with AI connectors on
 *   What it can do            Read only (first, the default), or Read and
 *                             make changes
 */

/** A space the member can offer an app. */
export interface ConsentSpace {
  id: string;
  name: string;
  kind: "personal" | "club";
}

const LABEL_MAX = 80;

/** The member's Personal space and the clubs that allow AI apps, clubs by name. */
export async function consentSpaces(userId: string): Promise<ConsentSpace[]> {
  return withUserTx(userId, async ({ db }) => {
    const switches = await db.$queryRaw<{ organizationId: string; connectorsEnabled: boolean }[]>`
      SELECT "organizationId", "connectorsEnabled" FROM app.connector_spaces()`;
    const on = new Set(switches.filter((s) => s.connectorsEnabled).map((s) => s.organizationId));
    const memberships = await db.membership.findMany({
      where: { userId, organization: { deletedAt: null } },
      select: { organization: { select: { id: true, name: true, kind: true } } },
      orderBy: { organization: { name: "asc" } },
    });
    return memberships
      .map((m) => m.organization)
      .filter((org) => org.kind === "PERSONAL" || on.has(org.id))
      .map((org) => ({
        id: org.id,
        name: org.name,
        kind: org.kind === "PERSONAL" ? ("personal" as const) : ("club" as const),
      }));
  });
}

export function consentOptions(spaces: readonly ConsentSpace[]): ConsentOption[] {
  const all = { value: ALL_SPACES, label: "Personal and all my organizations" };
  const personal = spaces
    .filter((s) => s.kind === "personal")
    .map((s) => ({ value: s.id, label: "Personal only" }));
  const clubs = spaces
    .filter((s) => s.kind === "club")
    .map((s) => ({ value: s.id, label: `${s.name.slice(0, LABEL_MAX)} only` }));
  return [
    {
      claim: SPACE_CLAIM,
      type: "enum",
      label: "Which spaces it can use",
      choices:
        clubs.length === 0
          ? [all, ...personal]
          : [
              { group: "All spaces", choices: [all] },
              ...(personal.length > 0 ? [{ group: "Personal", choices: personal }] : []),
              { group: "Clubs", choices: clubs },
            ],
    },
    {
      claim: ACCESS_CLAIM,
      type: "enum",
      label: "What it can do",
      choices: [
        { value: READ_ACCESS, label: "Read only" },
        { value: WRITE_ACCESS, label: "Read and make changes" },
      ],
    },
  ];
}
