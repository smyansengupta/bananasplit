import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserAvatar } from "@/components/user-avatar";

import { avatarSource, initialsOf, parseAvatarVariants } from "./avatar";

const avatar = {
  key: "avatars/u1/abc",
  s64: "https://store.public.blob.vercel-storage.com/avatars/u1/abc/s64.webp",
  s128: "https://store.public.blob.vercel-storage.com/avatars/u1/abc/s128.webp",
  s256: "https://store.public.blob.vercel-storage.com/avatars/u1/abc/s256.webp",
};

describe("avatar helpers", () => {
  it("parses only usable variant URLs", () => {
    expect(parseAvatarVariants({ s64: "javascript:alert(1)", s128: "/api/dev/blob/avatars/u/k/s128.webp" })).toEqual({
      s128: "/api/dev/blob/avatars/u/k/s128.webp",
    });
    expect(parseAvatarVariants(null)).toEqual({});
    expect(parseAvatarVariants("x")).toEqual({});
  });

  it("falls back from the uploaded avatar to the OAuth image to nothing", () => {
    // 32px at 2x is 64px: the s64 variant covers both densities.
    expect(avatarSource({ avatar, image: "https://lh3.googleusercontent.com/a" }, 32)).toEqual({
      src: avatar.s64,
    });
    expect(avatarSource({ avatar, image: null }, 40)).toEqual({
      src: avatar.s64,
      srcSet: `${avatar.s64} 1x, ${avatar.s128} 2x`,
    });
    expect(avatarSource({ avatar, image: null }, 128)).toEqual({
      src: avatar.s128,
      srcSet: `${avatar.s128} 1x, ${avatar.s256} 2x`,
    });
    expect(avatarSource({ avatar: null, image: "https://lh3.googleusercontent.com/a" }, 32)).toEqual({
      src: "https://lh3.googleusercontent.com/a",
    });
    expect(avatarSource({ avatar: null, image: null }, 32)).toBeNull();
  });

  it("makes initials from the name, else the email", () => {
    expect(initialsOf("Jackson Lamoureux")).toBe("JL");
    expect(initialsOf("Mehr")).toBe("ME");
    expect(initialsOf(null, "kristine.min@example.edu")).toBe("KM");
    expect(initialsOf(null, null)).toBe("?");
  });
});

describe("UserAvatar", () => {
  it("renders initials as the fallback", () => {
    render(<UserAvatar user={{ name: "Oliver Ward" }} size="sm" decorative={false} />);
    expect(screen.getByText("OW")).toBeTruthy();
    expect(screen.getByTitle("Oliver Ward")).toBeTruthy();
  });
});
