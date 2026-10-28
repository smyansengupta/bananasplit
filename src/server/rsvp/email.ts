import { escapeHtml, safeHref } from "@/server/email/escape";
import { EMAIL_COLORS as C, layout, paragraph, type RenderedEmail } from "@/server/email/templates";
import { reminderLead } from "@/lib/meetings/reminders";
import { mapsSearchUrl } from "@/lib/rsvp/format";

import type { RsvpEmailTemplate } from "./service";

/**
 * The emails a guest gets from an RSVP page, and the reminder text. Every
 * value is escaped by the shared layout helpers; links are absolute
 * (appUrl) and passed through safeHref.
 */

export interface RsvpMessageInput {
  template: RsvpEmailTemplate;
  /** A "reminder": how many minutes before the start it goes out. */
  offsetMinutes?: number;
  guestName: string;
  orgName: string;
  title: string;
  /** "Thursday, October 15, 6:00 – 7:00 PM EDT". */
  when: string;
  /** "6:00 PM", for a reminder under a day out. */
  startTime: string;
  /** Null when the host hides it from this guest (guestPlace). */
  location: string | null;
  locationDetails: string | null;
  /** The online meeting link, for a guest who is going (guestPlace). */
  joinUrl: string | null;
  /** The page, signed in as this guest (their manage link). */
  pageUrl: string;
  /** Their ticket (the QR a host scans), while they're going. */
  ticketUrl?: string | null;
  /** Their own invite link. */
  inviteUrl?: string | null;
  /** Split the cost: "$4 to the host: Venmo @maya, Cash App $maya". */
  chipIn?: string | null;
}

/**
 * Where the event is, as one guest's email may tell it: the same rule as
 * the page. The online meeting link goes only to someone going, and when
 * the host hides the address, it and the directions go only to someone
 * going too (not the waitlist, not a guest who isn't going anymore).
 */
export function guestPlace(
  event: {
    location: string | null;
    locationDetails: string | null;
    hideLocation: boolean;
    joinUrl: string | null;
  },
  going: boolean,
): Pick<RsvpMessageInput, "location" | "locationDetails" | "joinUrl"> {
  const showWhere = going || !event.hideLocation;
  return {
    location: showWhere ? event.location : null,
    locationDetails: showWhere ? event.locationDetails : null,
    joinUrl: going ? event.joinUrl : null,
  };
}

/**
 * How far off a reminder says the event is, in reminderLead's words ("in an
 * hour", "tomorrow", "in 2 days"). A reminder a day or more out names the
 * day rather than the time: an all-day event has no start time to give.
 */
function reminderWords(i: RsvpMessageInput): { lead: string; dayOrMore: boolean } {
  const offset = i.offsetMinutes ?? 60;
  return { lead: reminderLead(offset), dayOrMore: offset >= 1440 };
}

const COPY: Record<
  RsvpEmailTemplate,
  {
    subject: (title: string, i: RsvpMessageInput) => string;
    lead: (i: RsvpMessageInput) => string;
    cta: string;
  }
> = {
  registered: {
    subject: (t) => `You're going: ${t}`,
    lead: (i) => `You're on the list for ${i.title}. See you there!`,
    cta: "View your RSVP",
  },
  waitlisted: {
    subject: (t) => `You're on the waitlist: ${t}`,
    lead: (i) =>
      `${i.title} is full right now, so you're on the waitlist. If a spot opens up, it's yours and we'll email you straight away.`,
    cta: "View your RSVP",
  },
  promoted: {
    subject: (t) => `A spot opened up: you're going to ${t}`,
    lead: (i) => `Good news: a spot opened up at ${i.title}, and it's yours. You're going.`,
    cta: "View your RSVP",
  },
  reminder: {
    subject: (t, i) => {
      const { lead, dayOrMore } = reminderWords(i);
      if (lead === "tomorrow") return `Tomorrow: ${t}`;
      return dayOrMore ? `Coming up ${lead}: ${t}` : `Starting ${lead}: ${t}`;
    },
    lead: (i) => {
      const { lead, dayOrMore } = reminderWords(i);
      return dayOrMore
        ? `A reminder that ${i.title} is ${lead}.`
        : `${i.title} starts ${lead}, at ${i.startTime}. Here's how to find it.`;
    },
    cta: "View event",
  },
  "event-cancelled": {
    subject: (t) => `Cancelled: ${t}`,
    lead: (i) =>
      `${i.orgName} cancelled ${i.title}. You don't need to do anything; we're sorry for the change of plans.`,
    cta: "",
  },
};

