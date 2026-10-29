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
 * - A page about one club (an invite, a texted invite code, a poll, an
 *   event) says the club's name in its title and uses the logo the club
 *   already uploaded as the picture: clubShare() below. The logo's variants
 *   are public, immutable and already on the CDN, and every caller is a
 *   layout that has loaded the club for its theme anyway, so the preview
 *   costs no extra read. A club with no logo gets a drawn card from
 *   public/og instead (FALLBACK_CARDS).
 *
 * Those club pages must NOT have an opengraph-image.png beside them: a file
 * there outranks anything generateMetadata says, so the club's logo would
 * never show. That is why their cards live in public/og and are named here.
 *
 * Nothing here ever puts a token, a code or an email address in metadata:
 * a preview is fetched by somebody else's server and cached there.
 */

export const SITE_NAME = "Bananasplit";

/**
 * The banana, for every page that doesn't belong to a club. Declared here
 * rather than as src/app/favicon.ico and friends because Next always adds a
 * file-convention favicon to every page, so a club page could never fully
 * replace it with the club's logo; declared, a page's own `icons` replace
 * these outright.
 */
export const SITE_ICONS: NonNullable<Metadata["icons"]> = {
  icon: [
    { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
    { url: "/icon.svg", type: "image/svg+xml" },
  ],
  apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
};

/** A drawn card for a club page whose club has no logo (public/og, scripts/og-cards.json). */
export interface FallbackCard {
  url: string;
  alt: string;
}

export const FALLBACK_CARDS = {
  invite: {
    url: "/og/invite.png",
    alt: "You're invited to join a club's workspace on Bananasplit.",
  },
  join: {
    url: "/og/join.png",
    alt: "Join your club on Bananasplit: an eight-box invite code.",
  },
  poll: {
    url: "/og/poll.png",
    alt: "Bananasplit: find a time that works — a week of times with a few marked.",
  },
  event: {
    url: "/og/event.png",
    alt: "Bananasplit: save your spot at this event, then RSVP.",
  },
} satisfies Record<string, FallbackCard>;

/** A drawn card as an og image: always 1200x630. */
function cardImage(card: FallbackCard) {
  return { url: card.url, width: 1200, height: 630, alt: card.alt };
}

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

/**
 * A page with its own words: the title and line, on og and twitter. The
 * picture is the drawn card beside the page (opengraph-image.png), or
 * `card` for a page that names one from public/og.
 */
export function shareMetadata({
  title,
  description,
  noIndex = false,
  card,
}: {
  title: string;
  description: string;
  noIndex?: boolean;
  card?: FallbackCard;
}): Metadata {
  return {
    title: `${title} · ${SITE_NAME}`,
    description,
    ...(noIndex ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      title,
      description,
      siteName: SITE_NAME,
      type: "website",
      ...(card ? { images: [cardImage(card)] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(card ? { images: [card.url] } : {}),
    },
  };
}

/**
 * A club's logo as a page's icon: the tab wears the club's picture instead
 * of the banana while you are on that club's page, and keeps the banana
 * (SITE_ICONS) for a club that has not uploaded one.
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
 * logo as the preview's picture and as the tab's icon, or `fallback` (a
 * drawn card) when it has no logo. A logo is square, so it takes X's
 * `summary` card; `summary_large_image` would crop it to a letterbox.
 */
export function clubShare({
  club,
  title,
  description,
  fallback,
  noIndex = true,
}: {
  club: { name: string; logo: unknown } | null;
  title: string;
  description: string;
  fallback: FallbackCard;
  noIndex?: boolean;
}): Metadata {
  const variants = club ? orgLogoVariants(club.logo) : null;
  return {
    title: `${title} · ${SITE_NAME}`,
    description,
    ...(noIndex ? { robots: { index: false, follow: false } } : {}),
    ...(variants ? { icons: clubIcons(club?.logo) } : {}),
    openGraph: {
      title,
      description,
      siteName: SITE_NAME,
      type: "website",
      images: variants
        ? [{ url: variants.s512, width: 512, height: 512, alt: club?.name ?? "" }]
        : [cardImage(fallback)],
    },
    twitter: variants
      ? { card: "summary", title, description, images: [variants.s512] }
      : { card: "summary_large_image", title, description, images: [fallback.url] },
  };
}
