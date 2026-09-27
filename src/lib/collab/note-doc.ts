import { getSchema, getText, getTextSerializersFromSchema, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import {
  prosemirrorToYXmlFragment,
  updateYFragment,
  yXmlFragmentToProseMirrorRootNode,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { noteSchemaExtensions } from "@/lib/notes/schema-extensions";

import { NOTE_FIELD } from "./protocol";

/**
 * A note body as a Yjs document, and back (docs/features/collaboration.md).
 *
 * The body lives in the XmlFragment the Collaboration extension binds
 * ("default"). contentJson is that fragment as ProseMirror JSON and
 * contentText is what editor.getText() returns for it, so a live save
 * writes exactly what an autosave of the same document would, and search
 * (the searchVector generated column over title and contentText) keeps
 * working unchanged.
 *
 * Seeding. A note that was never saved live has no Yjs state, so its
 * document is built from contentJson, with a client id derived from that
 * content. Two seeds of the same content are byte-identical: when the
 * collaboration server restarts (or a second instance opens the note) and
 * seeds again, it produces the SAME Yjs items the connected editors already
 * hold, and merging them changes nothing. A random client id would make
 * every editor that reconnects duplicate the whole note.
 *
 * Lineage. Once a note has a Yjs state, every write keeps building on it:
 * live saves merge into it (reconcileNoteState) and autosaves apply their
 * change to it as an edit (applyContentToState). Nothing ever re-seeds a
 * note that has a state, which is what keeps merges from duplicating text.
 */

export class InvalidNoteContentError extends Error {
  constructor(cause?: unknown) {
    super("The note content does not fit the note schema");
    this.name = "InvalidNoteContentError";
    this.cause = cause;
  }
}

export interface NoteContent {
  json: JSONContent;
  text: string;
}

let cachedSchema: Schema | null = null;

export function noteSchema(): Schema {
  return (cachedSchema ??= getSchema(noteSchemaExtensions()));
}

/** contentJson as a checked document node; throws InvalidNoteContentError. */
function toNode(contentJson: unknown): ProseMirrorNode {
  try {
    const node = noteSchema().nodeFromJSON(contentJson);
    node.check();
    return node;
  } catch (error) {
    throw new InvalidNoteContentError(error);
  }
}

function emptyNode(): ProseMirrorNode {
  return noteSchema().topNodeType.createAndFill() as ProseMirrorNode;
}

/** JSON with sorted keys: the same value always prints the same, whatever the key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Whether two contentJson values are the same document (key order aside). */
export function sameContent(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** The Yjs client id of the seed of `contentJson` (32-bit FNV-1a of its canonical JSON). */
export function seedClientId(contentJson: unknown): number {
  const text = canonicalJson(contentJson);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The deterministic Yjs state of a note that was never saved live. Content
 * that does not fit the schema (legacy rows) seeds an empty document.
 */
export function seedNoteState(contentJson: unknown): Uint8Array {
  let node: ProseMirrorNode;
  try {
    node = toNode(contentJson);
  } catch {
    node = emptyNode();
  }
  const doc = new Y.Doc();
  doc.clientID = seedClientId(contentJson);
  doc.transact(() => prosemirrorToYXmlFragment(node, doc.getXmlFragment(NOTE_FIELD)));
  return Y.encodeStateAsUpdate(doc);
}

function docFrom(...updates: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const update of updates) Y.applyUpdate(doc, update);
  return doc;
}

/** contentJson and contentText of a Yjs state; throws InvalidNoteContentError. */
export function noteStateToContent(state: Uint8Array): NoteContent {
  const schema = noteSchema();
  let node: ProseMirrorNode;
  try {
    node = yXmlFragmentToProseMirrorRootNode(docFrom(state).getXmlFragment(NOTE_FIELD), schema);
    // An editor always holds at least one paragraph; so does contentJson.
    if (node.childCount === 0) node = emptyNode();
    node.check();
  } catch (error) {
    throw new InvalidNoteContentError(error);
  }
  return {
    json: node.toJSON() as JSONContent,
    text: getText(node, {
      blockSeparator: "\n\n",
      textSerializers: getTextSerializersFromSchema(schema),
    }),
  };
}

/**
 * `state` edited to hold `contentJson`: the smallest set of Yjs changes that
 * turns one into the other, made by a fresh client. This is how an autosave
 * lands in a note that has a Yjs state, so live editors merge it in rather
 * than lose it. Throws InvalidNoteContentError for content off the schema.
 */
export function applyContentToState(state: Uint8Array, contentJson: unknown): Uint8Array {
  const node = toNode(contentJson);
  const doc = docFrom(state);
  doc.transact(() =>
    updateYFragment(doc, doc.getXmlFragment(NOTE_FIELD), node, {
      mapping: new Map(),
      isOMark: new Map(),
    }),
  );
  return Y.encodeStateAsUpdate(doc);
}

/** What the row holds now, as far as reconciling a live save is concerned. */
export interface StoredNoteState {
  yjsState: Uint8Array | null;
  contentJson: unknown;
}

export interface ReconciledState {
  /** The state to write: the live document plus anything only the row had. */
  state: Uint8Array;
  /** What the live document is missing from `state`, or null when nothing. */
  missing: Uint8Array | null;
}

/**
 * The state to save when the collaboration server sends `incoming`, given
 * the row as it is now.
 *
 * - The row has a Yjs state: merge. The live document grew from it, so
 *   anything the row has on top (an autosave that landed while the note was
 *   open live) is ordinary concurrent Yjs history, and the merge keeps both.
 * - No state yet, and the live document grew from the seed of the row's
 *   content (the normal first live save): the live document is the state.
 * - No state yet, and the row's content changed after the live document was
 *   seeded (it was autosaved with collaboration off): merging two different
 *   seeds would duplicate the note, so the row's content is applied to the
 *   live document as an edit instead, and the row wins for that stretch.
 */
export function reconcileNoteState(incoming: Uint8Array, stored: StoredNoteState): ReconciledState {
  let state: Uint8Array;
  if (stored.yjsState) {
    state = Y.encodeStateAsUpdate(docFrom(stored.yjsState, incoming));
  } else if (
    Y.decodeStateVector(Y.encodeStateVectorFromUpdate(incoming)).has(
      seedClientId(stored.contentJson),
    )
  ) {
    state = incoming;
  } else {
    try {
      state = applyContentToState(incoming, stored.contentJson);
    } catch {
      // Nothing usable to keep from the row.
      state = incoming;
    }
  }
  const live = docFrom(incoming);
  const missing = Y.snapshotContainsUpdate(Y.snapshot(live), state)
    ? null
    : Y.diffUpdate(state, Y.encodeStateVector(live));
  return { state, missing };
}
