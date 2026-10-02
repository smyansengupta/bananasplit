import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useConfirm, type ConfirmOptions } from "./confirm-dialog";

function Harness({ options, onResult }: { options: ConfirmOptions; onResult: (ok: boolean) => void }) {
  const [el, confirm] = useConfirm();
  return (
    <>
      <button type="button" onClick={() => void confirm(options).then(onResult)}>
        Ask
      </button>
      {el}
    </>
  );
}

describe("useConfirm", () => {
  it("runs the action and resolves true; Cancel resolves false and runs nothing", async () => {
    const run = vi.fn(async () => undefined);
    const onResult = vi.fn();
    render(<Harness options={{ title: "Delete it?", run }} onResult={onResult} />);

    fireEvent.click(screen.getByText("Ask"));
    expect(await screen.findByText("Delete it?")).toBeTruthy();
    // Focus starts on Cancel, never on the red button.
    expect(document.activeElement?.textContent).toBe("Cancel");
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
    expect(run).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Ask"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stays open and shows the error when the action fails", async () => {
    const run = vi.fn(async () => "Only the uploader can delete this.");
    const onResult = vi.fn();
    render(<Harness options={{ title: "Delete the file?", confirmLabel: "Delete file", run }} onResult={onResult} />);

    fireEvent.click(screen.getByText("Ask"));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Delete file" }));
    });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Only the uploader can delete this.");
    expect(screen.getByText("Delete the file?")).toBeTruthy();
    expect(onResult).not.toHaveBeenCalled();
  });
});
