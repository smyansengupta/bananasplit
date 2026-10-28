import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));
// The refusal classes live in the data layer, which imports the session.
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { ConnectorRefusedError, SpaceRefusedError } from "@/server/db/context";
import { ConflictError } from "@/server/db/errors";

import { GENERIC_MESSAGE, NOT_FOUND_MESSAGE, toolError, toolErrorMessage } from "./errors";

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("toolError", () => {
  it("is always an isError tool result, never a thrown protocol error", () => {
    expect(toolError(new NotFoundError())).toEqual({
      content: [{ type: "text", text: NOT_FOUND_MESSAGE }],
      isError: true,
    });
  });

  it("says the same for a missing id and a space the member isn't in", () => {
    expect(toolErrorMessage(new NotFoundError("Task t_123 not found in org_B"))).toBe(
      NOT_FOUND_MESSAGE,
    );
  });

  it("names the organization for a role that can't do it", () => {
    expect(toolErrorMessage(new ForbiddenError(), { clubName: "Robotics Club" })).toBe(
      "Your role in Robotics Club can't do that.",
    );
    expect(toolErrorMessage(new ForbiddenError())).toBe(
      "Your role in this organization can't do that.",
    );
  });

  it("passes on what a space refusal and a connector refusal say", () => {
    const refused = new SpaceRefusedError({
      ok: false,
      error: "Reports aren't included in this organization's plan.",
      refused: "feature",
    });
    expect(toolErrorMessage(refused)).toBe("Reports aren't included in this organization's plan.");
    expect(toolErrorMessage(new ConnectorRefusedError("switch", "Robotics Club"))).toMatch(
      /^Robotics Club has turned off AI apps\./,
    );
    expect(toolErrorMessage(new ConnectorRefusedError("scope"))).toMatch(
      /connected to one space only/,
    );
    expect(toolErrorMessage(new ConflictError())).toBe("That conflicts with an existing item.");
  });

  it("gives the first input issue with its field and an example, without echoing the input", () => {
    const schema = z.object({ space: z.string().min(5) });
    const result = schema.safeParse({ space: "<script>alert(1)</script>".slice(0, 3) });
    const message = toolErrorMessage(result.error, {
      examples: { space: "an id from list_spaces" },
    });
    expect(message).toMatch(
      /^The "space" argument isn't valid: .+\. For example: an id from list_spaces\.$/,
    );
    expect(message).not.toContain("<sc");
  });

  it("hides anything else behind a generic message and reports it", () => {
    captureException.mockClear();
    const boom = new Error('relation "ConnectorGrant" violates policy app_user_select');
    expect(toolErrorMessage(boom, { tool: "list_spaces" })).toBe(GENERIC_MESSAGE);
    expect(captureException).toHaveBeenCalledWith(boom, {
      tags: { area: "connectors", tool: "list_spaces" },
    });
  });
});
