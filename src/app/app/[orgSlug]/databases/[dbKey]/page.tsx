import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { EyeOff, Lock, Vote } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import type { ReactNode } from "react";

import { AddAttendanceDialog, AddSignupDialog } from "@/components/databases/add-row-dialogs";
import { BackLink } from "@/components/back-link";
import { BallotResultsView } from "@/components/databases/ballot-results-view";
import { DatabaseMenu } from "@/components/databases/database-menu";
import { DataTable } from "@/components/databases/data-table";
import { DatabaseGrid } from "@/components/databases/custom/database-grid";
import {
  AttendancePanel,
  BallotPanel,
  PersonPanel,
  SessionPanel,
  SignupPanel,
  type PanelContext,
} from "@/components/databases/detail-panels";
import { RowDrawer } from "@/components/databases/row-drawer";
import {
  SessionFormDialog,
  type SessionFormInitial,
} from "@/components/databases/session-form-dialog";
import { notice } from "@/components/databases/styles";
import { PollPicker, ViewSwitch } from "@/components/databases/view-switch";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { NotFoundError } from "@/lib/auth/errors";
import { isPersonalSpace } from "@/lib/billing/space";
import { parseDbViewParams } from "@/lib/databases/href";
import {
  listPolls,
  loadPollResults,
  type PollOption,
  type PollResults,
} from "@/server/databases/ballot-results";
import {
  loadAttendanceDetail,
  loadBallotDetail,
  loadPersonDetail,
  loadSessionDetail,
  loadSignupDetail,
} from "@/server/databases/details";
import { fmtDate } from "@/server/databases/format";
import { loadCustomDatabase } from "@/server/databases/custom";
import { sourceFor } from "@/server/databases/sources";
import {
  canViewBallotRows,
  getDatabase,
  loadView,
  viewContextFor,
  viewerColumns,
  type LoadedView,
  type SearchParams,
} from "@/server/databases/views";
import { getOrgContextBySlug, withOrgTx, type OrgContext } from "@/server/db/context";
import { SIGNUP_LABELS } from "@/server/sync/supabase-map";
import { syncIfStale } from "@/server/sync/enqueue";
import { getOrgMembersForPicker } from "@/server/members";
import { planGate } from "@/server/billing/plan-gate";

/**
 * One database (Phase 4a/4b): the server-paginated table in the view URL
 * grammar, the row drawer (?row=), CSV export, admin tools, and for Ballots
 * the aggregate results every member may see (individual votes only for the
 * tier Settings > Privacy allows). Everything is read in one withOrgTx as
 * the viewer, so RLS applies to the table, the drawer and the counts alike.
 */

const SYNCED_KINDS = new Set(["ATTENDANCE", "SIGNUPS", "BALLOTS", "PEOPLE", "SESSIONS"]);

const DATE_LABELS: Record<string, string> = {
  SESSIONS: "Date",
  ATTENDANCE: "Check-in",
  SIGNUPS: "Signup date",
  BALLOTS: "Cast",
  PEOPLE: "Last check-in",
};

/** What a row of each database is, for the summary under the title ("401 check-ins"). */
const ROW_NOUNS: Record<string, [string, string]> = {
  SESSIONS: ["session", "sessions"],
  ATTENDANCE: ["check-in", "check-ins"],
  SIGNUPS: ["signup", "signups"],
  PEOPLE: ["person", "people"],
  BALLOTS: ["choice", "choices"],
  BALLOT_VIEW: ["ballot", "ballots"],
};

/** Under the title when members can't open this database (Admin panel › Privacy decides). */
const VISIBILITY_NOTE: Record<string, string | undefined> = {
  ADMINS: "Visible to owners and admins",
  OWNER: "Visible to owners only",
  HIDDEN: "Hidden from members",
};

type Drawer =
  | { kind: "session"; title: string; description?: string; node: ReactNode }
  | { kind: "other"; title: string; description?: string; node: ReactNode };

function localInput(date: Date, timezone: string): string {
  return format(new TZDate(date.getTime(), timezone || "UTC"), "yyyy-MM-dd'T'HH:mm");
}

function selectedPollId(sp: SearchParams, polls: PollOption[]): string | null {
  const params = parseDbViewParams(sp);
  const f = params.filters.find(
    (x) =>
      ["ballotDefinitionId", "poll", "definition", "pollSlug", "slug"].includes(x.col) &&
      x.op === "eq",
  );
  if (f) {
    const hit = polls.find((p) => p.id === f.value || p.slug === f.value);
    if (hit) return hit.id;
  }
  return null;
}

