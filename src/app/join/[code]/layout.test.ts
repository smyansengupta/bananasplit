import { describe, expect, it, vi } from "vitest";

/**
 * What a texted invite code previews as: the club by name, wearing its logo,
 * and never the code itself (a preview is fetched and cached by somebody
 * else's server). Over the per-IP cap, or for a code that opens nothing, it
 * names no club at all.
 */

const mocks = vi.hoisted(() => ({
  getPublicOrgTheme: vi.fn(),
  orgIdForJoinCode: vi.fn(async (code: string) => (code === "RPKA-YWSF" ? "org_cbc" : null)),
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/lib/theme/loader", () => ({
  getPublicOrgTheme: mocks.getPublicOrgTheme,
  orgIdForJoinCode: mocks.orgIdForJoinCode,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("@/lib/request-ip", () => ({ getClientIp: async () => "203.0.113.9" }));

const { generateMetadata } = await import("./layout");

const LOGO = {
  s64: "https://store.public.blob.vercel-storage.com/logos/o1/a/s64.webp",
  s256: "https://store.public.blob.vercel-storage.com/logos/o1/a/s256.webp",
  s512: "https://store.public.blob.vercel-storage.com/logos/o1/a/s512.webp",
};

const props = (code: string) =>
  ({ params: Promise.resolve({ code }) }) as unknown as LayoutProps<"/join/[code]">;

describe("a texted invite code's preview", () => {
  it("says the club's name and shows its logo", async () => {
    mocks.getPublicOrgTheme.mockResolvedValue({ name: "Claude Builder Club", logo: LOGO });
    const meta = await generateMetadata(props("rpka-ywsf"));
    expect(meta.openGraph?.title).toBe(
      "You've been invited to join Claude Builder Club on Bananasplit",
    );
    expect(meta.openGraph).toMatchObject({ images: [{ url: LOGO.s512 }] });
    expect(meta.icons).toMatchObject({ icon: [{ url: LOGO.s64 }] });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(JSON.stringify(meta)).not.toContain("RPKA");
  });

  it("names no club for a code that opens nothing", async () => {
    mocks.getPublicOrgTheme.mockResolvedValue(null);
    const meta = await generateMetadata(props("AAAA-AAAA"));
    expect(meta.openGraph?.title).toBe("Join your club");
    expect(meta.openGraph).toMatchObject({ images: [{ url: "/og/join.png" }] });
    expect(meta).not.toHaveProperty("icons");
  });

  it("doesn't touch the database for something that can't be a code", async () => {
    mocks.checkRateLimit.mockClear();
    mocks.orgIdForJoinCode.mockClear();
    await generateMetadata(props("favicon.ico"));
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.orgIdForJoinCode).not.toHaveBeenCalled();
  });

  it("names no club once the client is over the lookup cap", async () => {
    mocks.getPublicOrgTheme.mockResolvedValue({ name: "Claude Builder Club", logo: LOGO });
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false });
    const meta = await generateMetadata(props("RPKA-YWSF"));
    expect(meta.openGraph?.title).toBe("Join your club");
  });
});
