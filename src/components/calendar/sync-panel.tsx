"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { importGoogleEvents, syncGoogleNow } from "@/app/app/[orgSlug]/calendar/sync/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GoogleSyncStatus } from "@/server/google-calendar/requests";

const STATUS_LABEL: Record<string, string> = {
  CONNECTED: "Connected",
  ERROR: "Error",
  NEEDS_REAUTH: "Needs reconnecting",
  DISCONNECTED: "Not connected",
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">Not connected</Badge>;
  const bad = status === "ERROR" || status === "NEEDS_REAUTH";
  return (
    <Badge variant={bad ? "destructive" : status === "CONNECTED" ? "secondary" : "outline"}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex items-center gap-2">
        <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-xs">{value}</code>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

function when(iso: string | Date | null | undefined): string {
  if (!iso) return "never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export function SyncPanel({
  orgId,
  orgSlug,
  canWrite,
  status,
  feed,
}: {
  orgId: string;
  orgSlug: string;
  canWrite: boolean;
  status: GoogleSyncStatus;
  feed: { json: string; ics: string };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const google = status.google;
  const usable = google && (google.status === "CONNECTED" || google.status === "ERROR");
  const imp = google?.import ?? null;

  function run(
    action: () => Promise<{ error?: string; queued?: number }>,
    ok: (queued?: number) => string,
  ) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(
        result.error
          ? { tone: "error", text: result.error }
          : { tone: "ok", text: ok(result.queued) },
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {message && (
        <p
          role="status"
          className={message.tone === "error" ? "text-destructive text-sm" : "text-sm"}
        >
          {message.text}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Website events feed
            <Badge variant={status.publicEventsEnabled ? "secondary" : "outline"}>
              {status.publicEventsEnabled ? "On" : "Off"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Upcoming public events as JSON (what the club website reads at build time) and as a
            calendar feed anyone can subscribe to. Cached for five minutes at the CDN.
            {!status.publicEventsEnabled && (
              <>
                {" "}
                It answers 404 until an owner or admin turns it on in{" "}
                <Link className="underline" href={`/app/${orgSlug}/settings/privacy`}>
                  Settings &gt; Privacy
                </Link>
                .
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CopyField label="JSON (set as SUITE_EVENTS_URL on the website)" value={feed.json} />
          <CopyField label="iCalendar" value={feed.ics} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Google Calendar mirror
            <StatusBadge status={google?.status ?? null} />
          </CardTitle>
          <CardDescription>
            Every save in the suite is copied to Google within about a minute. Changes made directly
            in Google are overwritten by the next save here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {google ? (
            <>
              <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Public calendar</dt>
                <dd className="truncate">{google.publicCalendarId}</dd>
                <dt className="text-muted-foreground">Internal calendar</dt>
                <dd className="truncate">
                  {google.internalCalendarId ?? "None: internal events stay off Google"}
                </dd>
                <dt className="text-muted-foreground">Events</dt>
                <dd>
                  {status.counts.SYNCED} on Google · {status.counts.PENDING} syncing ·{" "}
                  {status.counts.FAILED} failed
                </dd>
                <dt className="text-muted-foreground">Last Sync now</dt>
                <dd>{when(google.lastSyncRequestAt)}</dd>
              </dl>
              {google.lastError && (
                <p className="text-destructive">Last error: {google.lastError}</p>
              )}
              {status.failures.length > 0 && (
                <ul className="space-y-1">
                  {status.failures.map((f) => (
                    <li key={f.id}>
                      <Link className="underline" href={`/app/${orgSlug}/calendar/${f.id}`}>
                        {f.title}
                      </Link>
                      {f.error && <span className="text-muted-foreground">: {f.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {canWrite && (
                <Button
                  type="button"
                  disabled={isPending || !usable}
                  onClick={() =>
                    run(
                      () => syncGoogleNow(orgId),
                      (n) => `Queued ${n ?? 0} event(s) for Google.`,
                    )
                  }
                >
                  Sync now
                </Button>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              Not connected. Connect the club&apos;s Google account in{" "}
              <Link className="underline" href={`/app/${orgSlug}/settings/integrations`}>
                Settings &gt; Integrations
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      {google && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import existing Google events</CardTitle>
            <CardDescription>
              Once, after connecting: events already on the public Google Calendar are matched to
              the suite&apos;s events so nothing is duplicated. Run the dry run, check the numbers,
              then apply.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {imp?.ranAt ? (
              <div className="space-y-1">
                <p>
                  {imp.mode === "apply" ? "Applied" : "Dry run"} {when(imp.ranAt)}
                  {imp.status === "partial" && " (partial: run it again to finish)"}
                  {imp.status === "failed" && ` (failed: ${imp.error ?? "unknown error"})`}
                </p>
                {imp.status !== "failed" && (
                  <p className="font-medium">
                    {imp.linked ?? 0} linked, {imp.created ?? 0} new, {imp.ambiguous ?? 0} ambiguous
                    {imp.unchanged ? `, ${imp.unchanged} already linked` : ""}
                    {imp.skipped ? `, ${imp.skipped} skipped` : ""}
                  </p>
                )}
                {imp.samples && imp.samples.ambiguous.length > 0 && (
                  <p className="text-muted-foreground">
                    Ambiguous: {imp.samples.ambiguous.join("; ")}
                  </p>
                )}
                {imp.samples && imp.samples.created.length > 0 && (
                  <p className="text-muted-foreground">New: {imp.samples.created.join("; ")}</p>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">Not run yet.</p>
            )}
            {imp?.requested && (!imp.ranAt || (imp.requestedAt && imp.requestedAt > imp.ranAt)) && (
              <p className="text-muted-foreground">
                The {imp.requested} is queued; refresh in a minute. (Locally, run pnpm jobs:drain.)
              </p>
            )}
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending || !usable}
                  onClick={() =>
                    run(
                      () => importGoogleEvents(orgId, "dry-run"),
                      () => "Dry run queued.",
                    )
                  }
                >
                  Dry run
                </Button>
                <Button
                  type="button"
                  disabled={
                    isPending || !usable || imp?.mode !== "dry-run" || imp.status === "failed"
                  }
                  onClick={() =>
                    run(
                      () => importGoogleEvents(orgId, "apply"),
                      () => "Import queued.",
                    )
                  }
                >
                  Apply import
                </Button>
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              Ambiguous events are imported flagged as possible duplicates; merge them in Databases
              &gt; Sessions.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Website rebuild hook
            <StatusBadge status={status.buildHook?.status ?? null} />
          </CardTitle>
          <CardDescription>
            When a public event changes, the suite waits a minute (so a burst of edits is one
            deploy) and then asks Netlify to rebuild the website. The hook URL is saved in Settings
            &gt; Integrations.
          </CardDescription>
        </CardHeader>
        {status.buildHook && (
          <CardContent className="space-y-1 text-sm">
            <p className="text-muted-foreground">
              Last successful rebuild request: {when(status.buildHook.lastVerifiedAt)}
            </p>
            {status.buildHook.lastError && (
              <p className="text-destructive">{status.buildHook.lastError}</p>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
