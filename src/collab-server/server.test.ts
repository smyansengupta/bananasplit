// @vitest-environment node
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Server } from "@hocuspocus/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { signBridgeRequest } from "@/lib/collab/bridge";
import { seedNoteState } from "@/lib/collab/note-doc";
import { NOTE_FIELD, STORED_MESSAGE } from "@/lib/collab/protocol";
import {
  COLLAB_TOKEN_TTL_SECONDS,
  signCollabToken,
  type CollabPermission,
} from "@/lib/collab/token";

import { BridgeError, type BridgeClient } from "./bridge-client";
import { createCollabExtension, type ConnectionContext } from "./extension";
import { createCollabServer } from "./server";

/**
 * The collaboration server end to end, in process: the real Hocuspocus
 * server with the cbc-collab extension on a free port, real providers over
 * WebSockets, and a stub bridge in place of the app. What must hold: no
 * token no entry, read tokens cannot write, presence cannot be spoofed,
 * saves happen as the last writer, and connections live no longer than
 * their tokens.
 */

const SECRET = "k".repeat(40);
const DOC = "note:org_1:note_1";

interface StoreCall {
  documentName: string;
  userId: string;
  state: Uint8Array;
}

function stubBridge() {
  const stores: StoreCall[] = [];
  const denied = new Set<string>();
  const bridge: BridgeClient = {
    async load(documentName, userId) {
      if (denied.has(userId)) throw new BridgeError("load", 404);
      return seedNoteState({ type: "doc", content: [{ type: "paragraph" }] });
    },
    async store(documentName, userId, state) {
      stores.push({ documentName, userId, state });
      return { version: stores.length + 1, update: null };
    },
  };
  return { bridge, stores, denied };
}

function token(
  userId: string,
  perm: CollabPermission = "write",
  { doc = DOC, secret = SECRET, now = Date.now() } = {},
) {
  return signCollabToken(
    { sub: userId, org: "org_1", doc, perm, name: `Name of ${userId}`, slot: 2 },
    secret,
    now,
  ).token;
}

