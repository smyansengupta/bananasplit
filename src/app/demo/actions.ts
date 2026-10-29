"use server";

import { z } from "zod";

import { FUNNEL_EVENTS } from "@/lib/analytics/events";
import { trackServer } from "@/lib/analytics/server";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
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
  sent?: boolean;
  /** What was typed, sent back with an error so the form keeps it. */
  values?: Record<string, string>;
}

/** Five requests an hour from one network is plenty for a real person. */
const PER_IP = { limit: 5, windowSec: 60 * 60 };

/**
 * "Request a demo": emails the request to DEMO_REQUEST_INBOX through the
 * platform sender (in local development, the mail sink in .data/mail), and
 * records the funnel event with the team size only. Without an inbox set it
 * says so instead of pretending to send.
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

  const limit = await checkRateLimit(
    rateLimitKey("demo-ip", await getClientIp()),
    PER_IP.limit,
    PER_IP.windowSec,
  );
  if (!limit.allowed) return fail("Too many requests from here. Try again in an hour.");

  const inbox = process.env.DEMO_REQUEST_INBOX;
  if (!inbox) {
    console.error("[demo] DEMO_REQUEST_INBOX is not set; the request was not sent");
    return fail("Demo requests aren't switched on yet. Please try again soon.");
  }

  const { name, email, organization, size, message } = parsed.data;
  const rows = [
    `Name: ${name}`,
    `Work email: ${email}`,
    `Organization: ${organization}`,
    `Team size: ${size}`,
    ...(message ? [`Message: ${message}`] : []),
  ];
  try {
    await getPlatformMailer().send({
      to: inbox,
      ...layout({
        subject: `Demo request: ${organization} (${size})`,
        eyebrow: "New demo request",
        bodyHtml: rows.map(paragraph).join(""),
        bodyText: rows.join("\n"),
        footer: `Reply to ${email} to set up the demo.`,
      }),
    });
  } catch (error) {
    console.error("[demo] could not send", error instanceof Error ? error.message : error);
    return fail("We couldn't send that just now. Please try again in a minute.");
  }

  await trackServer(FUNNEL_EVENTS.demoRequested, { size });
  return { sent: true };
}
