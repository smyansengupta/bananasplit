import { Check, FileText, Video } from "@/components/icons";
import Image from "next/image";
import Link from "next/link";

import { ArrowRight } from "@/components/brand/arrows";
import { cn } from "@/lib/utils";

import { BrandMark } from "./brand-mark";
import { BRANDS, brandBySlug } from "./brands";
import { DEMO_HREF, PRIMARY_CTA, PRODUCT_SHADOW, SECONDARY_CTA, startHref } from "./links";
import { LogoTiles } from "./logo-tiles";
import { RotatingWord } from "./rotating-word";
import { IMESSAGE } from "./palette";
import { CONTAINER } from "./section-title";
import { SiteLink } from "./site-link";

/**
 * A screenshot of the hub itself (a workspace's Overview, 2560×1360). To
 * retake it in the Graphite theme, sign in as a seeded user on a local
 * database and capture /app/<org> at 1280×680, 2× scale.
 */
const HUB_SCREENSHOT = "/marketing/app-overview.webp";

/** A product moment's card: floating on the stage's edge on wide screens, in a row below it otherwise. */
const MOMENT =
  "border-foreground/10 bg-card flex w-[248px] flex-col gap-2 rounded-[16px] border p-3.5 text-left shadow-[var(--elevation-2)]";

/** Its app's logo and what happened, on one line. */
function MomentHead({ slug, label }: { slug: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-[12px] font-semibold">
      <BrandMark brand={brandBySlug(slug)} size={22} />
      {label}
    </span>
  );
}

/**
 * The four product moments: a task from iMessage, Claude adding work, a Zoom
 * call booked, Granola notes filed. `at` places each on the stage's edge.
 */
const MOMENTS: readonly { id: string; at: string; tilt: string; body: React.ReactNode }[] = [
  {
    id: "imessage",
    at: "top-[12%] -left-[36px]",
    tilt: "-rotate-1",
    body: (
      <>
        <span className="text-muted-foreground text-[11px] font-semibold">iMessage</span>
        <span
          className="self-end rounded-[16px] rounded-br-[6px] px-3 py-2 text-[12.5px] leading-[1.4]"
          style={{ backgroundColor: IMESSAGE.blue, color: IMESSAGE.white }}
        >
          Maya books the venue by Friday.
        </span>
        <span className="bg-muted self-start rounded-[16px] rounded-bl-[6px] px-3 py-2 text-[12.5px]">
          Done. It&apos;s on her list.
        </span>
      </>
    ),
  },
  {
    id: "claude",
    at: "top-[8%] -right-[36px]",
    tilt: "rotate-1",
    body: (
      <>
        <MomentHead slug="claude" label="Claude" />
        <span className="text-[12.5px] leading-[1.45]">
          Added 4 tasks to <b>Fall launch</b> in Bananasplit.
        </span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <Check className="size-3" strokeWidth={3} /> Owners and due dates set
        </span>
      </>
    ),
  },
  {
    id: "zoom",
    at: "bottom-[14%] -left-[28px]",
    tilt: "-rotate-1",
    body: (
      <>
        <MomentHead slug="zoom" label="Design review · Thu 2 PM" />
        <span className="flex items-center gap-1.5 rounded-[10px] bg-(--tag-forest)/12 px-2.5 py-1.5 text-[11.5px] font-semibold text-(--tag-forest)">
          <Video className="size-3.5" /> Zoom link created, 6 invites sent
        </span>
      </>
    ),
  },
  {
    id: "granola",
    at: "-right-[28px] bottom-[12%]",
    tilt: "rotate-1",
    body: (
      <>
        <MomentHead slug="granola" label="Granola" />
        <span className="flex items-center gap-1.5 text-[12.5px]">
          <FileText className="text-muted-foreground size-3.5" /> Notes saved to <b>Launch plan</b>
        </span>
      </>
    ),
  },
];

/**
 * The hero, centred like Notion's and Jira's, to the SaaS homepage report's
 * spec ("What the research says"): a short headline in high contrast
 * (Reber & Schwarz), a one-line subhead that says what Bananasplit is, one filled primary and one outline secondary, then
 * the real product (NN/g: images with information get looked at) on a soft
 * stage, with four product moments resting on its edges on wide screens and in a
 * swipeable row overlapping its bottom edge everywhere else. The only motion
 * is the headline's changing word (team, life, club, company).
 */
