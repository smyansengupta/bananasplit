import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutosave } from "./use-autosave";

/**
 * Nothing typed is lost: the latest edit wins, a failed save is kept and
 * retried, and leaving the editor sends what's waiting right away.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function settle() {
  // Let the awaited save promise and the state updates after it run.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useAutosave", () => {
  it("sends only the latest snapshot after the pause", async () => {
    const save = vi.fn(async () => ({}));
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 800 }));
    act(() => {
      result.current.schedule("a");
      result.current.schedule("ab");
    });
    expect(result.current.status).toBe("pending");
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab");
    expect(result.current.status).toBe("saved");
  });

  it("keeps a failed save and retries it by itself", async () => {
    const save = vi
      .fn<(p: string) => Promise<{ error?: string }>>()
      .mockResolvedValueOnce({ error: "offline" })
      .mockResolvedValue({});
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 100 }));
    act(() => result.current.schedule("draft"));
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await settle();
    expect(result.current.status).toBe("error");

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("draft");
    expect(result.current.status).toBe("saved");
  });

  it("a newer edit replaces a failed one instead of resending the old text", async () => {
    const save = vi
      .fn<(p: string) => Promise<{ error?: string }>>()
      .mockResolvedValueOnce({ error: "offline" })
      .mockResolvedValue({});
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 100 }));
    act(() => result.current.schedule("old"));
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await settle();
    act(() => result.current.schedule("new"));
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await settle();
    expect(save).toHaveBeenLastCalledWith("new");
  });

  it("sends what's waiting at once when the editor closes", async () => {
    const save = vi.fn(async () => ({}));
    const { result, unmount } = renderHook(() => useAutosave<string>({ save, delay: 5_000 }));
    act(() => result.current.schedule("last words"));
    unmount();
    await settle();
    expect(save).toHaveBeenCalledWith("last words");
  });

  it("stops after a conflict", async () => {
    const save = vi.fn(async () => ({ conflict: true }));
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 100 }));
    act(() => result.current.schedule("mine"));
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await settle();
    expect(result.current.status).toBe("conflict");
    act(() => result.current.schedule("more"));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
