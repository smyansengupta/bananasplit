import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateTag, revalidateTag, currentTx } = vi.hoisted(() => ({
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  currentTx: vi.fn(),
}));
vi.mock("next/cache", () => ({ updateTag, revalidateTag }));
vi.mock("@/server/db/context", () => ({ currentTx }));

import { invalidate, runAsBackgroundWork } from "./invalidate";
import { tags } from "./tags";

const T = tags.publicEvents("org1");

beforeEach(() => {
  vi.clearAllMocks();
  currentTx.mockReturnValue(undefined);
});

describe("invalidate", () => {
  it("rejects tags that were not built by tags.ts", () => {
    expect(() => invalidate(["public-events:org1"])).toThrow(/tags\.ts/);
  });

  it("runs at once outside a transaction, preferring updateTag", () => {
    invalidate([T]);
    expect(updateTag).toHaveBeenCalledWith(T);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("falls back to revalidateTag(tag, {expire: 0}) outside a Server Action", () => {
    updateTag.mockImplementationOnce(() => {
      throw new Error("updateTag can only be called from within a Server Action.");
    });
    invalidate([T]);
    expect(revalidateTag).toHaveBeenCalledWith(T, { expire: 0 });
  });

  it("never calls updateTag from background work (jobs)", () => {
    runAsBackgroundWork(() => invalidate([T]));
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidateTag).toHaveBeenCalledWith(T, { expire: 0 });
  });

  it("queues on the transaction and fires only when the queue is flushed (after commit)", () => {
    const queue: Array<() => void> = [];
    currentTx.mockReturnValue({ afterCommit: (fn: () => void) => queue.push(fn) });
    invalidate([T, T]);
    expect(updateTag).not.toHaveBeenCalled();
    // A rolled-back transaction drops its queue: nothing is invalidated.
    expect(queue).toHaveLength(1);
    queue[0]!();
    expect(updateTag).toHaveBeenCalledTimes(1);
  });

  it("keeps the background mode it was queued with", () => {
    const queue: Array<() => void> = [];
    currentTx.mockReturnValue({ afterCommit: (fn: () => void) => queue.push(fn) });
    runAsBackgroundWork(() => invalidate([T]));
    queue[0]!();
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  it("is a quiet no-op outside any Next.js request (scripts)", () => {
    updateTag.mockImplementationOnce(() => {
      throw new Error("Invariant: static generation store missing in updateTag x");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => invalidate([T])).not.toThrow();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
