import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import type { ReactNode } from "react";

import { AddAttendanceDialog, AddSignupDialog } from "@/components/databases/add-row-dialogs";
import { BallotResultsView } from "@/components/databases/ballot-results-view";
import { DataTable } from "@/components/databases/data-table";
import {
  AttendancePanel,
  BallotPanel,
  PersonPanel,
  SessionPanel,
  SignupPanel,
  type PanelContext,
} from "@/components/databases/detail-panels";
import { RowDrawer } from "@/components/databases/row-drawer";
import { SessionFormDialog, type SessionFormInitial } from "@/components/databases/session-form-dialog";
import { PollPicker, ViewSwitch } from "@/components/databases/view-switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotFoundError } from "@/lib/auth/errors";
import { parseDbViewParams } from "@/lib/databases/href";
import { listPolls, loadPollResults, type PollOption, type PollResults } from "@/server/databases/ballot-results";
import {
  loadAttendanceDetail,
  loadBallotDetail,
  loadPersonDetail,
  loadSessionDetail,
  loadSignupDetail,
} from "@/server/databases/details";
import { fmtDate } from "@/server/databases/format";
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

type Drawer =
  | { kind: "session"; title: string; description?: string; node: ReactNode }
  | { kind: "other"; title: string; description?: string; node: ReactNode };

function localInput(date: Date, timezone: string): string {
  return format(new TZDate(date.getTime(), timezone || "UTC"), "yyyy-MM-dd'T'HH:mm");
}

function selectedPollId(sp: SearchParams, polls: PollOption[]): string | null {
  const params = parseDbViewParams(sp);
  const f = params.filters.find((x) => ["ballotDefinitionId", "poll", "definition", "pollSlug", "slug"].includes(x.col) && x.op === "eq");
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
  const sp = (await searchParams) as SearchParams;
  const { organization } = await getOrgContextBySlug(orgSlug);
  const rowId = typeof sp.row === "string" ? sp.row : undefined;

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

  const { database, view, table, results, polls, pollId, drawer, admin, rowAccess, ballotView } = page;
  const exportHref = `/app/${orgSlug}/databases/${database.key}/export`;
  const toolbar: ReactNode[] = [];
  if (admin && database.canEdit) {
    if (database.kind === "SESSIONS") {
      toolbar.push(
        <Button key="dups" variant="outline" size="sm" asChild>
          <Link href={`/app/${orgSlug}/databases/${database.key}/duplicates`}>Possible duplicates</Link>
        </Button>,
        <SessionFormDialog key="new" organizationId={organization.id} timezone={organization.timezone} members={admin.members} />,
      );
    }
    if (database.kind === "ATTENDANCE") {
      toolbar.push(
        <Button key="import" variant="outline" size="sm" asChild>
          <Link href={`/app/${orgSlug}/databases/${database.key}/import`}>Import CSV</Link>
        </Button>,
        <AddAttendanceDialog key="add" organizationId={organization.id} sessions={admin.sessions} />,
      );
    }
    if (database.kind === "SIGNUPS") {
      toolbar.push(
        <Button key="import" variant="outline" size="sm" asChild>
          <Link href={`/app/${orgSlug}/databases/${database.key}/import`}>Import CSV</Link>
        </Button>,
        <AddSignupDialog
          key="add"
          organizationId={organization.id}
          years={Object.entries(SIGNUP_LABELS.classYear).map(([value, label]) => ({ value, label }))}
        />,
      );
    }
    if (database.kind === "BALLOTS") {
      toolbar.push(
        <Button key="defs" variant="outline" size="sm" asChild>
          <Link href={`/app/${orgSlug}/databases/${database.key}/definitions`}>Poll definitions</Link>
        </Button>,
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={`/app/${orgSlug}/databases`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
          >
            <ChevronLeft className="size-3" aria-hidden="true" />
            Databases
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {database.name}
            {database.memberVisibility !== "MEMBERS" && <Badge variant="outline">{database.memberVisibility === "ADMINS" ? "Owners and admins" : database.memberVisibility === "OWNER" ? "Owners only" : "Hidden from members"}</Badge>}
          </h1>
        </div>
        {database.kind === "BALLOTS" && (
          <div className="flex flex-wrap items-center gap-2">
            {polls.length > 0 && (
              <PollPicker polls={polls} current={pollId} allowAll={view !== "results"} />
            )}
            {rowAccess && (
              <ViewSwitch
                current={ballotView}
                views={[
                  { key: "results", label: "Results" },
                  { key: "rows", label: "Choices" },
                  { key: "ballots", label: "By ballot" },
                ]}
              />
            )}
          </div>
        )}
      </div>

      {database.kind === "BALLOTS" && !rowAccess && (
        <p className="text-muted-foreground text-sm">
          Votes are anonymous. You see totals; individual ballots are visible only as Settings &gt; Privacy allows.
        </p>
      )}

      {view === "results" ? (
        <div className="space-y-4">
          {toolbar.length > 0 && <div className="flex flex-wrap justify-end gap-2">{toolbar}</div>}
          {results ? (
            <>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" asChild>
                  <a href={`${exportHref}?view=results&f=${encodeURIComponent(`ballotDefinitionId:eq:${results.poll.id}`)}`} download>
                    Export results CSV
                  </a>
                </Button>
              </div>
              <BallotResultsView results={results} />
            </>
          ) : (
            <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
              No polls yet.{admin ? " Import a poll definition to see its results." : ""}
            </p>
          )}
        </div>
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
          exportHref={exportHref}
          toolbar={toolbar}
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
    ballotView = rowAccess && (requested === "rows" || requested === "ballots") ? requested : "results";
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
              mergeCandidates={nearby.map((n) => ({ id: n.id, label: `${n.title} · ${fmtDate(n.startsAt, vctx.timezone)}` }))}
            />
          ),
        };
        break;
      }
      case "ATTENDANCE": {
        const detail = await loadAttendanceDetail(db, vctx, rowId);
        if (!detail) throw new NotFoundError();
        drawer = { kind: "other", title: "Check-in", description: detail.row.event.title, node: <AttendancePanel detail={detail} ctx={panelCtx} /> };
        break;
      }
      case "SIGNUPS": {
        const detail = await loadSignupDetail(db, vctx, rowId);
        if (!detail) throw new NotFoundError();
        drawer = { kind: "other", title: "Signup", node: <SignupPanel detail={detail} ctx={panelCtx} /> };
        break;
      }
      case "PEOPLE": {
        const detail = await loadPersonDetail(db, vctx, rowId);
        if (!detail) throw new NotFoundError();
        drawer = { kind: "other", title: "Person", node: <PersonPanel detail={detail} ctx={panelCtx} /> };
        break;
      }
      case "BALLOTS": {
        if (!rowAccess) throw new NotFoundError();
        const detail = await loadBallotDetail(db, vctx, rowId, sourceView === "ballots" ? "ballots" : "choices");
        if (!detail) throw new NotFoundError();
        drawer = { kind: "other", title: "Ballot", node: <BallotPanel detail={detail} ctx={panelCtx} /> };
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
            where: { organizationId: org.id, deletedAt: null, mergedIntoId: null, startsAt: { lte: new Date(Date.now() + 86400000) } },
            orderBy: { startsAt: "desc" },
            take: 60,
            select: { id: true, title: true, startsAt: true },
          })
        : [];
    adminData = {
      members,
      sessions: sessions.map((s) => ({ id: s.id, label: `${s.title} · ${fmtDate(s.startsAt, vctx.timezone)}` })),
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
