// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyBridgeRequest } from "@/lib/collab/bridge";

vi.mock("@/server/db/context", () => ({ assertNoTx: vi.fn() }));

const { revokeNoteSessions } = await import("./revoke");

/** The app's call into the collaboration server when a note leaves someone's view. */

const SECRET = "r".repeat(40);
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function enable() {
  vi.stubEnv("COLLAB_ENABLED", "true");
  vi.stubEnv("COLLAB_SERVER_URL", "wss://collab.example.org/ws");
  vi.stubEnv("COLLAB_SECRET", SECRET);
}

describe("revokeNoteSessions", () => {
  it("does nothing while collaboration is off", async () => {
    await revokeNoteSessions("org_1", "note_1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a signed revoke for the note's document, with the app's time", async () => {
    enable();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const before = Date.now();

    await revokeNoteSessions("org_1", "note_1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://collab.example.org/ws/revoke");
    const body = JSON.parse(init.body);
    expect(body.documentName).toBe("note:org_1:note_1");
    expect(body.notBefore).toBeGreaterThanOrEqual(before);
    const headers = init.headers as Record<string, string>;
    expect(verifyBridgeRequest("revoke", init.body, (n) => headers[n], SECRET)).toBe(true);
  });

  it("never throws: a down or refusing server is only logged", async () => {
    enable();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(revokeNoteSessions("org_1", "note_1")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(revokeNoteSessions("org_1", "note_1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
