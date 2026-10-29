import { describe, expect, it, vi } from "vitest";

/**
 * What an emailed invite link previews as in iMessage, Slack or X: the
 * inviting club by name, wearing its own logo. The token must never reach
 * the metadata — a preview is fetched and cached by somebody else's server.
 */

const mocks = vi.hoisted(() => ({
  getPublicOrgTheme: vi.fn(),
  orgIdForInviteTokenHash: vi.fn(async () => "org_cbc"),
}));

vi.mock("@/lib/theme/loader", () => ({
  getPublicOrgTheme: mocks.getPublicOrgTheme,
  orgIdForInviteTokenHash: mocks.orgIdForInviteTokenHash,
}));
vi.mock("@/lib/invitations", () => ({ hashInvitationToken: (token: string) => `hash:${token}` }));

const { generateMetadata } = await import("./layout");

const LOGO = {
  s64: "https://store.public.blob.vercel-storage.com/logos/o1/a/s64.webp",
  s256: "https://store.public.blob.vercel-storage.com/logos/o1/a/s256.webp",
  s512: "https://store.public.blob.vercel-storage.com/logos/o1/a/s512.webp",
};

const TOKEN = "tok_abc123";
const props = (token = TOKEN) =>
  ({ params: Promise.resolve({ token }) }) as unknown as LayoutProps<"/invite/[token]">;

describe("the invite link's preview", () => {
  it("names the club and shows its logo", async () => {
    mocks.getPublicOrgTheme.mockResolvedValue({ name: "Claude Builder Club", logo: LOGO });
    const meta = await generateMetadata(props());
    expect(meta.openGraph?.title).toBe("You're invited to join Claude Builder Club on Bananasplit");
    expect(meta.openGraph).toMatchObject({ images: [{ url: LOGO.s512 }] });
    expect(meta.icons).toMatchObject({ icon: [{ url: LOGO.s64 }] });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("never puts the token in the preview", async () => {
    mocks.getPublicOrgTheme.mockResolvedValue({ name: "Claude Builder Club", logo: LOGO });
    expect(JSON.stringify(await generateMetadata(props()))).not.toContain(TOKEN);
  });

  it("says nothing about a club when the token is unknown", async () => {
    mocks.getPublicOrgTheme.mockResolvedValue(null);
    const meta = await generateMetadata(props("nope"));
    expect(meta.title).toBe("Invite · Bananasplit");
    expect(meta.openGraph).toBeUndefined();
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
