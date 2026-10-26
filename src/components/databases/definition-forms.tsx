"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import {
  importDefinitionAction,
  updateDefinitionAction,
} from "@/app/app/[orgSlug]/databases/actions";
import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/ui/field-select";

import { fileInputClass } from "./styles";

/** The line beside a card's Save: what happened, or what went wrong. */
function Status({ error, notice }: { error: string | null; notice: string | null }) {
  if (error)
    return (
      <p role="alert" className="text-tint-danger-foreground text-sm">
        {error}
      </p>
    );
  if (notice)
    return (
      <p role="status" className="text-tint-success-foreground text-sm">
        {notice}
      </p>
    );
  return null;
}

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
      <SettingsCard
        title="Import a poll definition"
        description="The website's poll file, as is. Importing it again updates the poll and recounts its ballots."
        footer={
          <Button type="submit" disabled={pending || json.trim().length < 2}>
            {pending ? "Importing…" : "Import"}
          </Button>
        }
        status={<Status error={error} notice={notice} />}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="def-file">Poll file</Label>
          <input
            id="def-file"
            type="file"
            accept="application/json,.json"
            className={fileInputClass}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setJson(await file.text());
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="def-json">…or paste its JSON</Label>
          <Textarea
            id="def-json"
            rows={8}
            className="font-mono text-xs md:text-xs"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder='{ "slug": "info-session-2026-09", "title": "…", "sections": [ … ] }'
          />
        </div>
        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="def-session">Linked session</Label>
            <FieldSelect
              id="def-session"
              value={linked}
              onChange={(e) => setLinked(e.target.value)}
              className="w-full"
            >
              <option value="">None</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </FieldSelect>
          </div>
          <TestPollCheckbox id="def-test" checked={isTest} onCheckedChange={(v) => setIsTest(v)} />
        </div>
      </SettingsCard>
    </form>
  );
}

function TestPollCheckbox({
  id,
  name,
  checked,
  defaultChecked,
  onCheckedChange,
}: {
  id: string;
  name?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex h-10 items-center gap-2.5 text-sm">
      <Checkbox
        id={id}
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange ? (v) => onCheckedChange(v === true) : undefined}
      />
      Test poll (never counted)
    </label>
  );
}

/** Edit a definition's title, window, linked session and test flag: one settings card. */
export function DefinitionEditForm({
  organizationId,
  definition,
  sessions,
  title,
  description,
  action,
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
  /** The card's title and the line under it (the poll's slug and counts). */
  title: ReactNode;
  description?: ReactNode;
  /** Top right of the card: the Test chip. */
  action?: ReactNode;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
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
          setNotice(
            r.data ? `Saved. ${r.data.ballots} ballots, ${r.data.excluded} excluded.` : "Saved.",
          );
          router.refresh();
        });
      }}
    >
      <SettingsCard
        title={title}
        description={description}
        action={action}
        footer={
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        }
        status={<Status error={error} notice={notice} />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={`t-${definition.id}`}>Title</Label>
            <Input
              id={`t-${definition.id}`}
              name="title"
              defaultValue={definition.title}
              maxLength={300}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`o-${definition.id}`}>Opens</Label>
            <Input
              id={`o-${definition.id}`}
              name="opensAt"
              type="datetime-local"
              className="tabular-nums"
              defaultValue={definition.opensAt}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`c-${definition.id}`}>Closes</Label>
            <Input
              id={`c-${definition.id}`}
              name="closesAt"
              type="datetime-local"
              className="tabular-nums"
              defaultValue={definition.closesAt}
            />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={`l-${definition.id}`}>Linked session</Label>
            <FieldSelect
              id={`l-${definition.id}`}
              name="linkedEventId"
              defaultValue={definition.linkedEventId ?? ""}
              className="w-full"
            >
              <option value="">None</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </FieldSelect>
          </div>
          <div className="self-end">
            <TestPollCheckbox
              id={`x-${definition.id}`}
              name="isTest"
              defaultChecked={definition.isTest}
            />
          </div>
        </div>
      </SettingsCard>
    </form>
  );
}