export function Hero({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <section
      className={cn(CONTAINER, "relative flex flex-col items-center pt-[clamp(48px,7vw,96px)]")}
    >
      <div className="flex max-w-[920px] flex-col items-center gap-6 text-center">
        {/* On phones the size follows the screen width, so "company keeping." always fits one line. */}
        <h1
          aria-label="The new era of team keeping."
          className="display-title text-[10.5vw] leading-[0.95] tracking-[-0.05em] whitespace-nowrap sm:text-[clamp(48px,8vw,104px)]"
        >
          <span aria-hidden="true">
            The new era of
            <br />
            <RotatingWord /> keeping.
          </span>
        </h1>
        <p className="text-foreground/80 max-w-[580px] text-[clamp(18px,1.7vw,21px)] leading-[1.5] text-pretty">
          The only workspace that runs your organization, and plugs into the apps you already use.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            href={startHref(signedIn)}
            className={PRIMARY_CTA}
            data-cta="get_started"
            data-cta-location="hero"
          >
            Get started free <ArrowRight />
          </Link>
          <SiteLink
            href={DEMO_HREF}
            className={SECONDARY_CTA}
            data-cta="request_demo"
            data-cta-location="hero"
          >
            Request a demo
          </SiteLink>
        </div>
      </div>

      <div
        id="product"
        className="bg-muted/60 relative mt-[clamp(48px,6vw,80px)] w-full scroll-mt-24 rounded-[28px] p-[clamp(12px,4vw,56px)] max-xl:pb-16 max-sm:pb-14"
      >
        {MOMENTS.map(({ id, at, body }) => (
          <div
            key={id}
            aria-hidden="true"
            className={cn(MOMENT, "absolute z-10 hidden xl:flex", at)}
          >
            {body}
          </div>
        ))}
        <div
          className={cn(
            "border-foreground/10 bg-card mx-auto max-w-[1080px] overflow-hidden rounded-[14px] border",
            PRODUCT_SHADOW,
          )}
        >
          <div className="border-foreground/8 flex h-8 items-center gap-1.5 border-b px-3.5">
            <span className="bg-foreground/15 size-2.5 rounded-full" />
            <span className="bg-foreground/15 size-2.5 rounded-full" />
            <span className="bg-foreground/15 size-2.5 rounded-full" />
          </div>
          <div className="relative aspect-[2560/1360] sm:aspect-[2560/1120]">
            <Image
              src={HUB_SCREENSHOT}
              alt="The Bananasplit hub: a workspace's Overview with open tasks, what's due and what's up next this week"
              fill
              priority
              sizes="(min-width: 1120px) 1080px, 95vw"
              className="object-cover object-left-top"
            />
          </div>
        </div>
      </div>

      <ul
        aria-hidden="true"
        className="relative z-10 m-0 -mt-10 flex w-[calc(100%+48px)] snap-x snap-mandatory scroll-px-6 [scrollbar-width:none] list-none gap-3 overflow-x-auto px-6 pt-1 pb-3 sm:-mt-14 xl:hidden [&>li:first-child]:ml-auto [&>li:last-child]:mr-auto"
      >
        {MOMENTS.map(({ id, body, tilt }) => (
          <li key={id} className={cn(MOMENT, "flex-none snap-start", tilt)}>
            {body}
          </li>
        ))}
      </ul>

      <div className="mt-10 flex w-full flex-col items-center gap-5 sm:mt-16 sm:gap-6">
        <span className="text-foreground/60 text-[14px]">Works with the apps you already use</span>
        {/* Phones: the logos in colour as tiles that name themselves when tapped; wider: each logo with its name, in grey. */}
        <div className="md:hidden">
          <LogoTiles
            apps={BRANDS.map((brand) => ({
              slug: brand.slug,
              name: brand.name,
              mark: <BrandMark brand={brand} size={28} />,
            }))}
          />
        </div>
        <ul className="m-0 hidden max-w-[1080px] list-none flex-wrap items-center justify-center gap-x-8 gap-y-4 p-0 md:flex">
          {BRANDS.map((brand) => (
            <li key={brand.slug} className="text-foreground/75 flex items-center gap-2.5">
              <BrandMark brand={brand} size={26} tone="mono" />
              <span className="text-[15px] font-semibold tracking-[-0.01em]">{brand.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
