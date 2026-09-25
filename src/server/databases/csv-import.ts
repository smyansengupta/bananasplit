import { TZDate } from "@date-fns/tz";

import { AttendanceMethod, RecordSource, SignupSource, type Prisma } from "@/generated/prisma/client";
import { writeOrgAuditLog } from "@/server/audit";
import type { TxClient } from "@/server/db/context";
import { cleanName, normalizeEmail } from "@/server/sync/supabase-map";

import { resolveContacts } from "@/server/sync/apply";

import { newId } from "./admin";
import { termOf } from "./format";
import { afterDataChange } from "./rollups";

/**
 * CSV import for orgs without the website sync (Phase 4b): Attendance and
 * Signups. The file is parsed in memory (never stored), previewed, then
 * committed in ONE transaction of at most MAX_IMPORT_ROWS rows, with the
 * rollups refreshed at the end. Imported rows are suite-side (RecordSource
 * CSV): admins can edit and delete them.
 */

export const MAX_IMPORT_ROWS = 5000;

/** RFC 4180 parsing: quoted fields, doubled quotes, CRLF or LF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** A spreadsheet export may prefix text with ' (formula guard): strip it. */
function clean(value: string | undefined): string {
  const v = (value ?? "").trim();
  return v.startsWith("'") ? v.slice(1) : v;
}

function header(rows: string[][]): Map<string, number> {
  const map = new Map<string, number>();
  (rows[0] ?? []).forEach((h, i) => map.set(clean(h).toLowerCase().replace(/[\s-]+/g, "_"), i));
  return map;
}

function pick(row: string[], cols: Map<string, number>, ...names: string[]): string {
  for (const n of names) {
    const i = cols.get(n);
    if (i !== undefined) return clean(row[i]);
  }
  return "";
}

/** "2026-09-16 18:05", "2026-09-16T18:05", "2026-09-16" (org-local), or an ISO time with an offset. */
export function parseLocalDateTime(value: string, timezone: string): Date | null {
  const v = value.trim();
  if (!v) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(v);
  if (!m) return null;
  const d = new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), timezone || "UTC");
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime());
}

export interface ImportIssue {
  line: number;
  message: string;
}

export interface ImportPreview<T> {
  rows: T[];
  issues: ImportIssue[];
  total: number;
}

/**
 * Contacts for many rows at once (a handful of queries, whatever the file
 * size): by address through the sync's resolver (existing contacts reused,
 * new ones created with the masked address and a link to the member whose
 * verified email it is); rows with only a name get a new contact each.
 */
async function contactsFor(
  db: TxClient,
  organizationId: string,
  timezone: string,
  people: { email: string | null; name: string | null; at: Date }[],
): Promise<(string | null)[]> {
  const members = await db.membership.findMany({
    where: { organizationId },
    select: { userId: true, user: { select: { email: true, emailVerified: true } } },
  });
  const memberEmails = new Map<string, string>();
  for (const m of members) {
    if (m.user.emailVerified && m.user.email) memberEmails.set(m.user.email.trim().toLowerCase(), m.userId);
  }
  const byEmail = await resolveContacts(
    db,
    { organizationId, timezone, creatorId: "", memberEmails },
    people.filter((p) => p.email).map((p) => ({ email: p.email as string, name: p.name, at: p.at })),
  );
  const nameOnly: Prisma.ContactCreateManyInput[] = [];
  const ids = people.map((p) => {
    if (p.email) return byEmail.get(p.email) ?? null;
    if (!p.name) return null;
    const id = newId("ct_");
    nameOnly.push({ id, organizationId, displayName: p.name, firstSeenAt: p.at });
    return id;
  });
  if (nameOnly.length) await db.contact.createMany({ data: nameOnly });
  return ids;
}

// ---- Attendance -------------------------------------------------------------------

export interface AttendanceImportRow {
  line: number;
  eventId: string;
  eventLabel: string;
  email: string | null;
  name: string | null;
  checkedInAt: Date | null;
  method: AttendanceMethod;
}

const METHODS: Record<string, AttendanceMethod> = {
  qr: AttendanceMethod.QR,
  link: AttendanceMethod.QR,
  form: AttendanceMethod.FORM,
  code: AttendanceMethod.FORM,
  manual: AttendanceMethod.MANUAL,
  officer: AttendanceMethod.MANUAL,
};

/**
 * Columns: session (a Session id, or its exact title), email and/or name,
 * optional checked_in_at (org-local) and method (qr, form, manual).
 */
