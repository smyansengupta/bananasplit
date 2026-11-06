import { greetingName, looksLikeLink, plainForEmail, withHost } from "@/lib/booking/guest";
import { reminderLead } from "@/lib/meetings/reminders";
import { escapeHtml, safeHref } from "@/server/email/escape";
import { layout, paragraph, type RenderedEmail } from "@/server/email/templates";

import type { GuestTemplate } from "./notify";

/**
 * The guest's emails (docs/features/booking.md). Every one is a fixed
 * message about the booking they made: nothing the guest typed is repeated
 * except a first name that looks like one (greetingName), so the page can't
 * be used to send someone else's words to an address. The booking
 * confirmation asks them to say the address is theirs (a button on their
 * booking page, not a link that does it, so mail scanners can't).
 */

export interface GuestEmailInput {
  template: GuestTemplate;
  guestName: string;
  title: string;
  hostName: string;
  orgName: string;
  when: string;
  durationMin: number;
  verified: boolean;
  joinUrl: string | null;
  location: string | null;
  /** A video account is making the meeting's link and it isn't there yet. */
  linkPending?: boolean;
  /**
   * The join link came from a connected video account (Meet, Zoom, Teams),
   * not typed by the link's maker. Only such a link is put in the email; a
   * typed one is on the guest's booking page.
   */
  joinFromAccount?: boolean;
  manageUrl: string;
  calendarUrl: string;
  offsetMinutes?: number;
}

function row(label: string, valueHtml: string): string {
  return `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;font-size:12px;color:#6b6b6b;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;vertical-align:top">${valueHtml}</td></tr>`;
}

export function guestEmail(raw: GuestEmailInput): RenderedEmail {
  // What the link's maker typed reaches a stranger's inbox from our sender:
  // only as plain words, never a link they chose.
  const i = {
    ...raw,
    title: plainForEmail(raw.title, 80) || "Your meeting",
    hostName: plainForEmail(raw.hostName, 60) || "your host",
    orgName: plainForEmail(raw.orgName, 60),
    joinUrl: raw.joinFromAccount === false ? null : raw.joinUrl,
    location: raw.location && !looksLikeLink(raw.location) ? plainForEmail(raw.location, 120) : null,
    linkPending: raw.linkPending || (raw.joinFromAccount === false && Boolean(raw.joinUrl)),
  };
  const typedPlace = Boolean(raw.location && !i.location);
  const who = withHost(i.title, i.hostName);
  const cancelled = i.template === "cancelled";
  const subject = {
    booked: i.verified ? `Booked: ${who}` : `Confirm your time: ${who}`,
    moved: `Moved: ${who}`,
    cancelled: `Cancelled: ${who}`,
    reminder: `Reminder: ${who}`,
    "host-changed": `New host: ${i.title}`,
  }[i.template];
  const lead = {
    booked: i.verified
      ? `You're booked with ${i.hostName} of ${i.orgName}.`
      : `You're booked with ${i.hostName} of ${i.orgName}. Please confirm this is your email so it's all set.`,
    moved: `Your time with ${i.hostName} moved. Here's the new time.`,
    cancelled: `Your time with ${i.hostName} of ${i.orgName} is cancelled. You don't need to do anything.`,
    reminder:
      i.offsetMinutes && reminderLead(i.offsetMinutes) === "tomorrow"
        ? `A reminder: you meet ${i.hostName} tomorrow.`
        : `A reminder: you meet ${i.hostName} ${i.offsetMinutes ? reminderLead(i.offsetMinutes) : "soon"}.`,
    "host-changed": `You'll meet ${i.hostName} of ${i.orgName} instead. The time is the same.`,
  }[i.template];
  const rows = [row("When", escapeHtml(`${i.when} (${i.durationMin} minutes)`))];
  const text = [`When: ${i.when} (${i.durationMin} minutes)`];
  if (!cancelled && i.joinUrl) {
    rows.push(row("Online", `<a href="${safeHref(i.joinUrl)}" style="color:#111">Join the meeting</a>`));
    text.push(`Join: ${i.joinUrl}`);
  } else if (!cancelled && i.location) {
    rows.push(row("Where", escapeHtml(i.location)));
    text.push(`Where: ${i.location}`);
  } else if (!cancelled && i.linkPending) {
    rows.push(row("Online", "The join link will be on your booking page."));
    text.push("The join link will be on your booking page.");
  } else if (!cancelled && typedPlace) {
    rows.push(row("Where", "On your booking page."));
    text.push("Where: on your booking page.");
  } else if (!cancelled) {
    const how = `${i.hostName.split(" ")[0]} will let you know how to join.`;
    rows.push(row("Where", escapeHtml(how)));
    text.push(`Where: ${how}`);
  }
  if (!cancelled) {
    rows.push(row("Calendar", `<a href="${safeHref(i.calendarUrl)}" style="color:#111">Add to calendar</a>`));
    text.push(`Add to calendar: ${i.calendarUrl}`);
    rows.push(row("Plans changed", `<a href="${safeHref(i.manageUrl)}" style="color:#111">Move or cancel</a>`));
    text.push(`Move or cancel: ${i.manageUrl}`);
  }
  const first = greetingName(i.guestName);
  const greeting = first ? `Hi ${first},` : "Hi,";
  const details = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;width:100%;border:1px solid #e5e5e5;border-radius:12px"><tr><td style="padding:12px 16px"><table role="presentation" cellpadding="0" cellspacing="0">${rows.join("")}</table></td></tr></table>`;
  const confirm = i.template === "booked" && !i.verified;
  return layout({
    subject,
    bodyHtml: [
      `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">${escapeHtml(who)}</h1>`,
      paragraph(greeting),
      paragraph(lead),
      details,
    ].join(""),
    bodyText: [who, greeting, lead, text.join("\n")].join("\n\n"),
    cta: cancelled
      ? undefined
      : confirm
        ? { label: "Confirm it's me", url: i.manageUrl }
        : i.template === "reminder" && i.joinUrl
          ? { label: "Join the meeting", url: i.joinUrl }
          : { label: "See your booking", url: i.manageUrl },
    footer: `You're getting this because this address was used to book a time with ${i.orgName} on Bananasplit. Didn't book it? Cancel it from the link above.`,
  });
}