async function until(check: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const providers: HocuspocusProvider[] = [];

function connect(url: string, tokenSource: string | (() => Promise<string>), name = DOC) {
  const seen = { synced: false, failed: null as string | null, closed: 0, stored: 0, scope: "" };
  const provider = new HocuspocusProvider({
    url,
    name,
    token: tokenSource,
    onSynced: () => (seen.synced = true),
    onAuthenticated: ({ scope }) => (seen.scope = scope),
    onAuthenticationFailed: ({ reason }) => (seen.failed = reason),
    onClose: () => (seen.closed += 1),
    onStateless: ({ payload }) => {
      if (payload === STORED_MESSAGE) seen.stored += 1;
    },
  });
  providers.push(provider);
  return { provider, doc: provider.document, seen };
}

/** Types into the first paragraph (creating it if needed). */
function type(doc: Y.Doc, text: string) {
  const fragment = doc.getXmlFragment(NOTE_FIELD);
  doc.transact(() => {
    let paragraph = fragment.get(0) as Y.XmlElement | undefined;
    if (!paragraph) {
      paragraph = new Y.XmlElement("paragraph");
      fragment.insert(0, [paragraph]);
    }
    let ytext = paragraph.get(0) as Y.XmlText | undefined;
    if (!ytext) {
      ytext = new Y.XmlText();
      paragraph.insert(0, [ytext]);
    }
    ytext.insert(ytext.length, text);
  });
}

const textOf = (doc: Y.Doc) => doc.getXmlFragment(NOTE_FIELD).toString();

afterEach(() => {
  while (providers.length) providers.pop()?.destroy();
});

describe("collaboration server", () => {
  const stub = stubBridge();
  let server: Server<ConnectionContext>;
  let url: string;

  beforeAll(async () => {
    server = createCollabServer(
      { secret: SECRET, appUrl: "http://app.invalid", port: 0 },
      stub.bridge,
      {
        debounce: 50,
        maxDebounce: 200,
        stopOnSignals: false,
      },
    );
    await server.listen();
    url = `ws://127.0.0.1:${server.address.port}`;
  });
  afterAll(() => server.destroy());

  it("refuses a bad token, another note's token and a token signed with another secret", async () => {
    const forged = connect(url, "not-a-token");
    const otherNote = connect(url, token("u1", "write", { doc: "note:org_1:other" }));
    const otherSecret = connect(url, token("u1", "write", { secret: "z".repeat(40) }));
    await until(() => [forged, otherNote, otherSecret].every((c) => c.seen.failed !== null));
    expect([forged, otherNote, otherSecret].every((c) => !c.seen.synced)).toBe(true);
  });

  it("refuses the connection when the app will not load the note for the user", async () => {
    stub.denied.add("outsider");
    const outsider = connect(url, token("outsider"));
    await until(() => outsider.seen.failed !== null);
    expect(outsider.seen.synced).toBe(false);
  });

  it("syncs writers live, saves as the last writer and tells every editor", async () => {
    const a = connect(url, token("writer_a"));
    const b = connect(url, token("writer_b"));
    await until(() => a.seen.synced && b.seen.synced);
    expect(a.seen.scope).toBe("read-write");

    type(a.doc, "Hello");
    await until(() => textOf(b.doc).includes("Hello"));
    type(b.doc, " world");
    await until(() => textOf(a.doc).includes("Hello world"));

    await until(() => stub.stores.some((s) => s.userId === "writer_b"));
    const last = stub.stores.at(-1)!;
    expect(last.documentName).toBe(DOC);
    const saved = new Y.Doc();
    Y.applyUpdate(saved, last.state);
    expect(textOf(saved)).toContain("Hello world");
    await until(() => a.seen.stored > 0 && b.seen.stored > 0);
  });

  it("drops every edit from a read-only connection", async () => {
    const writer = connect(url, token("writer_c"));
    const reader = connect(url, token("reader", "read"));
    await until(() => writer.seen.synced && reader.seen.synced);
    expect(reader.seen.scope).toBe("readonly");
    const storesBefore = stub.stores.length;

    type(reader.doc, "vandalism");
    type(writer.doc, "legit");
    await until(() => textOf(reader.doc).includes("legit"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(textOf(writer.doc)).not.toContain("vandalism");
    expect(stub.stores.slice(storesBefore).every((s) => s.userId !== "reader")).toBe(true);
  });

  it("stamps presence from the token, whatever the client claims", async () => {
    const a = connect(url, token("writer_d"));
    const b = connect(url, token("member_e", "read"));
    await until(() => a.seen.synced && b.seen.synced);

    b.provider.setAwarenessField("user", { id: "owner_1", name: "The Owner", slot: 1 });
    await until(() =>
      [...a.provider.awareness!.getStates().values()].some((s) => s.user?.id === "member_e"),
    );
    const claimed = [...a.provider.awareness!.getStates().values()].map((s) => s.user?.name);
    expect(claimed).toContain("Name of member_e");
    expect(claimed).not.toContain("The Owner");
  });

  it("on a signed revoke, closes the document's connections and refuses older tokens", async () => {
    const doc = "note:org_1:note_revoked";
    const minted = Date.now() - 2000;
    const a = connect(url, token("writer_f", "write", { doc, now: minted }), doc);
    await until(() => a.seen.synced);
    const httpUrl = url.replace("ws", "http");
    const body = JSON.stringify({ documentName: doc, notBefore: Date.now() });

    const unsigned = await fetch(`${httpUrl}/revoke`, { method: "POST", body });
    expect(unsigned.status).toBe(401);
    const forged = await fetch(`${httpUrl}/revoke`, {
      method: "POST",
      body,
      headers: signBridgeRequest("revoke", body, "z".repeat(40)),
    });
    expect(forged.status).toBe(401);
    expect(a.seen.closed).toBe(0);

    const signed = await fetch(`${httpUrl}/revoke`, {
      method: "POST",
      body,
      headers: signBridgeRequest("revoke", body, SECRET),
    });
    expect(signed.status).toBe(204);
    await until(() => a.seen.closed > 0);

    // Coming back with the same, still unexpired, token does not work...
    const replay = connect(url, token("writer_f", "write", { doc, now: minted }), doc);
    await until(() => replay.seen.failed !== null);
    // ...a token minted after the revoke (the app still lets them in) does.
    const fresh = connect(url, token("writer_f", "write", { doc, now: Date.now() + 1000 }), doc);
    await until(() => fresh.seen.synced);
  });
});

describe("connection lifetime", () => {
  const stub = stubBridge();
  const servers: Server<ConnectionContext>[] = [];

  /** A server whose clock runs `leftMs` before every token's expiry. */
  async function serverWithTokensLeft(leftMs: number) {
    const shift = COLLAB_TOKEN_TTL_SECONDS * 1000 - leftMs;
    const server = createCollabServer(
      { secret: SECRET, appUrl: "http://app.invalid", port: 0 },
      stub.bridge,
      {
        stopOnSignals: false,
        extensions: [
          createCollabExtension({
            secret: SECRET,
            bridge: stub.bridge,
            now: () => Date.now() + shift,
          }),
        ],
      },
    );
    servers.push(server);
    await server.listen();
    return `ws://127.0.0.1:${server.address.port}`;
  }

  afterAll(async () => {
    await Promise.all(servers.map((s) => s.destroy()));
  });

  it("asks for a fresh token before the current one expires, and keeps a valid one", async () => {
    const url = await serverWithTokensLeft(61_000); // refresh due in about a second
    let issued = 0;
    const c = connect(url, async () => {
      issued += 1;
      return token("writer_g");
    });
    await until(() => c.seen.synced);
    await until(() => issued >= 2, 5000);
    expect(c.seen.failed).toBeNull();
    expect(c.seen.closed).toBe(0);
  });

  it("closes the connection when its token expires without a valid refresh", async () => {
    const url = await serverWithTokensLeft(1_500);
    let issued = 0;
    const c = connect(url, async () => {
      issued += 1;
      if (issued > 1) throw new Error("Note not found.");
      return token("writer_h");
    });
    await until(() => c.seen.synced);
    await until(() => c.seen.closed > 0, 5000);
    expect(issued).toBeGreaterThanOrEqual(2);
  });
});
