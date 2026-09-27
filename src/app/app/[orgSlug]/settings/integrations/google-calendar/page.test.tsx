import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IntegrationDto } from "@/server/integrations/catalog";
import type { GoogleSyncStatus } from "@/server/google-calendar/requests";

/**
 * Settings > Integrations > Google Calendar shows the calendar's own import
 * card (SyncPanel, "import" only) while the connection is usable, with the
 * same status data as Calendar > Sync, and nothing of the rest of the Sync
 * page. The request behind its buttons is tested in
 * src/server/google-calendar/sync.test.ts.
 */

const { loadIntegrationPageMock, getGoogleSyncStatusMock, withOrgTxMock } = vi.hoisted(() => ({
  loadIntegrationPageMock: vi.fn(),
  getGoogleSyncStatusMock: vi.fn(),
  withOrgTxMock: vi.fn(),
}));

vi.mock("../load", () => ({ loadIntegrationPage: loadIntegrationPageMock }));
vi.mock("@/server/db/context", () => ({ withOrgTx: withOrgTxMock }));
vi.mock("@/server/google-calendar/requests", () => ({
  getGoogleSyncStatus: getGoogleSyncStatusMock,
}));
vi.mock("@/server/integrations/google-connect", () => ({ GOOGLE_CALLBACK_MESSAGES: {} }));
vi.mock("@/server/integrations/google", () => ({ isGoogleConfigured: () => true }));
vi.mock("../actions", () => ({}));
vi.mock("@/app/app/[orgSlug]/calendar/sync/actions", () => ({
  importGoogleEvents: vi.fn(),
  syncGoogleNow: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { default: GoogleCalendarIntegrationPage } = await import("./page");
const { SyncPanel } = await import("@/components/calendar/sync-panel");

const org = { id: "org_cbc", name: "Claude Builders Club", slug: "cbc", timezone: "UTC" };
const ctx = { db: {}, organizationId: org.id, userId: "u_admin", role: "ADMIN" };

function dto(status: IntegrationDto["status"]): IntegrationDto {
  return {
    provider: "GOOGLE_CALENDAR",
    status,
    last4: "abcd",
    hasSecret: status !== "NOT_SET_UP",
    lastVerifiedAt: null,
    lastError: null,
    config: {},
    connectedByName: "Admin",
    updatedAt: null,
  };
}

const syncStatus: GoogleSyncStatus = {
  google: {
    status: "CONNECTED",
    lastError: null,
    publicCalendarId: "club@group.calendar.google.com",
    internalCalendarId: null,
    lastSyncRequestAt: null,
    import: {
      mode: "dry-run",
      status: "done",
      ranAt: "2026-09-20T12:00:00.000Z",
      linked: 3,
      created: 2,
      ambiguous: 1,
    },
  },
  counts: { NOT_APPLICABLE: 0, PENDING: 0, SYNCED: 3, FAILED: 0 },
  failures: [],
  buildHook: null,
  publicEventsEnabled: false,
};

async function render(status: IntegrationDto["status"]) {
  loadIntegrationPageMock.mockResolvedValue({
    organization: org,
    role: "ADMIN",
    dto: dto(status),
    canWrite: true,
    canRemove: false,
  });
  const page = await GoogleCalendarIntegrationPage({
    params: Promise.resolve({ orgSlug: "cbc" }),
    searchParams: Promise.resolve({}),
  } as unknown as PageProps<"/app/[orgSlug]/settings/integrations/google-calendar">);
  return renderToStaticMarkup(page);
}

beforeEach(() => {
  vi.clearAllMocks();
  withOrgTxMock.mockImplementation(async (_orgId: string, fn: (c: typeof ctx) => unknown) =>
    fn(ctx),
  );
  getGoogleSyncStatusMock.mockResolvedValue(syncStatus);
});

describe("Settings > Integrations > Google Calendar", () => {
  it("shows the calendar's import card with the dry run's results while connected", async () => {
    const html = await render("CONNECTED");
    expect(withOrgTxMock).toHaveBeenCalledWith(org.id, expect.any(Function));
    expect(getGoogleSyncStatusMock).toHaveBeenCalledWith(ctx);
    expect(html).toContain("Import existing Google events");
    expect(html).toContain("3 linked, 2 new, 1 ambiguous");
    expect(html).toContain("Dry run");
    expect(html).toContain("Apply import");
    // Only the import card: the rest of the Sync page stays on Calendar > Sync.
    expect(html).not.toContain("Website events feed");
    expect(html).not.toContain("Google Calendar mirror");
    expect(html).not.toContain("Website rebuild hook");
  });

  it("shows no import card, and reads no sync status, until Google is usable", async () => {
    for (const status of ["NOT_SET_UP", "DISCONNECTED", "NEEDS_REAUTH"] as const) {
      const html = await render(status);
      expect(html).not.toContain("Import existing Google events");
    }
    expect(getGoogleSyncStatusMock).not.toHaveBeenCalled();
  });
});

describe("SyncPanel", () => {
  it("shows every card by default (Calendar > Sync)", () => {
    const html = renderToStaticMarkup(
      <SyncPanel
        orgId={org.id}
        orgSlug="cbc"
        canWrite
        status={syncStatus}
        feed={{
          json: "https://x/api/public/cbc/events",
          ics: "https://x/api/public/cbc/events.ics",
        }}
      />,
    );
    for (const title of [
      "Website events feed",
      "Google Calendar mirror",
      "Import existing Google events",
      "Website rebuild hook",
    ]) {
      expect(html).toContain(title);
    }
  });
});
