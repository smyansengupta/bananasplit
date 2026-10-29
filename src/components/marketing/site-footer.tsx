import { Logo } from "@/components/brand/logo";
import { CONTACT_HREF, PRIVACY_HREF, TERMS_HREF } from "@/lib/brand/links";

import { startHref } from "./links";
import { SiteLink } from "./site-link";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Texting", href: "/product/texting" },
      { label: "Docs and files", href: "/product/docs" },
      { label: "AI", href: "/product/ai" },
      { label: "Meetings", href: "/product/meetings" },
      { label: "Finance", href: "/product/finance" },
    ],
  },
  {
    title: "Works with",
    links: [
      { label: "Integrations", href: "/#integrations" },
      { label: "Claude and ChatGPT", href: "/#integrations" },
      { label: "Granola and Wispr Flow", href: "/#integrations" },
    ],
  },
  {
    title: "Plans",
    links: [
      { label: "Pricing", href: "/pricing" },
      { label: "Schools and companies", href: "/pricing#custom" },
      { label: "Security", href: "/#security" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Log in", href: "/sign-in" },
      { label: "Get started free", href: startHref(false) },
      { label: "Join with a code", href: "/onboarding/join" },
      { label: "Contact", href: CONTACT_HREF },
    ],
  },
] as const;

/**
 * The logo and tagline, four columns of links, then the copyright, the
 * legal links. Signed in, "Log in" opens the app.
 */
export function SiteFooter({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-12 px-6 pt-16 pb-10">
        <div className="flex flex-wrap justify-between gap-x-16 gap-y-10">
          <div className="flex max-w-[320px] flex-[1_1_240px] flex-col gap-4">
            <SiteLink href="/" className="flex">
              <Logo size={26} textSize={19} />
            </SiteLink>
            <p className="text-muted-foreground text-[15px] leading-[1.55]">
              The first ambient workplace: your team&apos;s work keeps itself up to date.
            </p>
          </div>
          <div className="grid flex-[3_1_520px] grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-8">
            {COLUMNS.map((column) => (
              <div key={column.title} className="flex flex-col gap-3">
                <span className="text-[13px] font-semibold">{column.title}</span>
                {column.links.map((link) => {
                  const toApp = signedIn && link.href === "/sign-in";
                  return (
                    <SiteLink
                      key={link.label}
                      href={toApp ? "/app" : link.href}
                      className="text-muted-foreground hover:text-foreground text-[14px] transition-colors"
                    >
                      {toApp ? "Open Bananasplit" : link.label}
                    </SiteLink>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="border-border text-muted-foreground flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t pt-6 text-[13px]">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span>© 2026 Bananasplit</span>
            <SiteLink href={PRIVACY_HREF} className="hover:text-foreground">
              Privacy
            </SiteLink>
            <SiteLink href={TERMS_HREF} className="hover:text-foreground">
              Terms
            </SiteLink>
          </div>
        </div>
      </div>
    </footer>
  );
}
