import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutosave } from "./use-autosave";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useAutosave flush", () => {
  it("saves the pending snapshot now and skips the debounced save", async () => {
    const save = vi.fn(async () => ({}));
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 800 }));

    act(() => result.current.schedule("draft"));
    await act(() => result.current.flush());

    expect(save).toHaveBeenCalledExactlyOnceWith("draft");
    expect(result.current.status).toBe("saved");

    await act(async () => vi.advanceTimersByTime(1_000));
    expect(save).toHaveBeenCalledOnce();
  });

  it("resolves at once when nothing is pending", async () => {
    const save = vi.fn(async () => ({}));
    const { result } = renderHook(() => useAutosave<string>({ save }));

    await act(() => result.current.flush());
    expect(save).not.toHaveBeenCalled();
  });

  it("waits for a save in flight and the edit queued behind it", async () => {
    const first = deferred<object>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({});
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 800 }));

    act(() => result.current.schedule("v1"));
    await act(async () => vi.advanceTimersByTime(800));
    expect(save).toHaveBeenCalledWith("v1");

    // An edit lands while v1 is still saving; flush must cover it too.
    act(() => result.current.schedule("v2"));
    let done = false;
    const flushed = result.current.flush().then(() => (done = true));
    await act(async () => {});
    expect(done).toBe(false);

    await act(async () => {
      first.resolve({});
      await flushed;
    });
    expect(save.mock.calls).toEqual([["v1"], ["v2"]]);
    expect(result.current.status).toBe("saved");
  });

  it("stops at a conflict", async () => {
    const save = vi.fn(async () => ({ conflict: true }));
    const { result } = renderHook(() => useAutosave<string>({ save }));

    act(() => result.current.schedule("draft"));
    await act(() => result.current.flush());
    expect(result.current.status).toBe("conflict");
  });
});
