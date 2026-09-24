"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SUCCESS_TEXT } from "@/lib/status-tones";

import {
  type PrivacyInput,
  updateBallotVisibility,
  updateDatabaseVisibility,
  updatePrivacy,
} from "./actions";

type Status = { tone: "ok" | "error"; text: string } | null;

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p
      role="status"
      className={status.tone === "error" ? "text-destructive text-sm" : `text-sm ${SUCCESS_TEXT}`}
    >
      {status.text}
    </p>
  );
}

const VISIBILITY_OPTIONS = [
  { value: "MEMBERS", label: "All members" },
  { value: "ADMINS", label: "Owners and admins" },
  { value: "OWNER", label: "Owners only" },
  { value: "HIDDEN", label: "Hidden from members" },
] as const;

function Row({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="max-w-md">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-muted-foreground text-xs">{help}</p>
      </div>
      {children}
    </div>
  );
}

export function PrivacyForm({
  orgId,
  initial,
  canEdit,
}: {
  orgId: string;
  initial: PrivacyInput;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<PrivacyInput>(initial);
  const [status, setStatus] = useState<Status>(null);
  const [isPending, startTransition] = useTransition();
  const set = <K extends keyof PrivacyInput>(k: K, v: PrivacyInput[K]) =>
    setValue((s) => ({ ...s, [k]: v }));

  return (
    <form
      className="divide-y rounded-lg border px-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setStatus(null);
        startTransition(async () => {
          const result = await updatePrivacy(orgId, value);
          setStatus(
            result.error
              ? { tone: "error", text: result.error }
              : { tone: "ok", text: "Privacy settings saved." },
          );
          if (!result.error) router.refresh();
        });
      }}
    >
      <Row
        id="results-visible"
        label="Members see ballot results"
        help="Aggregated results only, never who voted for what."
      >
        <Switch
          id="results-visible"
          checked={value.ballotResultsVisibleToMembers}
          disabled={!canEdit}
          onCheckedChange={(v) => set("ballotResultsVisibleToMembers", v)}
        />
      </Row>
      <Row
        id="min-cell"
        label="Smallest result group shown to members"
        help="Choices with fewer votes than this show as “fewer than N”, so a small group's votes can't be singled out."
      >
        <Input
          id="min-cell"
          type="number"
          min={1}
          max={50}
          className="w-24"
          value={value.ballotMinCellSize}
          disabled={!canEdit}
          onChange={(e) => set("ballotMinCellSize", Number(e.target.value))}
        />
      </Row>
      <Row
        id="member-emails"
        label="Members see each other's emails"
        help="On the Members page. Owners and admins always see them."
      >
        <Switch
          id="member-emails"
          checked={value.showMemberEmailsToMembers}
          disabled={!canEdit}
          onCheckedChange={(v) => set("showMemberEmailsToMembers", v)}
        />
      </Row>
      <Row
        id="contact-emails"
        label="Who sees website contacts' emails"
        help="In the People, Attendance and Signups databases."
      >
        <select
          id="contact-emails"
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          value={value.contactEmailVisibility}
          disabled={!canEdit}
          onChange={(e) =>
            set("contactEmailVisibility", e.target.value as PrivacyInput["contactEmailVisibility"])
          }
        >
          {VISIBILITY_OPTIONS.filter((o) => o.value !== "HIDDEN").map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      <Row
        id="public-events"
        label="Public events feed"
        help="Publishes upcoming PUBLIC events at /api/public/{your URL}/events for your website. Internal events are never included."
      >
        <Switch
          id="public-events"
          checked={value.publicEventsEnabled}
          disabled={!canEdit}
          onCheckedChange={(v) => set("publicEventsEnabled", v)}
        />
      </Row>
      {canEdit && (
        <div className="flex items-center gap-3 py-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save privacy settings"}
          </Button>
          <StatusLine status={status} />
        </div>
      )}
    </form>
  );
}

export function BallotVisibilityForm({
  orgId,
  value: initial,
  canEdit,
}: {
  orgId: string;
  value: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<Status>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <Label htmlFor="ballot-visibility">Who can see individual votes</Label>
      <p className="text-muted-foreground text-xs">
        Who voted for what in ballots and elections. Everyone else sees only aggregated results.
        {canEdit ? "" : " Only an owner can change this."}
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          id="ballot-visibility"
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          value={value}
          disabled={!canEdit}
          onChange={(e) => setValue(e.target.value)}
        >
          <option value="OWNER_ONLY">Owners only (default)</option>
          <option value="OWNER_AND_ADMINS">Owners and admins</option>
          <option value="NOBODY">Nobody (also left out of exports)</option>
        </select>
        {canEdit && (
          <Button
            variant="outline"
            disabled={isPending || value === initial}
            onClick={() =>
              startTransition(async () => {
                setStatus(null);
                const result = await updateBallotVisibility(orgId, value);
                setStatus(
                  result.error
                    ? { tone: "error", text: result.error }
                    : { tone: "ok", text: "Saved." },
                );
                if (!result.error) router.refresh();
              })
            }
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      <StatusLine status={status} />
    </div>
  );
}

export function DatabaseVisibilityRow({
  orgId,
  id,
  name,
  value: initial,
  canEdit,
}: {
  orgId: string;
  id: string;
  name: string;
  value: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3">
      <label htmlFor={`db-${id}`} className="text-sm font-medium">
        {name}
      </label>
      <div className="flex items-center gap-2">
        <select
          id={`db-${id}`}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          defaultValue={initial}
          disabled={!canEdit || isPending}
          onChange={(e) => {
            const next = e.target.value;
            startTransition(async () => {
              setStatus(null);
              const result = await updateDatabaseVisibility(orgId, id, next);
              setStatus(
                result.error
                  ? { tone: "error", text: result.error }
                  : { tone: "ok", text: "Saved." },
              );
              if (!result.error) router.refresh();
            });
          }}
        >
          {VISIBILITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <StatusLine status={status} />
      </div>
    </li>
  );
}
