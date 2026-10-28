import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowRight } from "@/components/brand/arrows";
import { ProductArt } from "@/components/marketing/feature-art";
import { FinalCta } from "@/components/marketing/final-cta";
import { DEMO_HREF, PRIMARY_CTA, SECONDARY_CTA, startHref } from "@/components/marketing/links";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PRODUCT_PAGES, productPage } from "@/components/marketing/product-pages";
import { CONTAINER, SectionTitle } from "@/components/marketing/section-title";
import { SiteLink } from "@/components/marketing/site-link";
import { getSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: PageProps<"/product/[slug]">): Promise<Metadata> {
  const page = productPage((await params).slug);
  if (!page) return {};
  return { title: `${page.label} · Bananasplit`, description: page.subtitle };
}

/**
 * A main feature's page (/product/<slug>), laid out like Notion's product
 * pages: the hero (label, headline, one line, the two buttons, the
 * feature's illustration), how it works in three steps, six capabilities,
 * the other main features, then the final call to action. Content lives in
 * src/components/marketing/product-pages.ts.
 */
export default async function ProductPage({ params }: PageProps<"/product/[slug]">) {
  const page = productPage((await params).slug);
  if (!page) notFound();
  const signedIn = Boolean(await getSession());
  const others = PRODUCT_PAGES.filter((p) => p.slug !== page.slug);

  return (
    <MarketingShell signedIn={signedIn}>
      <section
        className={cn(
          CONTAINER,
          "grid items-center gap-12 pt-[clamp(48px,7vw,96px)] lg:grid-cols-[1fr_1.05fr] lg:gap-16",
        )}
      >
        <div className="flex flex-col items-start gap-6">
          <span className="text-foreground/60 text-[14px] font-semibold">{page.label}</span>
          <SectionTitle
            as="h1"
            className="text-[clamp(42px,5.6vw,72px)] leading-[0.98] text-balance"
          >
            {page.title}
          </SectionTitle>
          <p className="text-foreground/80 max-w-[520px] text-[18px] leading-[1.55] text-pretty">
            {page.subtitle}
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href={startHref(signedIn)}
              className={PRIMARY_CTA}
              data-cta="get_started"
              data-cta-location={`product_${page.slug}`}
            >
              Get started free <ArrowRight />
            </Link>
            <SiteLink
              href={DEMO_HREF}
              className={SECONDARY_CTA}
              data-cta="request_demo"
              data-cta-location={`product_${page.slug}`}
            >
              Request a demo
            </SiteLink>
          </div>
        </div>
        <div aria-hidden="true">
          <ProductArt slug={page.slug} size="lg" />
        </div>
      </section>

      <section className={cn(CONTAINER, "pt-24 sm:pt-32")}>
        <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {page.steps.map((step, i) => (
            <li
              key={step.title}
              className="border-border flex flex-col gap-3 rounded-[20px] border p-6"
            >
              <span className="bg-foreground text-background grid size-8 place-items-center rounded-full text-[14px] font-semibold">
                {i + 1}
              </span>
              <span className="text-[19px] font-semibold tracking-[-0.01em]">{step.title}</span>
              <span className="text-foreground/75 text-[15px] leading-[1.55]">{step.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={cn(CONTAINER, "flex flex-col gap-10 pt-24 sm:gap-12 sm:pt-32")}>
        <SectionTitle className="mx-auto max-w-[760px] text-center text-balance">
          {page.capabilitiesTitle}
        </SectionTitle>
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {page.capabilities.map(({ icon: Icon, title, body }) => (
            <li key={title} className="bg-muted/70 rounded-card flex flex-col gap-3 p-6 sm:p-7">
              <span className="bg-card grid size-10 place-items-center rounded-[12px] shadow-[var(--elevation-1)]">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="text-[18px] font-semibold tracking-[-0.01em]">{title}</span>
              <span className="text-foreground/75 text-[15px] leading-[1.55]">{body}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={cn(CONTAINER, "flex flex-col gap-8 pt-24 sm:pt-32")}>
        <h2 className="display-title text-center text-[clamp(28px,3vw,40px)] leading-[1.1] tracking-[-0.03em]">
          More of what Bananasplit does
        </h2>
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {others.map((other) => (
            <li key={other.slug}>
              <Link
                href={`/product/${other.slug}`}
                className="group border-border hover:bg-muted/50 flex h-full flex-col gap-2 rounded-[20px] border p-6 transition-colors"
              >
                <span className="text-foreground/60 text-[13px] font-semibold">{other.label}</span>
                <span className="flex items-start justify-between gap-3">
                  <span className="text-[18px] leading-[1.25] font-semibold tracking-[-0.01em]">
                    {other.cardTitle}
                  </span>
                  <span
                    aria-hidden="true"
                    className="bg-foreground text-background grid size-7 flex-none place-items-center rounded-full transition-transform group-hover:translate-x-0.5"
                  >
                    <ArrowRight className="size-3.5" />
                  </span>
                </span>
                <span className="text-foreground/75 text-[14px] leading-[1.5]">
                  {other.cardBody}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <FinalCta signedIn={signedIn} />
    </MarketingShell>
  );
}
