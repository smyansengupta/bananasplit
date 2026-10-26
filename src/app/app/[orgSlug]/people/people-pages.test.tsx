import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Privacy of the people pages, at the page level: a viewer who is not a
 * member of the org gets 404 from both pages (getOrgContextBySlug), and a
 * person who is not a current member of THIS org gets 404 from the person
 * page (getPersonSheet returns null), with nothing rendered. Emails show
 * only when the data carries one (the server decides). The database side
 * (RLS, the Membership join, search isolation) is in
 * src/server/profiles/directory.db.test.ts and profiles.db.test.ts.
 */

const { getOrgContextBySlugMock, getPersonSheetMock, loadDirectoryMock } = vi.hoisted(() => ({
  getOrgContextBySlugMock: vi.fn(),
  getPersonSheetMock: vi.fn(),
  loadDirectoryMock: vi.fn(),
}));

vi.mock("@/server/db/context", () => ({ getOrgContextBySlug: getOrgContextBySlugMock }));
vi.mock("@/components/pins/pins-context", () => ({ PinToggle: () => null }));
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...actual, usePathname: () => "/app/cbc/people" };
});
vi.mock("@/app/app/[orgSlug]/people/actions", () => ({
  searchPeopleAction: vi.fn(),
  loadPersonSheetAction: vi.fn(),
}));
vi.mock("@/server/profiles/directory", () => ({
  getPersonSheet: getPersonSheetMock,
  loadDirectory: loadDirectoryMock,
}));

const { notFound } = await import("next/navigation");
const { default: PersonPage } = await import("./[userId]/page");
const { default: PeoplePage } = await import("./page");

function isNotFound(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === "string" && digest.includes("404");
}

const viewer = { id: "u_viewer", email: "viewer@example.edu", name: "Viewer" };
const org = {
  id: "org_cbc",
  name: "Claude Builders Club",
  slug: "cbc",
  timezone: "America/New_York",
  plan: "SOCIETY",
};

const personParams = (userId: string) =>
  ({
    params: Promise.resolve({ orgSlug: "cbc", userId }),
  }) as unknown as PageProps<"/app/[orgSlug]/people/[userId]">;
const peopleParams = {
  params: Promise.resolve({ orgSlug: "cbc" }),
  searchParams: Promise.resolve({}),
} as unknown as PageProps<"/app/[orgSlug]/people">;

function sheet() {
  return {
    id: "u_oliver",
    name: "Oliver Ward",
    image: null,
    avatar: null,
    pronouns: "he/him",
    major: "Business Administration",
    gradYear: 2027,
    bio: "Runs the exec sync.",
    links: [{ kind: "github", url: "https://github.com/oliver" }],
    role: "ADMIN",
    title: "VP Ops & Programs",
    joinedAt: "2026-01-15T12:00:00.000Z",
    email: null,
    busy: ["0-9", "0-10"],
    availabilityShared: true,
    freeNow: false,
    timezone: "America/New_York",
    team: { key: "p_ops", name: "Ops & Programs", slot: 2 },
    positions: [{ key: "vp-ops", title: "VP Ops & Programs", isAdvisor: false }],
    reportsTo: [{ key: "president", title: "President", person: "Jackson Lamoureux", userId: "u_jackson" }],
    leads: [{ key: "head-of-tech", title: "Head of Tech", person: "Smyan Sengupta", userId: "u_smyan" }],
    tasks: [{ id: "t1", title: "Exec sync agenda", dueKey: "2026-10-20" }],
    taskCount: 1,
    todayKey: "2026-10-19",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrgContextBySlugMock.mockResolvedValue({ user: viewer, organization: org, role: "MEMBER", settings: null });
});

