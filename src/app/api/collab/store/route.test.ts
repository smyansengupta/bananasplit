// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);

const { fake, resetFake } = await import("@/test/fake-context");
const { withOrgTxAs } = await import("@/server/db/context");
const { NotFoundError } = await import("@/lib/auth/errors");
const { signBridgeRequest, toBase64, fromBase64 } = await import("@/lib/collab/bridge");
const { applyContentToState, noteStateToContent, seedNoteState } =
  await import("@/lib/collab/note-doc");
const { POST: store } = await import("./route");
const { POST: load } = await import("../load/route");

/**
 * The bridge routes: fail closed, signature only, and the acting user is
 * the one the (verified) collaboration server named, in their own context.
 */

const SECRET = "b".repeat(40);
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function enable() {
  vi.stubEnv("COLLAB_ENABLED", "true");
  vi.stubEnv("COLLAB_SERVER_URL", "ws://localhost:1234");
  vi.stubEnv("COLLAB_SECRET", SECRET);
}

function request(
  operation: "load" | "store",
  payload: unknown,
  { secret = SECRET, headers = {} }: { secret?: string; headers?: Record<string, string> } = {},
) {
  const body = JSON.stringify(payload);
  return new Request(`http://localhost/api/collab/${operation}`, {
    method: "POST",
    body,
    headers: { ...signBridgeRequest(operation, body, secret), ...headers },
  });
}

function live(text: string) {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, seedNoteState(doc("Minutes")));
  const t = (ydoc.getXmlFragment("default").get(0) as Y.XmlElement).get(0) as Y.XmlText;
  t.insert(t.length, text);
  return Y.encodeStateAsUpdate(ydoc);
}

const noteRow = {
  authorId: "author_1",
  visibility: "ORGANIZATION",
  contentJson: doc("Minutes"),
  yjsState: null,
  version: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  resetFake({
    role: "MEMBER",
    db: {
      note: {
        findFirst: vi.fn(async () => noteRow),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    },
  });
});

describe("collaboration bridge routes", () => {
  const storeBody = {
    documentName: "note:org_1:note_1",
    userId: "author_1",
    state: toBase64(live(" edited")),
  };

  it("answer 503 while collaboration is off, whatever the request", async () => {
    expect((await store(request("store", storeBody))).status).toBe(503);
    expect(
      (await load(request("load", { documentName: "note:org_1:note_1", userId: "u" }))).status,
    ).toBe(503);
    expect(withOrgTxAs).not.toHaveBeenCalled();
  });

  it("refuse a request not signed with the shared secret", async () => {
    enable();
    expect((await store(request("store", storeBody, { secret: "x".repeat(40) }))).status).toBe(401);
    // A load's signature does not work for a store.
    const body = JSON.stringify(storeBody);
    const replayed = new Request("http://localhost/api/collab/store", {
      method: "POST",
      body,
      headers: signBridgeRequest("load", body, SECRET),
    });
    expect((await store(replayed)).status).toBe(401);
    expect(withOrgTxAs).not.toHaveBeenCalled();
  });

  it("refuse an oversized body before reading it, a bad state and a non-note document", async () => {
    enable();
    expect(
      (
        await store(
          request("store", storeBody, { headers: { "content-length": String(10 * 1024 * 1024) } }),
        )
      ).status,
    ).toBe(413);
    expect(
      (await store(request("store", { ...storeBody, state: toBase64(new Uint8Array([9, 9, 9])) })))
        .status,
    ).toBe(400);
    expect(
      (await store(request("store", { ...storeBody, documentName: "task:org_1:t1" }))).status,
    ).toBe(404);
  });

  it("act as the named user in the document's org, and save as them", async () => {
    enable();
    const res = await store(request("store", storeBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 2, update: null });
    expect(withOrgTxAs).toHaveBeenCalledWith("author_1", "org_1", expect.any(Function));
    expect(fake.db.note.updateMany.mock.calls[0][0].data).toMatchObject({
      contentText: "Minutes edited",
      updatedById: "author_1",
    });
  });

  it("answer 403 for a user who may not edit, 404 for a non-member", async () => {
    enable();
    expect((await store(request("store", { ...storeBody, userId: "member_1" }))).status).toBe(403);
    vi.mocked(withOrgTxAs).mockRejectedValueOnce(new NotFoundError());
    expect((await store(request("store", storeBody))).status).toBe(404);
    expect(fake.db.note.updateMany).not.toHaveBeenCalled();
  });

  it("hand back what an autosave merged in", async () => {
    enable();
    fake.db.note.findFirst.mockResolvedValue({
      ...noteRow,
      yjsState: applyContentToState(seedNoteState(doc("Minutes")), doc("Minutes (draft)")),
      contentJson: doc("Minutes (draft)"),
    });
    const body = (await (await store(request("store", storeBody))).json()) as { update: string };
    const liveDoc = new Y.Doc();
    Y.applyUpdate(liveDoc, fromBase64(storeBody.state));
    Y.applyUpdate(liveDoc, fromBase64(body.update));
    // Both typed at the end of "Minutes" at once: Yjs keeps both, in client order.
    const text = noteStateToContent(Y.encodeStateAsUpdate(liveDoc)).text;
    expect(text).toMatch(/^Minutes( edited \(draft\)| \(draft\) edited)$/);
  });

  it("load the note's state as the connecting user, 404 when they cannot see it", async () => {
    enable();
    const res = await load(request("load", { documentName: "note:org_1:note_1", userId: "u1" }));
    expect(res.status).toBe(200);
    const { state } = (await res.json()) as { state: string };
    expect(noteStateToContent(fromBase64(state)).text).toBe("Minutes");
    expect(withOrgTxAs).toHaveBeenCalledWith("u1", "org_1", expect.any(Function));

    fake.db.note.findFirst.mockResolvedValue({ ...noteRow, visibility: "PRIVATE" });
    expect(
      (await load(request("load", { documentName: "note:org_1:note_1", userId: "u1" }))).status,
    ).toBe(404);
  });
});
