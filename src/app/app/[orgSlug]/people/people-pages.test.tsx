import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Privacy of the people pages (Phase 2), at the page level: a viewer who is
 * not a member of the org gets 404 from both pages (getOrgContextBySlug),
 * and a person who is not a current member of THIS org gets 404 from the
 * person page (getOrgPerson returns null), with nothing rendered. The
 * database side (RLS and the Membership join) is in
 * src/server/profiles/profiles.db.test.ts.
 */

const { getOrgContextBySlugMock, getOrgPersonMock, listOrgPeopleMock } = vi.hoisted(() => ({
  getOrgContextBySlugMock: vi.fn(),
  getOrgPersonMock: vi.fn(),
  listOrgPeopleMock: vi.fn(),
}));

vi.mock("@/server/db/context", () => ({ getOrgContextBySlug: getOrgContextBySlugMock }));
vi.mock("@/server/profiles/queries", async () => {
  const actual = await vi.importActual<typeof import("@/server/profiles/queries")>("@/server/profiles/queries");
  return { ...actual, getOrgPerson: getOrgPersonMock, listOrgPeople: listOrgPeopleMock };
});
vi.mock("next/form", () => ({
  default: ({ children, ...props }: React.ComponentProps<"form">) => <form {...props}>{children}</form>,
}));

const { notFound } = await import("next/navigation");
const { default: PersonPage } = await import("./[userId]/page");
const { default: PeoplePage } = await import("./page");

function isNotFound(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === "string" && digest.includes("404");
}

const viewer = { id: "u_viewer", email: "viewer@example.edu", name: "Viewer" };
const org = { id: "org_cbc", name: "Claude Builders Club", slug: "cbc", timezone: "America/New_York" };

const personParams = (userId: string) => ({
  params: Promise.resolve({ orgSlug: "cbc", userId }),
}) as unknown as PageProps<"/app/[orgSlug]/people/[userId]">;
const peopleParams = {
  params: Promise.resolve({ orgSlug: "cbc" }),
  searchParams: Promise.resolve({}),
} as unknown as PageProps<"/app/[orgSlug]/people">;

beforeEach(() => {
  vi.clearAllMocks();
  getOrgContextBySlugMock.mockResolvedValue({ user: viewer, organization: org, role: "MEMBER" });
});

describe("people pages privacy", () => {
  it("a non-member viewer gets 404 from the person page, and no profile is read", async () => {
    getOrgContextBySlugMock.mockImplementation(async () => notFound());
    const error = await PersonPage(personParams("u_member")).catch((e: unknown) => e);
    expect(isNotFound(error)).toBe(true);
    expect(getOrgPersonMock).not.toHaveBeenCalled();
  });

  it("a non-member viewer gets 404 from the directory, and no member is listed", async () => {
    getOrgContextBySlugMock.mockImplementation(async () => notFound());
    const error = await PeoplePage(peopleParams).catch((e: unknown) => e);
    expect(isNotFound(error)).toBe(true);
    expect(listOrgPeopleMock).not.toHaveBeenCalled();
  });

  it("a person who is not a member of this org gets 404 (another org's user, a former member, a bad id)", async () => {
    getOrgPersonMock.mockResolvedValue(null);
    for (const id of ["u_other_org", "u_former", "not-a-user"]) {
      const error = await PersonPage(personParams(id)).catch((e: unknown) => e);
      expect(isNotFound(error), id).toBe(true);
      expect(getOrgPersonMock).toHaveBeenLastCalledWith("org_cbc", id);
    }
  });

  it("shows a member's profile with this org's title and an Open tasks link, never an email", async () => {
    getOrgPersonMock.mockResolvedValue({
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
      joinedAt: new Date("2026-01-15T12:00:00Z"),
    });
    const html = renderToStaticMarkup(await PersonPage(personParams("u_oliver")));
    expect(html).toContain("Oliver Ward");
    expect(html).toContain("he/him");
    expect(html).toContain("VP Ops &amp; Programs");
    expect(html).toContain("Business Administration · Class of 2027");
    expect(html).toContain("Runs the exec sync.");
    expect(html).toContain('href="/app/cbc/tasks?view=table&amp;assignee=u_oliver"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain("@example.edu");
    expect(html).not.toContain("Edit your profile");
  });

  it("lists members with their title in this org", async () => {
    listOrgPeopleMock.mockResolvedValue({
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
        },
      ],
      total: 1,
      page: 1,
      pageCount: 1,
      pageSize: 50,
    });
    const html = renderToStaticMarkup(await PeoplePage(peopleParams));
    expect(listOrgPeopleMock).toHaveBeenCalledWith("org_cbc", { page: 1, q: "" });
    expect(html).toContain("Lucas Salzgeber");
    expect(html).toContain("VP Growth");
    expect(html).toContain('href="/app/cbc/people/u_lucas"');
  });
});
