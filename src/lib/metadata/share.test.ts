import { describe, expect, it } from "vitest";

import {
  clubIcons,
  clubShare,
  FALLBACK_CARDS,
  mainShare,
  signInPreviewFor,
  shareMetadata,
  SITE_ICONS,
  SITE_NAME,
} from "./share";

const LOGO = {
  key: "logos/o1/abc",
  s64: "https://store.public.blob.vercel-storage.com/logos/o1/abc/s64.webp",
  s256: "https://store.public.blob.vercel-storage.com/logos/o1/abc/s256.webp",
  s512: "https://store.public.blob.vercel-storage.com/logos/o1/abc/s512.webp",
};

describe("shareMetadata", () => {
  it("names the site in the title and repeats the line on both cards", () => {
    const meta = shareMetadata({ title: "Pricing", description: "What it costs." });
    expect(meta.title).toBe(`Pricing · ${SITE_NAME}`);
    expect(meta.openGraph).toMatchObject({ title: "Pricing", description: "What it costs." });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: "Pricing" });
    // Pages anyone may find stay findable unless they ask not to be.
    expect(meta.robots).toBeUndefined();
  });

  it("keeps a page out of search when asked", () => {
    const meta = shareMetadata({ title: "Join", description: "Enter a code.", noIndex: true });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("leaves the picture to the route's own file unless it names a card", () => {
    expect(shareMetadata({ title: "a", description: "b" }).openGraph).not.toHaveProperty("images");
    expect(
      shareMetadata({ title: "a", description: "b", card: FALLBACK_CARDS.join }).openGraph,
    ).toMatchObject({ images: [{ url: "/og/join.png", width: 1200, height: 630 }] });
  });
});

describe("the site's own icons", () => {
  it("are the banana files in public, so a club page can replace them outright", () => {
    expect(SITE_ICONS).toMatchObject({
      icon: [{ url: "/favicon.ico" }, { url: "/icon.svg" }],
      apple: [{ url: "/apple-icon.png" }],
    });
  });
});

describe("clubIcons", () => {
  it("points the tab at the club's own stored logo", () => {
    expect(clubIcons(LOGO)).toEqual({
      icon: [{ url: LOGO.s64, type: "image/webp", sizes: "64x64" }],
      apple: [{ url: LOGO.s256, type: "image/webp", sizes: "256x256" }],
    });
  });

  it("gives nothing for a club without a logo, so the banana stays", () => {
    expect(clubIcons(null)).toBeUndefined();
    expect(clubIcons({})).toBeUndefined();
    expect(clubIcons({ s64: "javascript:alert(1)", s256: "/a", s512: "/b" })).toBeUndefined();
  });
});

describe("clubShare", () => {
  const club = { name: "Claude Builder Club", logo: LOGO };
  const share = (over: Partial<Parameters<typeof clubShare>[0]> = {}) =>
    clubShare({ club, title: "t", description: "d", fallback: FALLBACK_CARDS.invite, ...over });

  it("says the club's name and shows the club's logo", () => {
    const meta = share({
      title: "You've been invited to join Claude Builder Club on Bananasplit",
      description: "Open the link to accept.",
    });
    expect(meta.title).toBe(
      "You've been invited to join Claude Builder Club on Bananasplit · Bananasplit",
    );
    expect(meta.openGraph).toMatchObject({
      images: [{ url: LOGO.s512, width: 512, height: 512, alt: club.name }],
    });
    expect(meta.icons).toEqual(clubIcons(LOGO));
    // A logo is square: the big X card would letterbox it.
    expect(meta.twitter).toMatchObject({ card: "summary", images: [LOGO.s512] });
  });

  it("keeps a club page out of search by default", () => {
    expect(share().robots).toEqual({ index: false, follow: false });
  });

  it("shows the drawn card, and keeps the banana, for a club with no logo", () => {
    const meta = share({ club: { name: "No Logo", logo: null } });
    expect(meta.openGraph).toMatchObject({
      images: [{ url: "/og/invite.png", width: 1200, height: 630 }],
    });
    expect(meta).not.toHaveProperty("icons");
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      images: ["/og/invite.png"],
    });
  });

  it("handles a page whose club could not be loaded", () => {
    const meta = share({ club: null, fallback: FALLBACK_CARDS.poll });
    expect(meta).not.toHaveProperty("icons");
    expect(meta.openGraph).toMatchObject({ images: [{ url: "/og/poll.png" }] });
  });
});

describe("signInPreviewFor", () => {
  it("says Welcome back only for a plain link to the log-in page", () => {
    expect(signInPreviewFor(null)).toBe("sign-in");
    expect(signInPreviewFor("")).toBe("sign-in");
  });

  it("shows the join card for an old ?code= join link", () => {
    expect(signInPreviewFor("/onboarding/join?code=RPKA-YWSF")).toBe("join");
  });

  it("shows the main card for every other link behind sign-in", () => {
    expect(signInPreviewFor("/app/robotics-club/tasks/t_1")).toBe("main");
    expect(signInPreviewFor("/checkout")).toBe("main");
    expect(signInPreviewFor("/onboarding/start")).toBe("main");
    expect(signInPreviewFor("/onboarding/joinery")).toBe("main");
  });
});

describe("mainShare", () => {
  it("sets no openGraph or twitter, so the root's main card is inherited intact", () => {
    const meta = mainShare({ title: "Privacy Policy", description: "How we handle data." });
    expect(meta).toEqual({
      title: "Privacy Policy · Bananasplit",
      description: "How we handle data.",
    });
    expect(meta).not.toHaveProperty("openGraph");
    expect(meta).not.toHaveProperty("twitter");
  });

  it("keeps a page out of search when asked", () => {
    expect(mainShare({ title: "a", description: "b", noIndex: true }).robots).toEqual({
      index: false,
      follow: false,
    });
  });
});
