import Link from "next/link";
import type { ReactNode } from "react";

import { deleteAttendanceAction, deleteSessionAction, deleteSignupAction, dismissReviewAction, setAttendanceSuppressedAction, setBallotSuppressedAction, setSignupsAddedAction, setSignupSuppressedAction } from "@/app/app/[orgSlug]/databases/actions";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { exclusionLabel } from "@/server/databases/ballot-definitions";
import type {
  AttendanceDetail,
  BallotDetail,
  ContactPanel,
  PersonDetail,
  SessionDetail,
  SignupDetail,
} from "@/server/databases/details";
import {
  CHANNEL_LABELS,
  EVENT_KIND_LABELS,
  fmtDate,
  fmtDateTime,
  METHOD_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  termLabel,
} from "@/server/databases/format";
import { signupLabel } from "@/server/sync/supabase-map";

import { ActionButton } from "./action-button";
import { ContactActions } from "./contact-actions";
import { MergeSessionPicker } from "./merge-session-picker";
import { NameOverrideForm } from "./name-override-form";
import { SessionFormDialog, type SessionFormInitial } from "./session-form-dialog";

/**
 * Row drawer panels (server components). Admin controls appear only for
 * OWNER/ADMIN on databases that allow edits; the actions check again, and
 * RLS decides what every panel can read.
 */

export interface PanelContext {
  organizationId: string;
  orgSlug: string;
  timezone: string;
  canEdit: boolean;
  members: { id: string; name: string | null }[];
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? "—"}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function PersonHeader({ panel }: { panel: ContactPanel }) {
  const c = panel.contact;
  const name = c.user?.name ?? c.displayName ?? c.emailMasked ?? "Unknown";
  return (
    <div className="flex items-center gap-3">
      <UserAvatar user={c.user ?? { name }} size="lg" />
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        <p className="text-muted-foreground text-xs">
          {c.emails[0]?.emailNormalized ?? c.emailMasked ?? "No email on file"}
          {c.userId && " · member account"}
          {c.unsubscribedAt && " · unsubscribed"}
        </p>
      </div>
    </div>
  );
}

/** The stamp card of a term: the term's sessions, stamped where the person checked in. */
export function StampStrip({
  strip,
  timezone,
}: {
  strip: { slot: number; title: string; startsAt: Date; stamped: boolean }[];
  timezone: string;
}) {
  if (strip.length === 0) return <p className="text-muted-foreground text-sm">No sessions this term yet.</p>;
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Stamp card">
      {strip.map((s, i) => (
        <li
          key={`${s.slot}-${i}`}
          title={`${s.title} · ${fmtDate(s.startsAt, timezone)}`}
          className={
            s.stamped
              ? "bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full text-xs font-semibold"
              : "text-muted-foreground flex size-9 items-center justify-center rounded-full border border-dashed text-xs"
          }
        >
          {s.slot}
          <span className="sr-only">{s.stamped ? " stamped" : " not stamped"}</span>
        </li>
      ))}
    </ol>
  );
}

