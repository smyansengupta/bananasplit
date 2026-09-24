"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { importDefinitionAction, updateDefinitionAction } from "@/app/app/[orgSlug]/databases/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const selectClass = "border-input bg-background h-8 rounded-md border px-2 text-sm";

/**
 * Paste (or load) a poll definition: the website's src/lib/polls/<slug>.json
 * as is, or the suite's own { slug, title, questions } shape. Importing
 * re-links the poll's ballots, re-decides which count (window, test poll,
 * retired options) and re-explodes their choices.
 */
export function DefinitionImportForm({
  organizationId,
  sessions,
}: {
  organizationId: string;
  sessions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [json, setJson] = useState("");
  const [linked, setLinked] = useState("");
  const [isTest, setIsTest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setNotice(null);
        start(async () => {
          const r = await importDefinitionAction(organizationId, {
            json,
            linkedEventId: linked || null,
            isTest,
          });
          if (r.error) return setError(r.error);
          const d = r.data;
          setNotice(
            d
              ? `${d.created ? "Imported" : "Updated"} ${d.slug}: ${d.ballots} ballots, ${d.ballots - d.excluded} counted, ${d.excluded} excluded.`
              : "Saved.",
          );
          setJson("");
          router.refresh();
        });
      }}
    >
      <h2 className="text-sm font-semibold">Import a poll definition</h2>
      <div className="grid gap-1">
        <Label htmlFor="def-file">Poll file</Label>
        <input
          id="def-file"
          type="file"
          accept="application/json,.json"
          className="text-sm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setJson(await file.text());
          }}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="def-json">…or paste its JSON</Label>
        <Textarea
          id="def-json"
          rows={8}
          className="font-mono text-xs"
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder='{ "slug": "info-session-2026-09", "title": "…", "sections": [ … ] }'
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="def-session">Linked session</Label>
          <select id="def-session" value={linked} onChange={(e) => setLinked(e.target.value)} className={selectClass}>
            <option value="">None</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />
          Test poll (never counted)
        </label>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {notice && <p className="text-success text-sm">{notice}</p>}
      <Button type="submit" size="sm" disabled={pending || json.trim().length < 2}>
        {pending ? "Importing…" : "Import"}
      </Button>
    </form>
  );
}

/** Edit a definition's title, window, linked session and test flag. */
export function DefinitionEditForm({
  organizationId,
  definition,
  sessions,
}: {
  organizationId: string;
  definition: {
    id: string;
    title: string;
    opensAt: string;
    closesAt: string;
    linkedEventId: string | null;
    isTest: boolean;
  };
  sessions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const get = (k: string) => String(form.get(k) ?? "");
        setError(null);
        setNotice(null);
        start(async () => {
          const r = await updateDefinitionAction(organizationId, definition.id, {
            title: get("title"),
            opensAt: get("opensAt"),
            closesAt: get("closesAt"),
            linkedEventId: get("linkedEventId") || null,
            isTest: form.get("isTest") === "on",
          });
          if (r.error) return setError(r.error);
          setNotice(r.data ? `Saved. ${r.data.ballots} ballots, ${r.data.excluded} excluded.` : "Saved.");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={`t-${definition.id}`}>Title</Label>
        <Input id={`t-${definition.id}`} name="title" defaultValue={definition.title} maxLength={300} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`o-${definition.id}`}>Opens</Label>
        <Input id={`o-${definition.id}`} name="opensAt" type="datetime-local" defaultValue={definition.opensAt} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`c-${definition.id}`}>Closes</Label>
        <Input id={`c-${definition.id}`} name="closesAt" type="datetime-local" defaultValue={definition.closesAt} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`l-${definition.id}`}>Linked session</Label>
        <select id={`l-${definition.id}`} name="linkedEventId" defaultValue={definition.linkedEventId ?? ""} className={selectClass}>
          <option value="">None</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" name="isTest" defaultChecked={definition.isTest} />
        Test poll (never counted)
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {error && (
          <span role="alert" className="text-destructive text-sm">
            {error}
          </span>
        )}
        {notice && <span className="text-success text-sm">{notice}</span>}
      </div>
    </form>
  );
}