export default async function DatabaseViewPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/databases/[dbKey]">) {
  const { orgSlug, dbKey } = await params;
  const planLock = await planGate(orgSlug, "databases");
  if (planLock) return planLock;
  const sp = (await searchParams) as SearchParams;
  const { organization } = await getOrgContextBySlug(orgSlug);
  const rowId = typeof sp.row === "string" ? sp.row : undefined;

  // A club-made database: the editable grid instead of a built-in's table.
  const trash = sp.trash === "1";
  let custom;
  try {
    custom = await withOrgTx(organization.id, async (ctx) => {
      const def = await ctx.db.databaseDefinition.findFirst({
        where: { organizationId: organization.id, key: dbKey, kind: "CUSTOM", archivedAt: null },
        select: { id: true },
      });
      if (!def) return null;
      return loadCustomDatabase(
        { db: ctx.db, organizationId: organization.id, userId: ctx.userId, role: ctx.role },
        dbKey,
        { trash },
      );
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (custom) {
    const members = (await getOrgMembersForPicker(organization.id)).map((m) => ({
      id: m.id,
      name: m.name ?? "Member",
    }));
    return (
      <DatabaseGrid
        orgId={organization.id}
        orgSlug={orgSlug}
        database={custom}
        members={members}
        trash={trash}
        timezone={organization.timezone}
        personal={isPersonalSpace(organization)}
      />
    );
  }

  let page;
  try {
    page = await withOrgTx(organization.id, (ctx) => loadPage(ctx, organization, dbKey, sp, rowId));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (!page) notFound();

  if (SYNCED_KINDS.has(page.database.kind)) {
    after(() => syncIfStale(organization.id).catch(() => undefined));
  }

  const { database, view, table, results, polls, pollId, drawer, admin, rowAccess, ballotView } =
    page;
  const base = `/app/${orgSlug}/databases/${database.key}`;
  const exportHref = `${base}/export`;
  const kind = database.kind;
  const restricted = VISIBILITY_NOTE[database.memberVisibility];
  const anonymous = kind === "BALLOTS" && !rowAccess;

  // The one primary action: adding a row, for admins where rows can be added
  // here. Setup pages and the export are in the "…" menu.
  let addRow: ReactNode = null;
  if (admin) {
    if (kind === "SESSIONS") {
      addRow = (
        <SessionFormDialog
          organizationId={organization.id}
          timezone={organization.timezone}
          members={admin.members}
        />
      );
    } else if (kind === "ATTENDANCE") {
      addRow = <AddAttendanceDialog organizationId={organization.id} sessions={admin.sessions} />;
    } else if (kind === "SIGNUPS") {
      addRow = (
        <AddSignupDialog
          organizationId={organization.id}
          years={Object.entries(SIGNUP_LABELS.classYear).map(([value, label]) => ({
            value,
            label,
          }))}
        />
      );
    }
  }

  // The live summary under the title: how many rows this view holds (or,
  // for poll results, how many ballots were counted), then who may see it.
  let summary: string | null = null;
  if (view === "results") {
    summary = results
      ? `${results.turnout.toLocaleString()} counted ${results.turnout === 1 ? "ballot" : "ballots"}`
      : null;
  } else if (table) {
    const n = table.total;
    const [one, many] = ROW_NOUNS[ballotView === "ballots" ? "BALLOT_VIEW" : kind] ?? [
      "row",
      "rows",
    ];
    const filtered =
      table.query.filters.some((f) => !f.isDefault) ||
      Boolean(table.query.q || table.query.from || table.query.to);
    summary = `${n.toLocaleString()} ${n === 1 ? one : many}${filtered ? " match this view" : ""}`;
  }

  return (
    <div className="space-y-7.5">
      <div className="space-y-3">
        <BackLink href={`/app/${orgSlug}/databases`} label="Databases" />
        <PageHeader
          title={database.name}
          description={
            summary || restricted ? (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                {summary && <span className="tabular-nums">{summary}</span>}
                {summary && restricted && <span aria-hidden="true">·</span>}
                {restricted && (
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="size-3.5" aria-hidden="true" />
                    {restricted}
                  </span>
                )}
              </span>
            ) : undefined
          }
          actions={
            <>
              {kind === "BALLOTS" && polls.length > 0 && (
                <PollPicker polls={polls} current={pollId} allowAll={view !== "results"} />
              )}
              {kind === "BALLOTS" && rowAccess && (
                <ViewSwitch
                  current={ballotView}
                  views={[
                    { key: "results", label: "Results" },
                    { key: "rows", label: "Choices" },
                    { key: "ballots", label: "By ballot" },
                  ]}
                />
              )}
              {addRow}
              <DatabaseMenu
                name={database.name}
                exportHref={table ? exportHref : undefined}
                exportColumns={table?.columns.filter((c) => c.visible).map((c) => c.key)}
                exportResultsHref={
                  results
                    ? `${exportHref}?view=results&f=${encodeURIComponent(`ballotDefinitionId:eq:${results.poll.id}`)}`
                    : null
                }
                importHref={
                  admin && (kind === "ATTENDANCE" || kind === "SIGNUPS")
                    ? `${base}/import`
                    : undefined
                }
                duplicatesHref={admin && kind === "SESSIONS" ? `${base}/duplicates` : undefined}
                definitionsHref={admin && kind === "BALLOTS" ? `${base}/definitions` : undefined}
              />
            </>
          }
        />
      </div>

      {anonymous && (
        <p className={cn(notice.info, "flex items-start gap-2")}>
          <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Votes are anonymous. You see totals; individual ballots are visible only as Admin panel ›
          Privacy allows.
        </p>
      )}

      {view === "results" ? (
        results ? (
          <BallotResultsView results={results} />
        ) : (
          <Card>
            <EmptyState
              icon={Vote}
              title="No polls yet"
              description={
                admin
                  ? "Import a poll definition to see its results here."
                  : "Results show up here once your organization runs a poll."
              }
              action={
                admin ? (
                  <Button asChild variant="outline">
                    <Link href={`${base}/definitions`}>Import a poll definition</Link>
                  </Button>
                ) : undefined
              }
            />
          </Card>
        )
      ) : table ? (
        <DataTable
          columns={table.columns}
          rows={table.rows}
          total={table.total}
          page={table.query.page}
          size={table.query.size}
          sort={table.query.sort}
          filters={table.query.filters}
          rejected={table.query.rejected}
          q={table.query.q}
          from={table.query.from}
          to={table.query.to}
          dateLabel={DATE_LABELS[database.kind]}
          selectedRowId={rowId}
        />
      ) : null}

      {drawer && (
        <RowDrawer title={drawer.title} description={drawer.description}>
          {drawer.node}
        </RowDrawer>
      )}
    </div>
  );
}

interface PageData {
  database: Awaited<ReturnType<typeof getDatabase>>;
  view: "table" | "results";
  ballotView: string;
  table: LoadedView | null;
  results: PollResults | null;
  polls: { id: string; title: string; isTest: boolean }[];
  pollId: string | null;
  rowAccess: boolean;
  drawer: Drawer | null;
  admin: {
    members: { id: string; name: string | null }[];
    sessions: { id: string; label: string }[];
  } | null;
}

async function loadPage(
  ctx: OrgContext,
  org: { id: string; slug: string; timezone: string },
  dbKey: string,
  sp: SearchParams,
  rowId: string | undefined,
): Promise<PageData | null> {
  const { db, role } = ctx;
  const database = await getDatabase(db, org.id, role, dbKey);
  const vctx = viewContextFor(org, role, database);
  const isAdmin = database.canEdit;

  // Ballots: results for everyone, rows only for the tier Privacy allows.
  let view: "table" | "results" = "table";
  let ballotView = "results";
  let rowAccess = false;
  let results: PollResults | null = null;
  let polls: PollOption[] = [];
  let pollId: string | null = null;
  let sourceView: string | undefined;
  if (database.kind === "BALLOTS") {
    rowAccess = await canViewBallotRows(db, org.id, vctx.tier);
    const requested = typeof sp.view === "string" ? sp.view : "results";
    ballotView =
      rowAccess && (requested === "rows" || requested === "ballots") ? requested : "results";
    // Test polls are for admins checking the pipeline, not results.
    polls = (await listPolls(db, org.id)).filter((p) => isAdmin || !p.isTest);
    pollId = selectedPollId(sp, polls);
    if (ballotView === "results") {
      view = "results";
      const poll = polls.find((p) => p.id === pollId) ?? polls.find((p) => !p.isTest) ?? polls[0];
      if (poll) {
        pollId = poll.id;
        results = await loadPollResults(db, org.id, poll, vctx.tier);
      }
    } else {
      sourceView = ballotView === "ballots" ? "ballots" : "choices";
    }
  }

  const source = sourceFor(database.kind, sourceView);
  if (!source) return null;
  const columns = viewerColumns(source, database.columns, vctx.tier);
  const table = view === "table" ? await loadView(db, source, columns, vctx, sp) : null;

  const members = isAdmin
    ? (await getOrgMembersForPicker(org.id)).map((m) => ({ id: m.id, name: m.name }))
    : [];
  const panelCtx: PanelContext = {
    organizationId: org.id,
    orgSlug: org.slug,
    timezone: vctx.timezone,
    canEdit: isAdmin,
    members,
  };

  let drawer: Drawer | null = null;
  if (rowId) {
    switch (database.kind) {
      case "SESSIONS": {
        const detail = await loadSessionDetail(db, vctx, rowId);
        if (!detail) throw new NotFoundError();
        const e = detail.event;
        const initial: SessionFormInitial = {
          id: e.id,
          title: e.title,
          description: e.description,
          kind: e.kind,
          visibility: e.visibility,
          startsAt: localInput(e.startsAt, vctx.timezone),
          endsAt: localInput(e.endsAt, vctx.timezone),
          location: e.location,
          hostUserId: e.hostUserId,
          hostName: e.hostName,
          rsvpUrl: e.rsvpUrl,
          term: e.term,
          stampSlot: e.stampSlot,
        };
        const nearby = isAdmin
          ? await db.event.findMany({
              where: {
                organizationId: org.id,
                deletedAt: null,
                mergedIntoId: null,
                id: { not: e.id },
                startsAt: {
                  gte: new Date(e.startsAt.getTime() - 3 * 86400000),
                  lte: new Date(e.startsAt.getTime() + 3 * 86400000),
                },
              },
              orderBy: { startsAt: "asc" },
              take: 20,
              select: { id: true, title: true, startsAt: true },
            })
          : [];
        drawer = {
          kind: "session",
          title: e.title,
          description: fmtDate(e.startsAt, vctx.timezone),
          node: (
            <SessionPanel
              detail={detail}
              ctx={panelCtx}
              formInitial={initial}
              mergeCandidates={nearby.map((n) => ({
                id: n.id,
                label: `${n.title} · ${fmtDate(n.startsAt, vctx.timezone)}`,
              }))}
            />
          ),
        };
        break;
      }
      case "ATTENDANCE": {
        const detail = await loadAttendanceDetail(db, vctx, rowId);
        if (!detail) throw new NotFoundError();
        drawer = {
          kind: "other",
          title: "Check-in",
          description: detail.row.event.title,
          node: <AttendancePanel detail={detail} ctx={panelCtx} />,
        };
        break;
      }
      case "SIGNUPS": {
        const detail = await loadSignupDetail(db, vctx, rowId);
        if (!detail) throw new NotFoundError();
        drawer = {
          kind: "other",
          title: "Signup",
          node: <SignupPanel detail={detail} ctx={panelCtx} />,
        };
        break;
      }
      case "PEOPLE": {
        const detail = await loadPersonDetail(db, vctx, rowId);
        if (!detail) throw new NotFoundError();
        drawer = {
          kind: "other",
          title: "Person",
          node: <PersonPanel detail={detail} ctx={panelCtx} />,
        };
        break;
      }
      case "BALLOTS": {
        if (!rowAccess) throw new NotFoundError();
        const detail = await loadBallotDetail(
          db,
          vctx,
          rowId,
          sourceView === "ballots" ? "ballots" : "choices",
        );
        if (!detail) throw new NotFoundError();
        drawer = {
          kind: "other",
          title: "Ballot",
          node: <BallotPanel detail={detail} ctx={panelCtx} />,
        };
        break;
      }
      default:
        throw new NotFoundError();
    }
  }

  let adminData: PageData["admin"] = null;
  if (isAdmin) {
    const sessions =
      database.kind === "ATTENDANCE"
        ? await db.event.findMany({
            where: {
              organizationId: org.id,
              deletedAt: null,
              mergedIntoId: null,
              startsAt: { lte: new Date(Date.now() + 86400000) },
            },
            orderBy: { startsAt: "desc" },
            take: 60,
            select: { id: true, title: true, startsAt: true },
          })
        : [];
    adminData = {
      members,
      sessions: sessions.map((s) => ({
        id: s.id,
        label: `${s.title} · ${fmtDate(s.startsAt, vctx.timezone)}`,
      })),
    };
  }

  return {
    database,
    view,
    ballotView,
    table,
    results,
    polls: polls.map((p) => ({ id: p.id, title: p.title, isTest: p.isTest })),
    pollId,
    rowAccess,
    drawer,
    admin: adminData,
  };
}
