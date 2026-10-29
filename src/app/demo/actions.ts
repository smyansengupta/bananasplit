"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { FUNNEL_EVENTS } from "@/lib/analytics/events";
import { trackServer } from "@/lib/analytics/server";
import { getSession } from "@/lib/auth/session";
import { startHref } from "@/components/marketing/links";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { saveDemoRequest } from "@/server/demo/requests";
import { getPlatformMailer } from "@/server/email/mailer";
import { layout, paragraph } from "@/server/email/templates";

import { TEAM_SIZES } from "./sizes";

const demoSchema = z.object({
  name: z.string().trim().min(1, "Add your name").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid work email")),
  organization: z.string().trim().min(1, "Add your organization").max(120),
  size: z.enum(TEAM_SIZES, "Pick your team size"),
  message: z.string().trim().max(2000).optional(),
});

export interface DemoState {
  error?: string;
  /** What was typed, sent back with an error so the form keeps it. */
  values?: Record<string, string>;
}

/** Five requests an hour from one network is plenty for a real person. */
const PER_IP = { limit: 5, windowSec: 60 * 60 };
/** One address is emailed about twice a day at most (more are still saved). */
const PER_EMAIL = { limit: 2, windowSec: 24 * 60 * 60 };
/**
 * And the inbox gets this many a day from the whole site, whatever the IPs:
 * a ceiling a script can reach, so past it requests are still saved, just
 * not emailed. A real lead is never turned away by someone else's flood.
 */
const SITE_WIDE = { limit: 100, windowSec: 24 * 60 * 60 };

/** The hidden field (DemoForm) people never see or fill; a bot filling every input does. */
const DEMO_HONEYPOT = "website";

/** Where requests are emailed when DEMO_REQUEST_INBOX doesn't say otherwise. */
const DEFAULT_INBOX = "jack.lam251@gmail.com";

/**
 * "Get a 15-minute walkthrough": emails the request to the inbox
 * (DEMO_REQUEST_INBOX, else DEFAULT_INBOX) through the platform sender (in
 * local development, the mail sink in .data/mail), saves it in DemoRequest
 * with when it was emailed (so a request survives a failed email), records
 * the funnel event with the team size only, then sends them on to create
 * their organization (sign-up first when signed out). Only when neither
 * the email nor the save worked does the form say so.
 */
export async function requestDemoAction(_prev: DemoState, formData: FormData): Promise<DemoState> {
  const values = Object.fromEntries(
    ["name", "email", "organization", "size", "message"].map((key) => [
      key,
      String(formData.get(key) ?? ""),
    ]),
  );
  const fail = (error: string): DemoState => ({ error, values });
  const parsed = demoSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    organization: formData.get("organization"),
    size: formData.get("size"),
    message: formData.get("message") || undefined,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form");
  // A filled honeypot is a bot: it sees the same next page, and nothing is sent or saved.
  if (String(formData.get(DEMO_HONEYPOT) ?? "").trim() !== "") {
    redirect(startHref(Boolean(await getSession())));
  }

  const limit = await checkRateLimit(
    rateLimitKey("demo-ip", await getClientIp()),
    PER_IP.limit,
    PER_IP.windowSec,
  );
  if (!limit.allowed) return fail("Too many requests from here. Try again in an hour.");
  const [byEmail, siteWide] = await Promise.all([
    checkRateLimit(
      rateLimitKey("demo-email", parsed.data.email),
      PER_EMAIL.limit,
      PER_EMAIL.windowSec,
    ),
    checkRateLimit(rateLimitKey("demo-all", "all"), SITE_WIDE.limit, SITE_WIDE.windowSec),
  ]);
  const sendEmail = byEmail.allowed && siteWide.allowed;

  const inbox = process.env.DEMO_REQUEST_INBOX || DEFAULT_INBOX;
  const { name, email, organization, size, message } = parsed.data;
  const rows = [
    `Name: ${name}`,
    `Work email: ${email}`,
    `Organization: ${organization}`,
    `Team size: ${size}`,
    ...(message ? [`Message: ${message}`] : []),
  ];
  let emailedAt: Date | null = null;
  if (sendEmail) {
    try {
      await getPlatformMailer().send({
        to: inbox,
        ...layout({
          subject: `Demo request: ${organization} (${size})`,
          eyebrow: "New demo request",
          bodyHtml: rows.map(paragraph).join(""),
          bodyText: rows.join("\n"),
          footer: `Reply to ${email} to set up the 15-minute call.`,
        }),
      });
      emailedAt = new Date();
    } catch (error) {
      console.error("[demo] could not send", error instanceof Error ? error.message : error);
    }
  }

  let saved = false;
  try {
    await saveDemoRequest({
      name,
      email,
      organization,
      teamSize: size,
      message: message ?? null,
      emailedAt,
    });
    saved = true;
  } catch (error) {
    console.error("[demo] could not save", error instanceof Error ? error.message : error);
  }
  if (!saved && !emailedAt) return fail("We couldn't send that just now. Try again in a minute.");

  await trackServer(FUNNEL_EVENTS.demoRequested, { size });
  redirect(startHref(Boolean(await getSession())));
}
