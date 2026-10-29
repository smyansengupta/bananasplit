import { describe, expect, it } from "vitest";

import { clubIcons, clubShare, shareMetadata, SITE_NAME } from "./share";

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

  it("never carries an image of its own, so the route's file is used", () => {
    expect(shareMetadata({ title: "a", description: "b" }).openGraph).not.toHaveProperty("images");
  });
});

describe("clubIcons", () => {
  it("points the tab at the club's own stored logo", () => {
    expect(clubIcons(LOGO)).toEqual({
      icon: [{ url: LOGO.s64, type: "image/webp", sizes: "64x64" }],
      apple: [{ url: LOGO.s256, type: "image/webp", sizes: "256x256" }],
    });
  });

  it("falls back to the app's own icon for a club without a logo", () => {
    expect(clubIcons(null)).toBeUndefined();
    expect(clubIcons({})).toBeUndefined();
    expect(clubIcons({ s64: "javascript:alert(1)", s256: "/a", s512: "/b" })).toBeUndefined();
  });
});

describe("clubShare", () => {
  const club = { name: "Claude Builder Club", logo: LOGO };

  it("says the club's name and shows the club's logo", () => {
    const meta = clubShare({
      club,
      title: "You're invited to join Claude Builder Club on Bananasplit",
      description: "Open the link to accept.",
    });
    expect(meta.title).toBe(
      "You're invited to join Claude Builder Club on Bananasplit · Bananasplit",
    );
    expect(meta.openGraph).toMatchObject({
      images: [{ url: LOGO.s512, width: 512, height: 512, alt: club.name }],
    });
    expect(meta.icons).toEqual(clubIcons(LOGO));
    // A logo is square: the big X card would letterbox it.
    expect(meta.twitter).toMatchObject({ card: "summary" });
  });

  it("keeps an invite out of search by default", () => {
    expect(clubShare({ club, title: "t", description: "d" }).robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("leaves the route's own card in place for a club with no logo", () => {
    const meta = clubShare({ club: { name: "No Logo", logo: null }, title: "t", description: "d" });
    expect(meta.openGraph).not.toHaveProperty("images");
    expect(meta.icons).toBeUndefined();
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("handles a page whose club could not be loaded", () => {
    const meta = clubShare({ club: null, title: "t", description: "d" });
    expect(meta.icons).toBeUndefined();
    expect(meta.openGraph).not.toHaveProperty("images");
  });
});
