"use client";

import { useCallback, useState } from "react";

import {
  addFieldAction,
  deleteFieldAction,
  saveRelationshipTypesAction,
  setRequiredAction,
  updateFieldAction,
} from "@/app/app/[orgSlug]/crm/actions";
import {
  relationDatabasesAction,
  searchRelationTargetsAction,
} from "@/app/app/[orgSlug]/databases/custom-actions";
import { SettingsCard, SettingsStatus } from "@/app/app/[orgSlug]/settings/settings-card";
import {
  choicesFromText,
  FieldOptionsEditor,
  needsOptions,
  optionsReady,
  startingOptions,
} from "@/components/databases/custom/field-options";
import {
  RelationProvider,
  type RelationDatabases,
  type RelationSearch,
} from "@/components/databases/custom/relation-cell";
import { Plus, Trash2, X } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import {
  FIELD_TYPE_META,
  FIELD_TYPES,
  type FieldDef,
  type FieldOptions,
  type FieldType,
} from "@/lib/databases/fields";
import { cn } from "@/lib/utils";

import { useSave } from "./use-save";

/**
 * CRM settings > Deals and fields: the custom fields of People, Companies or one
 * pipeline (renamed in place, required or not, deleted), adding one with
 * its type, and the relationship types people are tagged with.
 */

export interface FieldGroup {
  key: string;
  title: string;
  object: "person" | "company" | "deal";
  pipelineId?: string;
  databaseId: string | null;
  fields: FieldDef[];
  required: string[];
  builtins: { key: string; label: string }[];
}

export function CustomFieldsCard({
  orgId,
  orgSlug,
  group,
}: {
  orgId: string;
  orgSlug: string;
  group: FieldGroup;
}) {
  const search = useCallback<RelationSearch>(
    async (input) => (await searchRelationTargetsAction(orgId, input)).data ?? [],
    [orgId],
  );
  const databases = useCallback<RelationDatabases>(
    async () => (await relationDatabasesAction(orgId)).data ?? [],
    [orgId],
  );
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("TEXT");
  const [options, setOptions] = useState<FieldOptions>({});
  const [choices, setChoices] = useState("");
  const { pending, status, save } = useSave();
  const required = new Set(group.required);
  const canRequire = Boolean(group.databaseId) && group.object !== "deal";
  const ready = name.trim() && (!needsOptions(type) || optionsReady(type, options));
  return (
    <RelationProvider
      orgId={orgId}
      orgSlug={orgSlug}
      labels={{}}
      search={search}
      databases={databases}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          const opts =
            type === "SELECT" || type === "MULTI_SELECT"
              ? { ...options, choices: choicesFromText(choices, []) }
              : options;
          save(
            () =>
              addFieldAction(
                orgId,
                { object: group.object, pipelineId: group.pipelineId },
                { name, type, options: opts },
              ),
            "Field added.",
          );
          setName("");
          setChoices("");
        }}
      >
        <SettingsCard
          title="Custom fields"
          status={<SettingsStatus status={status} />}
          footer={
            <Button type="submit" disabled={pending || !ready}>
              Add field
            </Button>
          }
        >
          {group.fields.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No fields of your own on {group.title} yet.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {group.fields.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <input
                    defaultValue={f.name}
                    aria-label="Field name"
                    className="min-w-0 flex-[1_1_12rem] bg-transparent text-[15px] font-semibold outline-none"
                    onBlur={(e) =>
                      e.target.value.trim() &&
                      e.target.value !== f.name &&
                      save(
                        () => updateFieldAction(orgId, f.id, { name: e.target.value }),
                        "Renamed.",
                      )
                    }
                  />
                  <Badge variant="secondary">{FIELD_TYPE_META[f.type].label}</Badge>
                  {canRequire && (
                    <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <Switch
                        checked={required.has(f.id)}
                        onCheckedChange={(v) =>
                          save(() => setRequiredAction(orgId, group.databaseId!, f.id, v))
                        }
                      />
                      Required
                    </label>
                  )}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${f.name}`}
                    onClick={() =>
                      save(
                        () => deleteFieldAction(orgId, f.id),
                        `${f.name} is deleted. Its old values stay in each record's history.`,
                      )
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {canRequire && group.builtins.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground me-1">Required everywhere</span>
              {group.builtins.map((b) => {
                const on = required.has(b.key);
                return (
                  <button
                    key={b.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      save(() => setRequiredAction(orgId, group.databaseId!, b.key, !on))
                    }
                    className={cn(chipClass(on), "h-7 px-2.5 text-xs")}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="border-border space-y-3 border-t pt-4">
            <label className="border-input flex h-11 items-center gap-2.5 rounded-full border border-dashed px-4">
              <Plus className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Add a field, like Shirt size"
                aria-label="New field name"
                className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
            </label>
            {name.trim() && (
              <>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Field type">
                  {FIELD_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={type === t}
                      title={FIELD_TYPE_META[t].hint}
                      onClick={() => {
                        setType(t);
                        setOptions(startingOptions(t));
                      }}
                      className={cn(chipClass(type === t), "h-8 px-3 text-[13px]")}
                    >
                      {FIELD_TYPE_META[t].label}
                    </button>
                  ))}
                </div>
                {(type === "SELECT" || type === "MULTI_SELECT") && (
                  <Input
                    value={choices}
                    onChange={(e) => setChoices(e.target.value)}
                    placeholder="Choices, separated by commas"
                    aria-label="Choices"
                  />
                )}
                {needsOptions(type) && (
                  <FieldOptionsEditor
                    type={type}
                    options={options}
                    onChange={setOptions}
                    idPrefix={`crm-${group.key}`}
                  />
                )}
              </>
            )}
          </div>
        </SettingsCard>
      </form>
    </RelationProvider>
  );
}

export function RelationshipTypesCard({
  orgId,
  initial,
}: {
  orgId: string;
  initial: { id: string; label: string; color: string }[];
}) {
  const [types, setTypes] = useState(initial);
  const { pending, status, save } = useSave();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(() =>
          saveRelationshipTypesAction(
            orgId,
            types.filter((t) => t.label.trim()),
          ),
        );
      }}
    >
      <SettingsCard
        title="Relationship types"
        status={<SettingsStatus status={status} />}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setTypes((cur) => [
                  ...cur,
                  { id: `type-${Date.now().toString(36)}`, label: "", color: "gray" },
                ])
              }
            >
              Add a type
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </>
        }
      >
        <ul className="grid gap-2 sm:grid-cols-2">
          {types.map((t, i) => (
            <li key={t.id} className="flex items-center gap-1.5">
              <Input
                value={t.label}
                aria-label="Relationship type"
                autoFocus={!t.label && i === types.length - 1}
                onChange={(e) =>
                  setTypes((cur) =>
                    cur.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${t.label || "this type"}`}
                onClick={() => setTypes((cur) => cur.filter((_, j) => j !== i))}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </form>
  );
}