describe("people pages privacy", () => {
  it("a non-member viewer gets 404 from the person page, and no profile is read", async () => {
    getOrgContextBySlugMock.mockImplementation(async () => notFound());
    const error = await PersonPage(personParams("u_member")).catch((e: unknown) => e);
    expect(isNotFound(error)).toBe(true);
    expect(getPersonSheetMock).not.toHaveBeenCalled();
  });

  it("a non-member viewer gets 404 from the directory, and no member is listed", async () => {
    getOrgContextBySlugMock.mockImplementation(async () => notFound());
    const error = await PeoplePage(peopleParams).catch((e: unknown) => e);
    expect(isNotFound(error)).toBe(true);
    expect(loadDirectoryMock).not.toHaveBeenCalled();
  });

  it("a person who is not a member of this org gets 404 (another org's user, a former member, a bad id)", async () => {
    getPersonSheetMock.mockResolvedValue(null);
    for (const id of ["u_other_org", "u_former", "not-a-user"]) {
      const error = await PersonPage(personParams(id)).catch((e: unknown) => e);
      expect(isNotFound(error), id).toBe(true);
      expect(getPersonSheetMock).toHaveBeenLastCalledWith(
        "org_cbc",
        id,
        { id: "u_viewer", role: "MEMBER", membersSeeEmails: false },
        "America/New_York",
      );
    }
  });

  it("shows a member's profile with this org's title, chart lines and actions, and no email", async () => {
    getPersonSheetMock.mockResolvedValue(sheet());
    const html = renderToStaticMarkup(await PersonPage(personParams("u_oliver")));
    expect(html).toContain("Oliver Ward");
    expect(html).toContain("he/him · VP Ops &amp; Programs");
    expect(html).toContain("Business Administration · Class of 2027");
    expect(html).toContain("Runs the exec sync.");
    expect(html).toContain("Jackson Lamoureux, President");
    expect(html).toContain("Ops &amp; Programs");
    expect(html).toContain("Tomorrow");
    expect(html).toContain('href="/app/cbc/tasks?view=table&amp;assignee=u_oliver"');
    expect(html).toContain('href="/app/cbc/calendar/find-a-time/new?with=u_oliver"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain("@example.edu");
    expect(html).not.toContain("Copy email");
    expect(html).not.toContain("Edit your profile");
  });

  it("offers Copy email only when the data carries the email", async () => {
    getPersonSheetMock.mockResolvedValue({ ...sheet(), email: "oliver@example.edu" });
    const html = renderToStaticMarkup(await PersonPage(personParams("u_oliver")));
    expect(html).toContain("Copy email");
    expect(html).toContain("oliver@example.edu");
  });

  it("passes the org's email setting through to the sheet", async () => {
    getOrgContextBySlugMock.mockResolvedValue({
      user: viewer,
      organization: org,
      role: "MEMBER",
      settings: { showMemberEmailsToMembers: true },
    });
    getPersonSheetMock.mockResolvedValue(sheet());
    await PersonPage(personParams("u_oliver"));
    expect(getPersonSheetMock).toHaveBeenLastCalledWith(
      "org_cbc",
      "u_oliver",
      { id: "u_viewer", role: "MEMBER", membersSeeEmails: true },
      "America/New_York",
    );
  });

  it("lists members with their title and team, with a live summary", async () => {
    loadDirectoryMock.mockResolvedValue({
      people: [
        {
          id: "u_lucas",
          name: "Lucas Salzgeber",
          image: null,
          avatar: null,
          pronouns: null,
          major: "Data Science",
          gradYear: 2028,
          role: "ADMIN",
          title: "VP Growth",
          joinedAt: "2026-01-15T12:00:00.000Z",
          teamKey: "p_growth",
          freeNow: true,
        },
      ],
      teams: [{ key: "p_growth", name: "Growth", slot: 2 }],
      total: 1,
    });
    const html = renderToStaticMarkup(await PeoplePage(peopleParams));
    expect(loadDirectoryMock).toHaveBeenCalledWith("org_cbc", "America/New_York");
    expect(html).toContain("1 member · 1 team · 1 free now");
    expect(html).toContain("Lucas Salzgeber");
    // The dense list is the default now, and it shows the title and the team
    // as separate cells rather than one joined line.
    expect(html).toContain("VP Growth");
    expect(html).toContain("Growth");
    expect(html).toContain('data-person-id="u_lucas"');
    // Members can't invite: no create button.
    expect(html).not.toContain("Invite people");
  });
});
