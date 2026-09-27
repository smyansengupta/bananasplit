/**
 * Labels for the availability poll screens. Day keys ("YYYY-MM-DD") are
 * printed as dates with no clock shift; instants are printed in the zone the
 * grid is drawn in, so a label never disagrees with the cell it names.
 *
 * Every label is rendered on the server and again in the browser, whose ICU
 * data differ in their spacing (Node puts a narrow no-break space before "PM"
 * and thin spaces around a range's dash; Chrome doesn't). `plain()` folds
 * those into ordinary spaces so the two agree and hydration doesn't fail.
 */

const ODD_SPACES = /[\u00a0\u2009\u202f]/g;

export function plain(text: string): string {
  return text.replace(ODD_SPACES, " ");
}

const dayFormats = {
  weekday: new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }),
  date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
  long: new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }),
  month: new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }),
};

function keyToUtc(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00Z`);
}

/** "Tue", "Sep 30", and the month ("Sep") and day ("30") apart, for a grid column header. */
export function dayHeader(dayKey: string): {
  weekday: string;
  date: string;
  month: string;
  day: string;
} {
  const d = keyToUtc(dayKey);
  return {
    weekday: plain(dayFormats.weekday.format(d)),
    date: plain(dayFormats.date.format(d)),
    month: plain(dayFormats.month.format(d)),
    day: String(d.getUTCDate()),
  };
}

/** "Tue, Sep 30". */
export function dayLabel(dayKey: string): string {
  return plain(dayFormats.long.format(keyToUtc(dayKey)));
}

/** "9 AM" on the hour, "9:30 AM" otherwise, for an "HH:mm" time of day. */
export function timeOfDayLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(Date.UTC(2020, 0, 1, h, m));
  return plain(
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      ...(m === 0 ? {} : { minute: "2-digit" }),
      timeZone: "UTC",
    }).format(d),
  );
}

const rangeFormats = new Map<string, { day: Intl.DateTimeFormat; time: Intl.DateTimeFormat }>();

function rangeFormat(timeZone: string) {
  let f = rangeFormats.get(timeZone);
  if (!f) {
    f = {
      day: new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone,
      }),
      time: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone }),
    };
    rangeFormats.set(timeZone, f);
  }
  return f;
}

/** "Tue, Sep 30" and "10:30 AM – 12:00 PM" for an interval in `timeZone`. */
export function intervalParts(
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
): { day: string; time: string } {
  const f = rangeFormat(timeZone);
  const time =
    typeof f.time.formatRange === "function"
      ? f.time.formatRange(startsAt, endsAt)
      : `${f.time.format(startsAt)} – ${f.time.format(endsAt)}`;
  return { day: plain(f.day.format(startsAt)), time: plain(time) };
}

/** "Tue, Sep 30, 10:30 AM – 12:00 PM". */
export function intervalLabel(startsAt: Date, endsAt: Date, timeZone: string): string {
  const { day, time } = intervalParts(startsAt, endsAt, timeZone);
  return `${day}, ${time}`;
}

/** "Oct 2, 4:28 PM" in `timeZone`. */
export function momentLabel(at: Date, timeZone: string): string {
  return plain(
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(at),
  );
}

/**
 * A zone as people say it: "Eastern Time (New York)", or "UTC". Falls back
 * to the IANA name where the runtime has no generic name for it.
 */
export function timeZoneDisplayName(timeZone: string, at: Date = new Date()): string {
  if (timeZone === "UTC" || timeZone === "Etc/UTC") return "UTC";
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  try {
    const name = new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: "longGeneric" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (name && !/^GMT[+-]/.test(name)) return plain(`${name} (${city})`);
  } catch {
    // Older runtimes: no longGeneric.
  }
  return timeZone.replace(/_/g, " ");
}
