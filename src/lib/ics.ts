export interface IcsEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  updatedAt: Date;
}

function formatUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Escapes text per RFC 5545 (backslash, comma, semicolon, newline). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");
}

function foldLine(line: string): string {
  // RFC 5545 lines must be folded at 75 octets; a simple char-based
  // approximation is fine here since our content is ASCII-safe after escaping.
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}

function buildVEvent(event: IcsEvent): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@cbc-portal`,
    `DTSTAMP:${formatUtc(event.updatedAt)}`,
    event.allDay
      ? `DTSTART;VALUE=DATE:${formatDateOnly(event.startsAt)}`
      : `DTSTART:${formatUtc(event.startsAt)}`,
    event.allDay
      ? `DTEND;VALUE=DATE:${formatDateOnly(event.endsAt)}`
      : `DTEND:${formatUtc(event.endsAt)}`,
    `SUMMARY:${escapeText(event.title)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  lines.push("END:VEVENT");
  return lines.map(foldLine).join("\r\n");
}

export function buildIcsCalendar(events: IcsEvent[], calendarName = "CBC Portal"): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CBC Portal//Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    ...events.map(buildVEvent),
    "END:VCALENDAR",
  ].join("\r\n");
}
