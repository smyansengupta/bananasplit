import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";

/**
 * Wraps a Server Action so every call is authorized before the handler runs.
 * The wrapped action always takes organizationId as its first argument;
 * withOrgContext resolves it, verifies membership, and injects the context.
 *
 * export const createTask = withOrgContext(async (ctx, input: CreateTaskInput) => { ... });
 * // called from a component as createTask(organizationId, input)
 */
export function withOrgContext<Args extends unknown[], Result>(
  handler: (ctx: OrgContext, ...args: Args) => Promise<Result>,
): (organizationId: string, ...args: Args) => Promise<Result> {
  return async (organizationId, ...args) => {
    const ctx = await requireOrgMembership(organizationId);
    return handler(ctx, ...args);
  };
}
