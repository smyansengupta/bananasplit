import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", () => ({ withUserTx: vi.fn() }));

import { connectedAppName } from "./connected-apps";

describe("connectedAppName", () => {
  it("uses WorkOS's name for the app when it has one", () => {
    expect(
      connectedAppName(" Claude ", "https://claude.ai/oauth/claude-code-client-metadata"),
    ).toBe("Claude");
  });

  it("falls back to the host of a client metadata URL, then to a generic name", () => {
    expect(connectedAppName(null, "https://www.cursor.com/oauth/metadata.json")).toBe("cursor.com");
    expect(connectedAppName(null, "client_01JABCDEF")).toBe("An AI app");
    expect(connectedAppName("", "http://evil.example/metadata")).toBe("An AI app");
  });
});
