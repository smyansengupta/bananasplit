"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";

import { SettingsCard } from "../settings-card";
import {
  type PrivacyInput,
  updateBallotVisibility,
  updateConnectorsEnabled,
  updateDatabaseVisibility,
  updateMemberCanDeleteDatabases,
  updatePrivacy,
} from "./actions";

/** Who may see something, shortest first: the same four words on every row. */
const VISIBILITY_OPTIONS = [
  { value: "MEMBERS", label: "All" },
  { value: "ADMINS", label: "Admins" },
  { value: "OWNER", label: "Owners" },
  { value: "HIDDEN", label: "Hidden" },
] as const;

const BALLOT_OPTIONS = [
  { value: "OWNER_ONLY", label: "Owners" },
  { value: "OWNER_AND_ADMINS", label: "Owners and admins" },
  { value: "NOBODY", label: "Nobody" },
] as const;

/** One setting: its name and a short line on the left, its control on the right. */
function Row({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4 first:pt-0 last:pb-0">
      <div className="max-w-md min-w-0 flex-1 basis-64">
        <Label htmlFor={id} className="font-semibold">
          {label}
        </Label>
        {help && <p className="text-muted-foreground mt-1 text-[13px]">{help}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Ballots and Members: every control saves as it changes (the vote
 * visibility on its own action, owners only; the rest together).
 */
export function PrivacySettings({
  orgId,
  orgSlug,
  initial,
  ballotVisibility,
  canEditBallots,
}: {
  orgId: string;
  orgSlug: string;
  initial: PrivacyInput;
  ballotVisibility: string;
  canEditBallots: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<PrivacyInput>(initial);
  const [votes, setVotes] = useState(ballotVisibility);
  const [minCell, setMinCell] = useState(String(initial.ballotMinCellSize));
  const settings = useSaveOnChange(async (next: PrivacyInput) => {
    const result = await updatePrivacy(orgId, next);
    if (!result.error) router.refresh();
    return result.error ?? null;
  });
  const ballots = useSaveOnChange(
    async (next: string) => {
      const result = await updateBallotVisibility(orgId, next);
      if (!result.error) router.refresh();
      return result.error ?? null;
    },
    { initial: ballotVisibility },
  );
  const set = <K extends keyof PrivacyInput>(k: K, v: PrivacyInput[K]) => {
    const next = { ...value, [k]: v };
    setValue(next);
    void settings.save(next);
  };

  return (
    <>
      <SettingsCard
        title="Ballots"
        action={
          <SavedMark
            status={ballots.status !== "idle" ? ballots.status : settings.status}
            error={ballots.error ?? settings.error}
          />
        }
      >
        <div className="divide-border/70 divide-y">
          <Row
            id="ballot-visibility"
            label="Who sees individual votes"
            help={
              <>
                Everyone else sees totals only.
                {votes === "NOBODY" && " Left out of exports."}
                {!canEditBallots && " Only an owner can change this."}
              </>
            }
          >
            <fieldset id="ballot-visibility" disabled={!canEditBallots} className="max-w-full">
              <div className="-mx-1 overflow-x-auto px-1 pb-1">
                <Segmented
                  label="Who sees individual votes"
                  value={votes}
                  onSelect={(v) => {
                    setVotes(v);
                    void ballots.save(v);
                  }}
                  options={BALLOT_OPTIONS}
                />
              </div>
            </fieldset>
          </Row>
          <Row id="results-visible" label="Members see results" help="Totals only.">
            <Switch
              id="results-visible"
              checked={value.ballotResultsVisibleToMembers}
              onCheckedChange={(v) => set("ballotResultsVisibleToMembers", v)}
            />
          </Row>
          <Row id="min-cell" label="Hide groups smaller than" help="Shows “fewer than N”.">
            <Input
              id="min-cell"
              type="number"
              min={1}
              max={50}
              className="w-24 tabular-nums"
              value={minCell}
              onChange={(e) => setMinCell(e.target.value)}
              onBlur={() => {
                const n = Math.min(50, Math.max(1, Math.round(Number(minCell) || 1)));
                setMinCell(String(n));
                if (n !== value.ballotMinCellSize) set("ballotMinCellSize", n);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </Row>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Members and the public feed"
        action={<SavedMark status={settings.status} error={settings.error} />}
      >
        <div className="divide-border/70 divide-y">
          <Row
            id="member-emails"
            label="Members see each other's emails"
            help="On People. Admins always see them."
          >
            <Switch
              id="member-emails"
              checked={value.showMemberEmailsToMembers}
              onCheckedChange={(v) => set("showMemberEmailsToMembers", v)}
            />
          </Row>
          <Row
            id="contact-emails"
            label="Website contacts' emails"
            help="In the People, Attendance and Signups databases."
          >
            <div id="contact-emails" className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
              <Segmented
                label="Who sees website contacts' emails"
                value={value.contactEmailVisibility}
                onSelect={(v) =>
                  set("contactEmailVisibility", v as PrivacyInput["contactEmailVisibility"])
                }
                options={VISIBILITY_OPTIONS.filter((o) => o.value !== "HIDDEN")}
              />
            </div>
          </Row>
          <Row
            id="public-events"
            label="Public events feed"
            help={
              <>
                For your website, at <code className="break-all">/api/public/{orgSlug}/events</code>
                . Internal events are left out.
              </>
            }
          >
            <Switch
              id="public-events"
              checked={value.publicEventsEnabled}
              onCheckedChange={(v) => set("publicEventsEnabled", v)}
            />
          </Row>
        </div>
      </SettingsCard>
    </>
  );
}

/** Who can browse one database, as four buttons that save on click. */
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
  const [value, setValue] = useState(initial);
  const { status, error, save } = useSaveOnChange(
    async (next: string) => {
      const result = await updateDatabaseVisibility(orgId, id, next);
      if (!result.error) router.refresh();
      return result.error ?? null;
    },
    { initial },
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <span id={`db-${id}`} className="min-w-0 text-sm font-semibold break-words">
        {name}
      </span>
      <div className="flex max-w-full items-center gap-3">
        <SavedMark status={status} error={error} />
        <fieldset disabled={!canEdit} className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
          <Segmented
            label={`Who can browse ${name}`}
            value={value}
            onSelect={(v) => {
              setValue(v);
              void save(v);
            }}
            options={VISIBILITY_OPTIONS}
          />
        </fieldset>
      </div>
    </li>
  );
}

/** AI apps: one switch, saved as it's flipped. */
export function ConnectorsSwitchForm({
  orgId,
  value: initial,
  canEdit,
}: {
  orgId: string;
  value: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const { status, error, save } = useSaveOnChange(
    async (next: boolean) => {
      const result = await updateConnectorsEnabled(orgId, next);
      if (result.error) {
        setValue(!next);
        return result.error;
      }
      router.refresh();
      return null;
    },
    { initial },
  );
  return (
    <SettingsCard title="AI apps" action={<SavedMark status={status} error={error} />}>
      <Row
        id="connectors-enabled"
        label="Allow AI apps"
        help="Members' AI apps see only what that member can. Off pauses them; nothing disconnects."
      >
        <Switch
          id="connectors-enabled"
          checked={value}
          disabled={!canEdit}
          onCheckedChange={(next) => {
            setValue(next);
            void save(next);
          }}
        />
      </Row>
    </SettingsCard>
  );
}

/**
 * Databases card, first row: whether members who can edit a database may
 * also delete it for good. Saves as it changes.
 */
export function DatabaseDeleteSwitch({ orgId, value: initial }: { orgId: string; value: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const { status, error, save } = useSaveOnChange(
    async (next: boolean) => {
      const result = await updateMemberCanDeleteDatabases(orgId, next);
      if (result.error) {
        setValue(!next);
        return result.error;
      }
      router.refresh();
      return null;
    },
    { initial },
  );
  return (
    <Row
      id="member-can-delete-databases"
      label="Members can delete databases"
      help="Members who can edit a database can also delete it for good. Off: only owners and admins can."
    >
      <div className="flex items-center gap-3">
        <SavedMark status={status} error={error} />
        <Switch
          id="member-can-delete-databases"
          checked={value}
          onCheckedChange={(next) => {
            setValue(next);
            void save(next);
          }}
        />
      </div>
    </Row>
  );
}