function detailRow(label: string, valueHtml: string): string {
  return `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;font-size:12px;color:${C.muted};white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;vertical-align:top">${valueHtml}</td></tr>`;
}

export function rsvpEmail(input: RsvpMessageInput): RenderedEmail {
  const copy = COPY[input.template];
  const cancelled = input.template === "event-cancelled";
  const rows: string[] = [detailRow("When", escapeHtml(input.when))];
  const text: string[] = [`When: ${input.when}`];
  if (input.location) {
    rows.push(
      detailRow(
        "Where",
        `${escapeHtml(input.location)}<br><a href="${safeHref(mapsSearchUrl(input.location))}" style="color:${C.ink}">Open in Google Maps</a>`,
      ),
    );
    text.push(`Where: ${input.location} (${mapsSearchUrl(input.location)})`);
  }
  if (input.locationDetails && !cancelled) {
    rows.push(detailRow("Finding it", escapeHtml(input.locationDetails).replace(/\n/g, "<br>")));
    text.push(`Finding it: ${input.locationDetails}`);
  }
  if (input.joinUrl && !cancelled) {
    rows.push(
      detailRow(
        "Online",
        `<a href="${safeHref(input.joinUrl)}" style="color:${C.ink}">Join the meeting</a>`,
      ),
    );
    text.push(`Online: ${input.joinUrl}`);
  }
  if (input.chipIn && !cancelled) {
    rows.push(detailRow("Chip in", escapeHtml(input.chipIn)));
    text.push(`Chip in: ${input.chipIn}`);
  }
  if (input.ticketUrl && !cancelled) {
    rows.push(
      detailRow(
        "Ticket",
        `<a href="${safeHref(input.ticketUrl)}" style="color:${C.ink}">Show this at the door</a>`,
      ),
    );
    text.push(`Ticket (show it at the door): ${input.ticketUrl}`);
  }
  if (input.inviteUrl && !cancelled) {
    rows.push(
      detailRow(
        "Bring friends",
        `<a href="${safeHref(input.inviteUrl)}" style="color:${C.ink}">${escapeHtml(input.inviteUrl.replace(/^https?:\/\//, ""))}</a>`,
      ),
    );
    text.push(`Bring friends with your link: ${input.inviteUrl}`);
  }

  const details = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;width:100%;background:${C.page};border:1px solid ${C.line};border-radius:12px"><tr><td style="padding:12px 16px"><table role="presentation" cellpadding="0" cellspacing="0">${rows.join("")}</table></td></tr></table>`;
  const greeting = `Hi ${input.guestName.trim().split(/\s+/)[0] || "there"},`;

  return layout({
    subject: copy.subject(input.title, input),
    eyebrow: input.orgName,
    bodyHtml: [
      `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">${escapeHtml(input.title)}</h1>`,
      paragraph(greeting),
      paragraph(copy.lead(input)),
      details,
    ].join(""),
    bodyText: [input.title, greeting, copy.lead(input), text.join("\n")].join("\n\n"),
    cta: cancelled ? undefined : { label: copy.cta, url: input.pageUrl },
    footer: `You're getting this because you signed up for ${input.title} with ${input.orgName}. To cancel, open the event page and choose "Can't go".`,
  });
}

/** The reminder text (reminders only; the rest are email). */
export function rsvpText(input: RsvpMessageInput): string | null {
  if (input.template !== "reminder") return null;
  const where = input.location ? ` at ${input.location}` : input.joinUrl ? " online" : "";
  const { lead, dayOrMore } = reminderWords(input);
  if (dayOrMore) {
    return `Reminder: ${input.title} is ${lead}, ${input.when}${where}. Details: ${input.pageUrl}`;
  }
  const directions = input.locationDetails ? ` ${input.locationDetails}` : "";
  return `${input.title} starts ${lead} (${input.startTime})${where}.${directions} Details: ${input.pageUrl}`;
}
