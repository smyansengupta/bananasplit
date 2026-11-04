import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { toast, Toaster } from "./toaster";

describe("Ctrl Z", () => {
  it("runs the newest Undo, and leaves typing in a field alone", async () => {
    render(<Toaster />);
    const first = vi.fn();
    const second = vi.fn();
    act(() => {
      toast({ title: "Deleted", action: { label: "Undo", run: first } });
      toast({ title: "Deleted", action: { label: "Undo", run: second } });
    });

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "z", ctrlKey: true });
    expect(second).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
  });
});
