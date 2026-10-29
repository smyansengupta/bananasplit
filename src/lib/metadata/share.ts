import type { Metadata } from "next";

import { appOrigin, AppUrlConfigError } from "@/lib/app-url";
import { orgLogoVariants } from "@/lib/org-logo";

/**
 * What a Bananasplit link looks like when it is pasted somewhere that
 * unfurls it: iMessage, Slack, X, WhatsApp, Discord.
 *
 * Two kinds of page, and neither renders an image per request:
 *
 * - A page whose words never change (the marketing site, the join form)
 *   gets a drawn card committed beside it as opengraph-image.png
 *   (src/components/marketing/og/og-cards.tsx). Static file, served from
 *   the CDN, nothing to run.
 * - A page about one club (an invite, a poll, an event) says the club's
 *   name in its title and uses the logo the club already uploaded as the
 *   picture: clubShare() below. The logo's variants are public, immutable
 *   and already on the CDN, and every caller is a layout that has loaded
 *   the club for its theme anyway, so the preview costs no extra read.
 *
 * Nothing here ever puts a token, a code or an email address in metadata:
 * a preview is fetched by somebody else's server and cached there.
 */

export const SITE_NAME = "Bananasplit";

/**
 * The origin that relative metadata URLs resolve against. Without it Next
 * falls back to the deployment's own host, so a shared link previews with
 * an image on a vercel.app URL instead of the site's domain. Production
 * without an app URL configured already fails loudly elsewhere
 * (AppUrlConfigError); metadata is not the place to take the site down
 * over it, so that one case falls back to Next's own behaviour.
 */
export function metadataBase(): URL | undefined {
  try {
    return new URL(appOrigin());
  } catch (error) {
    if (error instanceof AppUrlConfigError) return undefined;
    throw error;
  }
}

/** A page with its own drawn card: the title and line, on og and twitter. */
export function shareMetadata({
  title,
  description,
  noIndex = false,
}: {
  title: string;
  description: string;
  noIndex?: boolean;
}): Metadata {
  return {
    title: `${title} · ${SITE_NAME}`,
    description,
    ...(noIndex ? { robots: { index: false, follow: false } } : {}),
    openGraph: { title, description, siteName: SITE_NAME, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * A club's logo as a page's icon: the tab wears the club's picture instead
 * of the banana while you are on that club's page, and falls back to the
 * banana (src/app/icon.svg) for a club that has not uploaded one.
 *
 * The URLs are the stored WebP variants, already public and cached
 * immutably, so this adds no request the page was not making.
 */
export function clubIcons(logo: unknown): Metadata["icons"] {
  const variants = orgLogoVariants(logo);
  if (!variants) return undefined;
  return {
    icon: [{ url: variants.s64, type: "image/webp", sizes: "64x64" }],
    apple: [{ url: variants.s256, type: "image/webp", sizes: "256x256" }],
  };
}

/**
 * A page that belongs to one club: its name in the preview's title, its
 * logo as the preview's picture and as the tab's icon. The picture is
 * square, so `summary` is the right X card — `summary_large_image` would
 * crop a logo to a letterbox.
 */
export function clubShare({
  club,
  title,
  description,
  noIndex = true,
}: {
  club: { name: string; logo: unknown } | null;
  title: string;
  description: string;
  noIndex?: boolean;
}): Metadata {
  const variants = club ? orgLogoVariants(club.logo) : null;
  return {
    title: `${title} · ${SITE_NAME}`,
    description,
    ...(noIndex ? { robots: { index: false, follow: false } } : {}),
    icons: club ? clubIcons(club.logo) : undefined,
    openGraph: {
      title,
      description,
      siteName: SITE_NAME,
      type: "website",
      ...(variants
        ? { images: [{ url: variants.s512, width: 512, height: 512, alt: club?.name ?? "" }] }
        : {}),
    },
    twitter: variants
      ? { card: "summary", title, description, images: [variants.s512] }
      : { card: "summary_large_image", title, description },
  };
}