function History({ panel, ctx }: { panel: ContactPanel; ctx: PanelContext }) {
  if (panel.history.length === 0) return <p className="text-muted-foreground text-sm">No check-ins visible to you.</p>;
  return (
    <ul className="divide-y rounded-md border text-sm">
      {panel.history.map((h) => (
        <li key={h.id} className={`flex items-center justify-between gap-2 px-3 py-1.5 ${h.suppressed ? "opacity-60" : ""}`}>
          <Link
            className="min-w-0 truncate underline-offset-4 hover:underline"
            href={`/app/${ctx.orgSlug}/databases/sessions?row=${encodeURIComponent(h.eventId)}`}
          >
            {h.eventTitle}
          </Link>
          <span className="text-muted-foreground shrink-0 text-xs">
            {fmtDate(h.checkedInAt, ctx.timezone)} · {METHOD_LABELS[h.method] ?? h.method}
            {h.stampNumber ? ` · stamp ${h.stampNumber}` : ""}
            {h.suppressed ? " · suppressed" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Terms({ panel }: { panel: ContactPanel }) {
  if (panel.terms.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {panel.terms.map((t) => (
        <Badge key={t.term} variant="outline">
          {termLabel(t.term)}: {t.sessionsAttended} sessions, {t.stampCount} stamps
        </Badge>
      ))}
    </div>
  );
}

function ContactTools({ panel, ctx }: { panel: ContactPanel; ctx: PanelContext }) {
  if (!ctx.canEdit) return null;
  return (
    <ContactActions
      organizationId={ctx.organizationId}
      contact={{
        id: panel.contact.id,
        displayName: panel.contact.displayName,
        userId: panel.contact.userId,
        emails: panel.contact.emails,
      }}
      members={ctx.members}
    />
  );
}

// ---- Sessions -----------------------------------------------------------------------

export function SessionPanel({
  detail,
  ctx,
  formInitial,
  mergeCandidates,
}: {
  detail: SessionDetail;
  ctx: PanelContext;
  formInitial: SessionFormInitial;
  mergeCandidates: { id: string; label: string }[];
}) {
  const e = detail.event;
  return (
    <>
      <dl className="space-y-1.5">
        <Field label="Type">{EVENT_KIND_LABELS[e.kind] ?? e.kind}</Field>
        <Field label="When">
          {fmtDateTime(e.startsAt, ctx.timezone)} – {fmtDateTime(e.endsAt, ctx.timezone)}
        </Field>
        <Field label="Location">{e.location}</Field>
        <Field label="Host">
          {e.host ? (
            <span className="inline-flex items-center gap-2">
              <UserAvatar user={e.host} size="xs" />
              {e.host.name}
            </span>
          ) : (
            e.hostName
          )}
        </Field>
        <Field label="Visibility">{e.visibility === "PUBLIC" ? "Public (website)" : "Internal"}</Field>
        <Field label="Term">{termLabel(e.term)}</Field>
        <Field label="Stamp slot">{e.stampSlot}</Field>
        <Field label="RSVP">
          {e.rsvpUrl && (
            <a href={e.rsvpUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
              {e.rsvpUrl}
            </a>
          )}
        </Field>
        <Field label="Calendar event">
          <Link className="text-primary underline-offset-4 hover:underline" href={`/app/${ctx.orgSlug}/calendar/${e.id}`}>
            Open in Calendar
          </Link>
          {e.googleHtmlLink && (
            <>
              {" · "}
              <a href={e.googleHtmlLink} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
                Google Calendar
              </a>
            </>
          )}
        </Field>
        <Field label="Website session">{e.sourceSessionId ? "Linked (synced)" : "Not linked"}</Field>
        {e.description && <Field label="Description">{e.description}</Field>}
      </dl>
      {e.needsReview && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          The website sync found more than one possible match for this session. Merge it into the right one, or mark it
          as not a duplicate.
        </p>
      )}
      {ctx.canEdit && (
        <div className="flex flex-wrap gap-2">
          <SessionFormDialog organizationId={ctx.organizationId} timezone={ctx.timezone} members={ctx.members} initial={formInitial} />
          {e.needsReview && (
            <ActionButton action={dismissReviewAction} args={[ctx.organizationId, e.id]}>Not a duplicate</ActionButton>
          )}
          <ActionButton
            variant="destructive"
            confirm="Delete this session? It also disappears from the calendar. Check-ins stay attached."
            action={deleteSessionAction} args={[ctx.organizationId, e.id]}
          >
            Delete
          </ActionButton>
        </div>
      )}
      {ctx.canEdit && (
        <MergeSessionPicker
          organizationId={ctx.organizationId}
          loserId={e.id}
          loserTitle={e.title}
          candidates={mergeCandidates}
        />
      )}
      <Section title={`Attendees (${detail.attendees.filter((a) => !a.suppressedAt).length})`}>
        {detail.attendees.length === 0 ? (
          <p className="text-muted-foreground text-sm">No check-ins visible to you.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {detail.attendees.map((a) => {
              const name = a.nameOverride ?? a.contact.user?.name ?? a.contact.displayName ?? a.contact.emailMasked ?? "Unknown";
              return (
                <li key={a.id} className={`flex items-center justify-between gap-2 px-3 py-1.5 ${a.suppressedAt ? "opacity-60" : ""}`}>
                  <Link
                    href={`/app/${ctx.orgSlug}/databases/attendance?row=${encodeURIComponent(a.id)}`}
                    className="flex min-w-0 items-center gap-2 underline-offset-4 hover:underline"
                  >
                    <UserAvatar user={a.contact.user ?? { name }} size="xs" />
                    <span className="truncate">{name}</span>
                  </Link>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {fmtDateTime(a.checkedInAt, ctx.timezone)} · {METHOD_LABELS[a.method] ?? a.method}
                    {a.stampNumber ? ` · stamp ${a.stampNumber}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {detail.links.length > 0 && (
        <Section title="Import links">
          <ul className="text-muted-foreground space-y-1 text-xs">
            {detail.links.map((l) => (
              <li key={l.id}>
                {l.source} · {l.method}
                {l.score !== null ? ` (score ${l.score})` : ""} · {fmtDateTime(l.createdAt, ctx.timezone)}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

// ---- Attendance --------------------------------------------------------------------------

export function AttendancePanel({ detail, ctx }: { detail: AttendanceDetail; ctx: PanelContext }) {
  const r = detail.row;
  const synced = r.source === "SUPABASE_SYNC";
  return (
    <>
      <PersonHeader panel={detail.panel} />
      <dl className="space-y-1.5">
        <Field label="Session">
          <Link className="text-primary underline-offset-4 hover:underline" href={`/app/${ctx.orgSlug}/databases/sessions?row=${encodeURIComponent(r.event.id)}`}>
            {r.event.title}
          </Link>{" "}
          <span className="text-muted-foreground">({fmtDate(r.event.startsAt, ctx.timezone)})</span>
        </Field>
        <Field label="Checked in">{fmtDateTime(r.checkedInAt, ctx.timezone)}</Field>
        <Field label="Method">{METHOD_LABELS[r.method] ?? r.method}</Field>
        <Field label="Stamp">
          {r.stampNumber ? `#${r.stampNumber} of ${r.termStampTotal} in ${termLabel(r.term)}` : "No stamp (suppressed)"}
          {r.isFirstVisit && <Badge className="ml-2">First visit</Badge>}
        </Field>
        <Field label="Name as entered">{r.nameAsEntered}</Field>
        {r.nameOverride && <Field label="Name override">{r.nameOverride}</Field>}
        <Field label="Source">{SOURCE_LABELS[r.source] ?? r.source}</Field>
        {r.suppressedAt && <Field label="Suppressed">{fmtDateTime(r.suppressedAt, ctx.timezone)}</Field>}
      </dl>
      {ctx.canEdit && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <ActionButton action={setAttendanceSuppressedAction} args={[ctx.organizationId, r.id, !r.suppressedAt]}>
              {r.suppressedAt ? "Restore" : "Suppress"}
            </ActionButton>
            {!synced && (
              <ActionButton
                variant="destructive"
                confirm="Delete this check-in?"
                action={deleteAttendanceAction} args={[ctx.organizationId, r.id]}
              >
                Delete
              </ActionButton>
            )}
          </div>
          {synced && (
            <p className="text-muted-foreground text-xs">
              This check-in came from the website. It can be suppressed (kept, but not counted) but not deleted, and
              nothing here changes the website.
            </p>
          )}
          <NameOverrideForm organizationId={ctx.organizationId} attendanceId={r.id} current={r.nameOverride} />
        </div>
      )}
      <Section title={`Stamp card, ${termLabel(r.term)}`}>
        <StampStrip strip={detail.strip} timezone={ctx.timezone} />
      </Section>
      <Section title="Check-in history">
        <Terms panel={detail.panel} />
        <History panel={detail.panel} ctx={ctx} />
      </Section>
      <ContactTools panel={detail.panel} ctx={ctx} />
    </>
  );
}

// ---- Signups -----------------------------------------------------------------------------------

function answerList(answers: unknown, key: "colleges" | "meet_days" | "interests"): string {
  const v = answers && typeof answers === "object" ? (answers as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(v) || v.length === 0) return "—";
  return v.map((x) => signupLabel(key, String(x))).join(", ");
}

export function SignupPanel({ detail, ctx }: { detail: SignupDetail; ctx: PanelContext }) {
  const s = detail.row;
  const synced = s.recordSource === "SUPABASE_SYNC";
  return (
    <>
      <PersonHeader panel={detail.panel} />
      <dl className="space-y-1.5">
        <Field label="Status">{STATUS_LABELS[s.status] ?? s.status}</Field>
        <Field label="Signed up">{fmtDateTime(s.signedUpAt, ctx.timezone)}</Field>
        <Field label="Source">{CHANNEL_LABELS[s.channel] ?? s.channel}</Field>
        <Field label="Term">{termLabel(s.term)}</Field>
        <Field label="Year">{s.classYear ? signupLabel("classYear", s.classYear) : null}</Field>
        <Field label="Colleges">{answerList(s.answers, "colleges")}</Field>
        <Field label="Meet days">{answerList(s.answers, "meet_days")}</Field>
        <Field label="Interests">{answerList(s.answers, "interests")}</Field>
        <Field label="Submissions">{s.submissions}</Field>
        <Field label="Added to list">{s.addedToListAt ? fmtDate(s.addedToListAt, ctx.timezone) : "Not yet"}</Field>
        <Field label="First attended">
          {s.firstAttendedAt
            ? `${fmtDate(s.firstAttendedAt, ctx.timezone)} (${s.daysToFirstAttendance ?? 0} days after signing up)`
            : "Not yet"}
        </Field>
        <Field label="Unsubscribed">
          {detail.panel.contact.unsubscribedAt ? fmtDate(detail.panel.contact.unsubscribedAt, ctx.timezone) : "No"}
        </Field>
        <Field label="Record">{SOURCE_LABELS[s.recordSource] ?? s.recordSource}</Field>
      </dl>
      {ctx.canEdit && (
        <div className="flex flex-wrap gap-2">
          <ActionButton action={setSignupsAddedAction} args={[ctx.organizationId, [s.id], !s.addedToListAt]}>
            {s.addedToListAt ? "Mark not on the list" : "Mark added to list"}
          </ActionButton>
          <ActionButton action={setSignupSuppressedAction} args={[ctx.organizationId, s.id, !s.suppressedAt]}>
            {s.suppressedAt ? "Restore" : "Suppress"}
          </ActionButton>
          {!synced && (
            <ActionButton variant="destructive" confirm="Delete this signup?" action={deleteSignupAction} args={[ctx.organizationId, s.id]}>
              Delete
            </ActionButton>
          )}
        </div>
      )}
      <Section title="Attendance">
        <Terms panel={detail.panel} />
        <History panel={detail.panel} ctx={ctx} />
      </Section>
      <ContactTools panel={detail.panel} ctx={ctx} />
    </>
  );
}

// ---- People --------------------------------------------------------------------------------------

export function PersonPanel({ detail, ctx }: { detail: PersonDetail; ctx: PanelContext }) {
  return (
    <>
      <PersonHeader panel={detail.panel} />
      <dl className="space-y-1.5">
        <Field label="Term">{termLabel(detail.stats.term)}</Field>
        <Field label="Sessions">{detail.stats.sessionsAttended}</Field>
        <Field label="Stamps">{detail.stats.stampCount}</Field>
        <Field label="First check-in">{fmtDateTime(detail.stats.firstCheckInAt, ctx.timezone)}</Field>
        <Field label="Last check-in">{fmtDateTime(detail.stats.lastCheckInAt, ctx.timezone)}</Field>
        <Field label="Lapsed">
          {detail.panel.contact.lapsedSince ? `Since ${fmtDate(detail.panel.contact.lapsedSince, ctx.timezone)}` : "No"}
        </Field>
        <Field label="All-time sessions">{detail.panel.contact.sessionsAttended}</Field>
      </dl>
      <Section title={`Stamp card, ${termLabel(detail.stats.term)}`}>
        <StampStrip strip={detail.strip} timezone={ctx.timezone} />
      </Section>
      <Section title="Check-in history">
        <Terms panel={detail.panel} />
        <History panel={detail.panel} ctx={ctx} />
      </Section>
      <ContactTools panel={detail.panel} ctx={ctx} />
    </>
  );
}

// ---- Ballots ---------------------------------------------------------------------------------------

export function BallotPanel({ detail, ctx }: { detail: BallotDetail; ctx: PanelContext }) {
  const b = detail.ballot;
  const voter = b.voter ? (b.voter.user?.name ?? b.voter.displayName ?? b.voter.emailMasked ?? "Unknown") : "Anonymous";
  return (
    <>
      <p className="text-muted-foreground rounded-md border p-3 text-xs">
        You can see individual votes under Settings &gt; Privacy. Opening this ballot was recorded in the audit log.
      </p>
      <dl className="space-y-1.5">
        <Field label="Poll">{b.ballotDefinition?.title ?? b.pollSlug}</Field>
        <Field label="Cast at">{fmtDateTime(b.castAt, ctx.timezone)} (rounded to the hour at the source)</Field>
        <Field label="Voter">{voter}</Field>
        <Field label="Source">{SOURCE_LABELS[b.source] ?? b.source}</Field>
        {b.excludedReason && <Field label="Not counted">{exclusionLabel(b.excludedReason)}</Field>}
      </dl>
      <Section title="Answers">
        <dl className="space-y-2">
          {detail.questions.map((q) => (
            <div key={q.key} className="text-sm">
              <dt className="font-medium">{q.label}</dt>
              <dd className="text-muted-foreground">
                {q.answers
                  .map((a) => (a.freeText ? `“${a.label}”` : a.rank ? `${a.rank}. ${a.label}` : a.label))
                  .join(q.answers.some((a) => a.rank) ? "  " : ", ")}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
      {ctx.canEdit && (
        <div className="flex flex-wrap gap-2">
          <ActionButton action={setBallotSuppressedAction} args={[ctx.organizationId, b.id, b.excludedReason !== "suppressed"]}>
            {b.excludedReason === "suppressed" ? "Count this ballot again" : "Don't count this ballot"}
          </ActionButton>
        </div>
      )}
    </>
  );
}
