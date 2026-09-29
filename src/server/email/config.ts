/**
 * Email delivery configuration (Fix 17, D9).
 *
 *   EMAIL_DELIVERY=live   send through Resend (RESEND_API_KEY required)
 *   EMAIL_DELIVERY=sink   never send: write to the console and .data/mail/
 *                         (also EMAIL_DELIVERY=log or EMAIL_SINK=log)
 *   EMAIL_DELIVERY=off    send nothing; email jobs wait PENDING and go out
 *                         once delivery is switched back on (the Fix 17
 *                         fallback while the sending domain is unverified)
 *   unset                 live when RESEND_API_KEY is set; otherwise the
 *                         sink locally, and a configuration error in
 *                         production (a missing key must fail loudly there,
 *                         and /api/health reports it)
 *
 * Previews (VERCEL_ENV=preview) never deliver real mail: anything but "off"
 * becomes the sink.
 */

import { appOrigin } from "@/lib/app-url";

export type EmailDelivery = "live" | "sink" | "off";

type Env = Record<string, string | undefined>;

export function isProductionDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

export function emailDelivery(env: Env = process.env): EmailDelivery {
  const raw = (env.EMAIL_DELIVERY ?? "").trim().toLowerCase();
  if (raw === "off") return "off";
  if (env.VERCEL_ENV === "preview") return "sink";
  if (raw === "sink" || raw === "log" || env.EMAIL_SINK === "log") return "sink";
  if (raw === "live") return "live";
  if (env.RESEND_API_KEY) return "live";
  return isProductionDeployment(env) ? "live" : "sink";
}

/** The dev fallback sender; production must set EMAIL_FROM. */
export const DEV_EMAIL_FROM = "Clubport <no-reply@example.com>";

/** The platform sender address (name plus address), e.g. "Clubport <no-reply@x.org>". */
export function platformFrom(env: Env = process.env): string {
  return env.EMAIL_FROM?.trim() || DEV_EMAIL_FROM;
}

/** The bare address of a "Name <addr>" or "addr" sender. */
export function addressOf(from: string): string {
  const m = /<([^<>]+)>\s*$/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

/** The domain of a sender. */
export function domainOf(from: string): string {
  const address = addressOf(from);
  return address.slice(address.lastIndexOf("@") + 1);
}

/** The last two labels of a host (claudeneu.com for portal.claudeneu.com). */
function siteOf(host: string): string {
  return host.split(".").slice(-2).join(".");
}

/**
 * Whether the platform sender sits on the app's site: the same registrable
 * domain as the app host (approximated as its last two labels, which covers
 * .com/.org/.edu/.io), e.g. no-reply@mail.claudeneu.com for an app on
 * portal.claudeneu.com. The verified-domain rule the production health check
 * applies to EMAIL_FROM; the placeholder example.com never passes.
 */
export function fromMatchesAppDomain(from: string, appOrigin: string): boolean {
  const fromDomain = domainOf(from);
  let host: string;
  try {
    host = new URL(appOrigin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!fromDomain.includes(".") || siteOf(fromDomain) === "example.com") return false;
  return siteOf(fromDomain) === siteOf(host);
}

/**
 * Configuration problems that make production email fail, for /api/health.
 * Empty when email is correctly configured or deliberately off.
 */
export function emailConfigProblems(env: Env = process.env): string[] {
  const delivery = emailDelivery(env);
  if (delivery === "off" || !isProductionDeployment(env)) return [];
  const problems: string[] = [];
  if (!env.RESEND_API_KEY) problems.push("RESEND_API_KEY is not set");
  if (!env.EMAIL_FROM) problems.push("EMAIL_FROM is not set");
  else {
    // The origin the links use (NEXT_PUBLIC_APP_URL, else the production
    // domain). Without one there is nothing to compare; production:app_url
    // reports that.
    const origin = linkOrigin(env);
    if (origin && !fromMatchesAppDomain(env.EMAIL_FROM, origin)) {
      problems.push("EMAIL_FROM is not on the app's (verified) domain");
    }
  }
  return problems;
}

function linkOrigin(env: Env): string | null {
  try {
    return appOrigin(env);
  } catch {
    return null;
  }
}
