import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { disconnectAiApps } = vi.hoisted(() => ({ disconnectAiApps: vi.fn() }));
vi.mock("./actions", () => ({ disconnectAiApps }));

import type { ConnectedApp } from "@/server/connectors/connected-apps";

import { ConnectedAppsCard } from "./connected-apps-card";

const MCP_URL = "https://bananasplit.fyi/api/mcp";
const CLAUDE_URL =
  "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Bananasplit&connectorUrl=https%3A%2F%2Fbananasplit.fyi%2Fapi%2Fmcp";

const APPS: ConnectedApp[] = [
  {
    id: "g1",
    name: "Claude Code",
    access: "READ",
    space: { scope: "all" },
    connectedAt: "2026-10-20T12:00:00.000Z",
    lastUsedAt: "2026-10-25T12:00:00.000Z",
  },
  {
    id: "g2",
    name: "An AI app",
    access: "WRITE",
    space: { scope: "club", name: "Robotics Club" },
    connectedAt: "2026-10-21T12:00:00.000Z",
    lastUsedAt: "2026-10-22T12:00:00.000Z",
  },
];

function renderCard(apps = APPS) {
  return render(<ConnectedAppsCard apps={apps} mcpUrl={MCP_URL} claudeUrl={CLAUDE_URL} />);
}

beforeEach(() => {
  disconnectAiApps.mockReset();
  disconnectAiApps.mockResolvedValue({ ok: true });
});

describe("ConnectedAppsCard", () => {
  it("lists each app with its access and space", () => {
    renderCard();
    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first!).getByText("Claude Code")).toBeTruthy();
    expect(
      within(first!).getByText("Read only · Personal and all your organizations"),
    ).toBeTruthy();
    expect(within(second!).getByText("An AI app")).toBeTruthy();
    expect(within(second!).getByText("Read and make changes · Robotics Club only")).toBeTruthy();
  });

  it("disconnects one app after confirming", async () => {
    renderCard();
    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Disconnect Claude Code?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(disconnectAiApps).toHaveBeenCalledWith("g1"));
    expect(await screen.findByText("Claude Code is disconnected.")).toBeTruthy();
  });

  it("disconnects every app at once, and keeps the dialog open with the error when it fails", async () => {
    disconnectAiApps.mockResolvedValueOnce({ ok: false, error: "Couldn't disconnect. Try again." });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect all" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect all" }));
    expect(await within(dialog).findByText("Couldn't disconnect. Try again.")).toBeTruthy();
    expect(disconnectAiApps).toHaveBeenCalledWith(null);
  });

  it("says when nothing is connected, and has no Disconnect all for one app or none", () => {
    renderCard([]);
    expect(screen.getByText("No apps connected yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disconnect all" })).toBeNull();
  });

  it("shows how to connect: the address, the prefilled Claude link and the Claude Code command", () => {
    renderCard([]);
    expect(screen.getByLabelText("Bananasplit's address for AI apps")).toHaveProperty(
      "value",
      MCP_URL,
    );
    expect(screen.getByRole("link", { name: /Add to Claude/ }).getAttribute("href")).toBe(
      CLAUDE_URL,
    );
    expect(screen.getByLabelText("Claude Code command")).toHaveProperty(
      "value",
      `claude mcp add --transport http bananasplit ${MCP_URL}`,
    );
  });
});
