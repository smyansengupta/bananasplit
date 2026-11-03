"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startImportAction } from "@/app/app/[orgSlug]/crm/actions";
import { fixImportRowAction, letRowGoAction } from "@/app/app/[orgSlug]/crm/settings-actions";
import { SettingsCard, SettingsStatus } from "@/app/app/[orgSlug]/settings/settings-card";
import { Ban } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";

import { SheetDrop, SheetMatches, type DroppedSheet } from "./sheet-drop";

/**
 * CRM settings > Import and export: a spreadsheet in (matched for you,
 * checked before it's added), the rows an import couldn't bring in with a
 * fix for each, everything out as one zip, and duplicates to merge.
 */

export interface RecentImportRow {
  id: string;
  fileName: string;
  line: string;
}

export function ImportCard({
  orgId,
  orgSlug,
  recent,
  admin = false,
}: {
  orgId: string;
  orgSlug: string;
  recent: RecentImportRow[];
  /** Owners and admins also get the way to bring in who Bananasplit already knows (setup). */
  admin?: boolean;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<DroppedSheet | null>(null);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const bring = () =>
    start(async () => {
      if (!sheet) return;
      const r = await runAction(() =>
        startImportAction(orgId, sheet.importId, { object: "person", mapping: sheet.mapping }),
      );
      if (!r) return;
      if (!r.ok) {
        setStatus({ tone: "error", text: r.error });
        return;
      }
      const l = r.log;
      setStatus({
        tone: "ok",
        text:
          l.status === "done"
            ? `${l.created} added, ${l.updated} updated${l.skipped ? `, ${l.skipped} need a look` : ""}.`
            : `Bringing in ${l.total.toLocaleString("en-US")} rows in the background.`,
      });
      setSheet(null);
      router.refresh();
    });
  return (
    <SettingsCard
      title="Import"
      description="Columns are matched for you. Anyone already here by email gets only their empty details filled."
      status={
        status ? (
          <SettingsStatus status={status} />
        ) : (
          <Link
            href={admin ? `/app/${orgSlug}/crm/setup` : `/app/${orgSlug}/crm/import`}
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-2 hover:underline"
          >
            {admin ? "Members, event guests and form answers" : "Companies, deals or another CRM's export"}
          </Link>
        )
      }
      footer={
        sheet ? (
          <Button type="button" disabled={pending} onClick={bring}>
            {pending ? "Bringing them in…" : `Bring in ${sheet.total.toLocaleString("en-US")} rows`}
          </Button>
        ) : undefined
      }
    >
      {sheet ? (
        <SheetMatches sheet={sheet} onRemove={() => setSheet(null)} />
      ) : (
        <SheetDrop orgSlug={orgSlug} onDropped={setSheet} />
      )}
      {recent.length > 0 && (
        <ul className="divide-border divide-y">
          {recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 py-2.5">
              <b className="min-w-0 flex-[1_1_12rem] truncate text-[15px] font-semibold">
                {r.fileName}
              </b>
              <span className="text-muted-foreground text-sm">{r.line}</span>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

export interface FixImport {
  id: string;
  fileName: string;
  done: number;
  rows: { row: number; message: string; label: string; needsEmail: boolean }[];
}

function FixRow({
  orgId,
  importId,
  row,
}: {
  orgId: string;
  importId: string;
  row: FixImport["rows"][number];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  const run = (call: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await runAction(call);
      if (!r) return;
      if (!r.ok) {
        toast({ title: r.error ?? "That didn't work.", tone: "error" });
        return;
      }
      toast({ title: done });
      router.refresh();
    });
  return (
    <li className="border-border flex flex-wrap items-center gap-3.5 border-t px-5 py-4">
      <span className="text-muted-foreground w-16 shrink-0 text-sm">Row {row.row}</span>
      <span className="min-w-0 flex-[1_1_15rem]">
        <b className="block text-[15px] font-semibold">{row.label}</b>
        <span className="text-destructive flex items-center gap-1.5 text-sm">
          <Ban className="size-3.5 shrink-0" aria-hidden="true" />
          {row.needsEmail ? "No email or phone, so nobody can reach them" : row.message}
        </span>
      </span>
      {row.needsEmail ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim())
              run(() => fixImportRowAction(orgId, importId, row.row, email), `${row.label} is in.`);
          }}
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Add an email"
            aria-label={`Email for ${row.label}`}
            className="h-9 w-52"
          />
          <Button type="submit" size="sm" disabled={pending || !email.trim()}>
            Save
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => fixImportRowAction(orgId, importId, row.row, null), `${row.label} is in.`)
          }
        >
          Try again
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => letRowGoAction(orgId, importId, row.row), "Left out.")}
      >
        Leave it out
      </Button>
    </li>
  );
}

/** "contacts.xlsx: 205 in, 9 need a look", each row with its fix. */
export function RowsToFix({ orgId, item }: { orgId: string; item: FixImport }) {
  return (
    <section
      className="border-border bg-card overflow-hidden rounded-[1.75rem] border"
      aria-label={`Rows to fix in ${item.fileName}`}
    >
      <div className="bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4">
        <b className="min-w-0 flex-[1_1_18rem] text-lg">
          {item.fileName}: {item.done.toLocaleString("en-US")} in, {item.rows.length} need a look
        </b>
        <span className="text-muted-foreground text-sm">Fix them here, or leave them out.</span>
      </div>
      <ul>
        {item.rows.map((r) => (
          <FixRow key={r.row} orgId={orgId} importId={item.id} row={r} />
        ))}
      </ul>
    </section>
  );
}

export function ExportCard({ orgSlug }: { orgSlug: string }) {
  const [notes, setNotes] = useState(false);
  return (
    <SettingsCard
      title="Export"
      description="Every person, company and deal as spreadsheets in one zip. It's your data."
      footer={
        <Button asChild>
          <a href={`/app/${orgSlug}/crm/export?kind=all${notes ? "&notes=1" : ""}`} download>
            Export everything
          </a>
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-[1_1_16rem]">
          <b className="block text-[15px] font-semibold">Include notes and emails</b>
          <span className="text-muted-foreground text-sm">
            Every timeline entry too. Makes the zip bigger.
          </span>
        </span>
        <Switch checked={notes} onCheckedChange={setNotes} aria-label="Include notes and emails" />
      </div>
    </SettingsCard>
  );
}