export async function previewAttendance(
  db: TxClient,
  organizationId: string,
  timezone: string,
  text: string,
): Promise<ImportPreview<AttendanceImportRow>> {
  const rows = parseCsv(text);
  const cols = header(rows);
  const issues: ImportIssue[] = [];
  if (!cols.has("session") && !cols.has("session_id") && !cols.has("event_id")) {
    return { rows: [], total: 0, issues: [{ line: 1, message: "Add a session column (the session's id or exact title)." }] };
  }
  const body = rows.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    return { rows: [], total: body.length, issues: [{ line: 1, message: `At most ${MAX_IMPORT_ROWS} rows per file.` }] };
  }
  const events = await db.event.findMany({
    where: { organizationId, deletedAt: null, mergedIntoId: null },
    select: { id: true, title: true, startsAt: true },
  });
  const byId = new Map(events.map((e) => [e.id, e]));
  const byTitle = new Map<string, typeof events>();
  for (const e of events) {
    const k = e.title.trim().toLowerCase();
    byTitle.set(k, [...(byTitle.get(k) ?? []), e]);
  }
  const out: AttendanceImportRow[] = [];
  body.forEach((row, idx) => {
    const line = idx + 2;
    const sessionRef = pick(row, cols, "session_id", "event_id", "session");
    const event = byId.get(sessionRef) ?? (byTitle.get(sessionRef.toLowerCase())?.length === 1 ? byTitle.get(sessionRef.toLowerCase())![0] : undefined);
    if (!event) {
      issues.push({
        line,
        message: byTitle.get(sessionRef.toLowerCase())?.length
          ? `"${sessionRef.slice(0, 60)}" matches several sessions; use the session id.`
          : `No session "${sessionRef.slice(0, 60)}".`,
      });
      return;
    }
    const rawEmail = pick(row, cols, "email", "email_address");
    const email = rawEmail ? normalizeEmail(rawEmail) : null;
    if (rawEmail && !email) {
      issues.push({ line, message: "The email is not an address." });
      return;
    }
    const name = cleanName(pick(row, cols, "name", "full_name"));
    if (!email && !name) {
      issues.push({ line, message: "Each row needs an email or a name." });
      return;
    }
    const whenRaw = pick(row, cols, "checked_in_at", "check_in_time", "time", "date");
    const checkedInAt = whenRaw ? parseLocalDateTime(whenRaw, timezone) : null;
    if (whenRaw && !checkedInAt) {
      issues.push({ line, message: `Unreadable check-in time "${whenRaw.slice(0, 40)}".` });
      return;
    }
    const methodRaw = pick(row, cols, "method", "source").toLowerCase();
    if (methodRaw && !METHODS[methodRaw]) {
      issues.push({ line, message: `Method is qr, form or manual (got "${methodRaw.slice(0, 20)}").` });
      return;
    }
    out.push({
      line,
      eventId: event.id,
      eventLabel: event.title,
      email,
      name,
      checkedInAt,
      method: methodRaw ? METHODS[methodRaw] : AttendanceMethod.MANUAL,
    });
  });
  return { rows: out, issues, total: body.length };
}

