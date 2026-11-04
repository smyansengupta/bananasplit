/**
 * The funnel Bananasplit measures, in order (the business model's Monday
 * numbers and the SaaS homepage report's "test your own hero"): a visitor
 * clicks a call to action, creates an account, creates an organization,
 * invites a teammate (the leading signal of a paying team), and picks a
 * plan. Page views come from Vercel Web Analytics on their own.
 *
 * Properties are short labels, never personal data: no names, emails or
 * ids (Vercel Analytics is cookieless and keeps no personal data; keep it
 * that way).
 */
export const FUNNEL_EVENTS = {
  /** A marketing call to action was clicked. `cta`: which one; `location`: where on the page. */
  ctaClicked: "CTA Clicked",
  /** An account was created (email and password; Google sign-ups land in onboarding). */
  signedUp: "Signed Up",
  /** An organization was created. */
  organizationCreated: "Organization Created",
  /** Someone was invited to an organization. */
  teammateInvited: "Teammate Invited",
  /** An organization or Personal space switched plan. `plan`: the new one. */
  planSelected: "Plan Selected",
  /** A demo was requested from /demo. `size`: the team size picked. */
  demoRequested: "Demo Requested",
} as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS];

export type EventProperties = Record<string, string | number | boolean | null>;
