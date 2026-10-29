import { TRIAL_DAYS } from "@/lib/billing/space";

/**
 * Where "Get started free" goes: straight to setup when signed in, else
 * sign-up first (Google or email), coming back to setup. Every primary
 * button on the marketing pages uses it.
 */
export function startHref(signedIn: boolean): string {
  return signedIn
    ? "/onboarding/organization"
    : "/sign-up?callbackUrl=%2Fonboarding%2Forganization";
}

/** The secondary, sales action ("Request a demo"): the /demo form, which emails DEMO_REQUEST_INBOX. */
export const DEMO_HREF = "/demo";

/** Under the hero's and the closing panel's buttons: the trial, and that no card is asked. */
export const TRIAL_PROMISE = `${TRIAL_DAYS} days of every feature, free. No credit card needed.`;

/**
 * The page's buttons (SaaS homepage report: the primary is the one colour
 * nothing else on the page uses; the secondary is an outline). Banana is
 * the isolated colour on Graphite's neutral page; ink text keeps it 11:1.
 * Fixed brand colours, so they read the same in light and dark.
 */
const BUTTON =
  "inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground [&_svg]:shrink-0";
export const PRIMARY_CTA = `${BUTTON} bg-banana text-ink hover:bg-lemon shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_8px_20px_-10px_rgb(28_24_16/0.45)]`;
export const SECONDARY_CTA = `${BUTTON} border border-input text-foreground hover:bg-muted`;
/** The header's smaller primary (40px). */
export const PRIMARY_CTA_SM = PRIMARY_CTA.replace("h-12 ", "h-10 ").replace(
  "px-6 text-[15px]",
  "px-[18px] text-[14px]",
);

/** The header's and footer's sections of the home page, absolute so /pricing can use them. */
export const NAV = [
  { label: "How it works", href: "/#texting" },
  { label: "Product", href: "/#product" },
  { label: "Integrations", href: "/#integrations" },
  { label: "Security", href: "/#security" },
  { label: "Pricing", href: "/pricing" },
] as const;
