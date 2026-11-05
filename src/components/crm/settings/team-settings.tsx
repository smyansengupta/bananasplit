"use client";

import { useState } from "react";

import { setAccessAction, setManagersAction } from "@/app/app/[orgSlug]/crm/actions";
import { saveRoutingAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { SettingsCard, SettingsStatus } from "@/app/app/[orgSlug]/settings/settings-card";
import { CrmAvatar } from "@/components/crm/card/crm-card";
import { Plus, Trash2 } from "@/components/icons";
import { SavedMark } from "@/components/ui/autosave";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { Routing, RoutingRule } from "@/lib/crm/outreach/assign";
import { cn } from "@/lib/utils";

import { useAutoSave, useSave } from "./use-save";

/**
 * CRM settings > Team (not in a Personal space): what members see, who
 * runs the CRM with them, and who new people go to, each saved as it
 * changes, except rules, which are written first and then saved. Roles and
 * invites stay in the Admin panel's Members.
 */

export interface TeamMember {
  id: string;
  name: string;
  owns: number;
  /** Owner or admin: always runs the CRM. */
  admin: boolean;
}

export function AccessCard({ orgId, initial }: { orgId: string; initial: "ALL" | "OWN" }) {
  const [mode, setMode] = useState(initial);
  const auto = useAutoSave((next: "ALL" | "OWN") => setAccessAction(orgId, next));
  return (
    <SettingsCard
      title="Who sees what"
      action={<SavedMark status={auto.status} error={auto.error} />}
    >
      <div className="flex flex-wrap items-center gap-3">
        <b className="flex-[1_1_12rem] text-[15px] font-semibold">Members see</b>
        <Segmented
          label="Members see"
          value={mode}
          onSelect={(v) => {
            setMode(v as "ALL" | "OWN");
            void auto.save(v as "ALL" | "OWN");
          }}
          options={[
            { value: "ALL", label: "Everyone" },
            { value: "OWN", label: "Only their own people" },
          ]}
        />
      </div>
    </SettingsCard>
  );
}

export function ManagersCard({
  orgId,
  members,
  initial,
  membersHref,
}: {
  orgId: string;
  members: TeamMember[];
  initial: string[];
  membersHref: string;
}) {
  const [ids, setIds] = useState(new Set(initial));
  const auto = useAutoSave((next: string[]) => setManagersAction(orgId, next));
  return (
    <SettingsCard
      title="CRM managers"
      description="They set up stages, fields and automations without being admins."
      action={<SavedMark status={auto.status} error={auto.error} />}
      status={
        <a
          href={membersHref}
          className="text-muted-foreground hover:text-foreground text-sm underline-offset-2 hover:underline"
        >
          Roles and invites are in Admin, Members
        </a>
      }
    >
      <ul className="divide-border divide-y">
        {members.map((m) => {
          const on = m.admin || ids.has(m.id);
          return (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <CrmAvatar name={m.name} size={34} />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[15px] font-semibold">{m.name}</b>
                <span className="text-muted-foreground text-sm">
                  {m.admin
                    ? "Owner or admin"
                    : m.owns
                      ? `Looks after ${m.owns.toLocaleString("en-US")} people`
                      : "Looks after nobody yet"}
                </span>
              </span>
              <Switch
                checked={on}
                disabled={m.admin}
                aria-label={`${m.name} runs the CRM`}
                onCheckedChange={(v) => {
                  const next = new Set(ids);
                  if (v) next.add(m.id);
                  else next.delete(m.id);
                  setIds(next);
                  void auto.save([...next]);
                }}
              />
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}

const FIELDS: { value: RoutingRule["field"]; label: string }[] = [
  { value: "relationship", label: "Relationship" },
  { value: "source", label: "Source" },
  { value: "company", label: "Company" },
  { value: "location", label: "Location" },
  { value: "title", label: "Title" },
  { value: "email", label: "Email" },
];

export function RoutingCard({
  orgId,
  initial,
  members,
  relationshipTypes,
}: {
  orgId: string;
  initial: Routing;
  members: { id: string; name: string }[];
  relationshipTypes: { id: string; label: string }[];
}) {
  const [routing, setRouting] = useState(initial);
  const { pending, status, save } = useSave();
  /** Off and In turn save as they change. Rules wait for Save: one's half-written until then. */
  const change = (next: Routing) => {
    setRouting(next);
    if (next.mode !== "rules") save(() => saveRoutingAction(orgId, next));
  };
  const setRule = (i: number, patch: Partial<RoutingRule>) =>
    setRouting({
      ...routing,
      rules: routing.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveRoutingAction(orgId, routing));
      }}
    >
      <SettingsCard
        title="Who new people go to"
        status={<SettingsStatus status={status} />}
        footer={
          routing.mode !== "rules" ? undefined : (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={!members.length}
                onClick={() =>
                  setRouting({
                    ...routing,
                    rules: [
                      ...routing.rules,
                      { field: "relationship", op: "is", value: "", ownerId: members[0]!.id },
                    ],
                  })
                }
              >
                <Plus className="size-4" aria-hidden="true" />
                Add a rule
              </Button>
              <Button type="submit" disabled={pending}>
                Save
              </Button>
            </>
          )
        }
      >
        <Segmented
          label="Who new people go to"
          value={routing.mode}
          onSelect={(v) => change({ ...routing, mode: v as Routing["mode"] })}
          options={[
            { value: "off", label: "Nobody yet" },
            { value: "round-robin", label: "In turn" },
            { value: "rules", label: "By rules, then in turn" },
          ]}
        />
        {routing.mode === "rules" &&
          routing.rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">When</span>
              <FieldSelect
                value={r.field}
                onChange={(e) => setRule(i, { field: e.target.value as RoutingRule["field"] })}
                className="w-36"
              >
                {FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </FieldSelect>
              <span className="text-muted-foreground">{r.op === "is" ? "is" : "has"}</span>
              {r.field === "relationship" && relationshipTypes.length > 0 ? (
                <FieldSelect
                  value={r.value}
                  onChange={(e) => setRule(i, { value: e.target.value, op: "is" })}
                  className="w-40"
                  aria-label="Relationship"
                >
                  <option value="">Pick one</option>
                  {relationshipTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </FieldSelect>
              ) : (
                <Input
                  value={r.value}
                  onChange={(e) => setRule(i, { value: e.target.value, op: "contains" })}
                  className="h-9 w-40"
                  aria-label="Value"
                />
              )}
              <span className="text-muted-foreground">give them to</span>
              <FieldSelect
                value={r.ownerId}
                onChange={(e) => setRule(i, { ownerId: e.target.value })}
                className="w-40"
                aria-label="Owner"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </FieldSelect>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove rule"
                onClick={() =>
                  setRouting({ ...routing, rules: routing.rules.filter((_, j) => j !== i) })
                }
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        {routing.mode !== "off" && (
          <div className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">In turn among</span>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={routing.pool.includes(m.id)}
                  className={cn(chipClass(routing.pool.includes(m.id)), "h-8 px-3")}
                  onClick={() =>
                    change({
                      ...routing,
                      pool: routing.pool.includes(m.id)
                        ? routing.pool.filter((x) => x !== m.id)
                        : [...routing.pool, m.id],
                    })
                  }
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </SettingsCard>
    </form>
  );
}