export async function commitAttendance(
  db: TxClient,
  organizationId: string,
  timezone: string,
  userId: string,
  preview: ImportPreview<AttendanceImportRow>,
): Promise<{ created: number; skipped: number }> {
  const events = new Map(
    (
      await db.event.findMany({
        where: { organizationId, id: { in: [...new Set(preview.rows.map((r) => r.eventId))] } },
        select: { id: true, term: true, startsAt: true },
      })
    ).map((e) => [e.id, e]),
  );
  const contactIds = await contactsFor(
    db,
    organizationId,
    timezone,
    preview.rows.map((r) => ({ email: r.email, name: r.name, at: r.checkedInAt ?? events.get(r.eventId)?.startsAt ?? new Date() })),
  );
  const contacts: string[] = [];
  const data: Prisma.AttendanceCreateManyInput[] = [];
  const seen = new Set<string>();
  preview.rows.forEach((r, i) => {
    const event = events.get(r.eventId);
    const contactId = contactIds[i];
    if (!event || !contactId) return;
    const key = `${event.id}:${contactId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const at = r.checkedInAt ?? event.startsAt;
    contacts.push(contactId);
    data.push({
      id: newId("att_"),
      organizationId,
      eventId: event.id,
      contactId,
      term: event.term ?? termOf(at, timezone),
      checkedInAt: at,
      method: r.method,
      nameAsEntered: r.name,
      source: RecordSource.CSV,
      createdById: userId,
    });
  });
  const created = data.length ? (await db.attendance.createMany({ data, skipDuplicates: true })).count : 0;
  await writeOrgAuditLog(db, {
    organizationId,
    action: "attendance.imported",
    targetType: "Attendance",
    diff: { rows: preview.total, created, skipped: preview.total - created },
  });
  await afterDataChange(db, organizationId, contacts);
  return { created, skipped: preview.total - created };
}

// ---- Signups ------------------------------------------------------------------------

export interface SignupImportRow {
  line: number;
  email: string | null;
  name: string;
  classYear: string | null;
  signedUpAt: Date;
  term: string;
  answers: { colleges: string[]; meet_days: string[]; interests: string[] };
}

function list(value: string): string[] {
  return value
    .split(/[;|]/)
    .map((v) => v.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter((v) => /^[a-z0-9_]{1,32}$/.test(v))
    .slice(0, 16);
}

/**
 * Columns: name, email, optional class_year, signed_up_at (org-local; the
 * term follows from it unless a term column says fall-YYYY/spring-YYYY),
 * colleges, meet_days and interests (separated by ; or |).
 */
export function previewSignups(timezone: string, text: string, now = new Date()): ImportPreview<SignupImportRow> {
  const rows = parseCsv(text);
  const cols = header(rows);
  const issues: ImportIssue[] = [];
  if (!cols.has("name") && !cols.has("full_name")) {
    return { rows: [], total: 0, issues: [{ line: 1, message: "Add a name column." }] };
  }
  const body = rows.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    return { rows: [], total: body.length, issues: [{ line: 1, message: `At most ${MAX_IMPORT_ROWS} rows per file.` }] };
  }
  const out: SignupImportRow[] = [];
  body.forEach((row, idx) => {
    const line = idx + 2;
    const name = cleanName(pick(row, cols, "name", "full_name"));
    if (!name) {
      issues.push({ line, message: "Each row needs a name." });
      return;
    }
    const rawEmail = pick(row, cols, "email", "email_address");
    const email = rawEmail ? normalizeEmail(rawEmail) : null;
    if (rawEmail && !email) {
      issues.push({ line, message: "The email is not an address." });
      return;
    }
    const whenRaw = pick(row, cols, "signed_up_at", "signup_date", "created_at", "date");
    const signedUpAt = whenRaw ? parseLocalDateTime(whenRaw, timezone) : now;
    if (!signedUpAt) {
      issues.push({ line, message: `Unreadable signup date "${whenRaw.slice(0, 40)}".` });
      return;
    }
    const termRaw = pick(row, cols, "term").toLowerCase();
    if (termRaw && !/^(fall|spring)-\d{4}$/.test(termRaw)) {
      issues.push({ line, message: "Term is fall-YYYY or spring-YYYY." });
      return;
    }
    const year = pick(row, cols, "class_year", "year").toLowerCase().replace(/\s+/g, "_");
    out.push({
      line,
      name,
      email,
      classYear: year ? year.slice(0, 32) : null,
      signedUpAt,
      term: termRaw || termOf(signedUpAt, timezone),
      answers: {
        colleges: list(pick(row, cols, "colleges", "college")),
        meet_days: list(pick(row, cols, "meet_days", "days")),
        interests: list(pick(row, cols, "interests")),
      },
    });
  });
  return { rows: out, issues, total: body.length };
}

export async function commitSignups(
  db: TxClient,
  organizationId: string,
  timezone: string,
  preview: ImportPreview<SignupImportRow>,
): Promise<{ created: number; skipped: number }> {
  const contactIds = await contactsFor(
    db,
    organizationId,
    timezone,
    preview.rows.map((r) => ({ email: r.email, name: r.name, at: r.signedUpAt })),
  );
  const contacts: string[] = [];
  const data: Prisma.SignupCreateManyInput[] = [];
  const seen = new Set<string>();
  preview.rows.forEach((r, i) => {
    const contactId = contactIds[i];
    if (!contactId) return;
    const key = `${contactId}:${r.term}`;
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push(contactId);
    data.push({
      id: newId("sg_"),
      organizationId,
      contactId,
      term: r.term,
      channel: SignupSource.CSV,
      classYear: r.classYear,
      signedUpAt: r.signedUpAt,
      answers: r.answers,
      recordSource: RecordSource.CSV,
    });
  });
  const created = data.length ? (await db.signup.createMany({ data, skipDuplicates: true })).count : 0;
  await writeOrgAuditLog(db, {
    organizationId,
    action: "signup.imported",
    targetType: "Signup",
    diff: { rows: preview.total, created, skipped: preview.total - created },
  });
  await afterDataChange(db, organizationId, contacts);
  return { created, skipped: preview.total - created };
}
