"use client";

import { ChevronDown, Sparkles, X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { saveRecordAction } from "@/app/app/[orgSlug]/crm/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { AI_FILL_PENDING, readRelation, type RelationRef } from "@/lib/databases/fields";
import { crmRecordHref } from "@/lib/crm/href";
import type { EditField } from "@/lib/crm/record-form";
import { cn } from "@/lib/utils";

import { CrmPicker } from "./crm-picker";

/**
 * A record's fields, each saved on its own as you leave it (or pick from
 * it), the way a database cell saves. The record page and the Databases row
 * panel both use it, through the one save action, so they edit the same
 * record. A stage that wants more (a reason on Lost, an amount) asks for
 * exactly that in one step.
 */

export type RecordKind = "person" | "company" | "deal";

type Saver = (key: string, value: unknown) => Promise<boolean>;

export function RecordFields({
  orgId,
  orgSlug,
  kind,
  id,
  fields,
  readOnly = false,
  compact = false,
}: {
  orgId: string;
  orgSlug: string;
  kind: RecordKind;
  id: string;
  fields: EditField[];
  readOnly?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [showMore, setShowMore] = useState(false);
  const [needs, setNeeds] = useState<{ stageId: string; keys: string[]; labels: string[] } | null>(null);
  const [, start] = useTransition();

  const save: Saver = async (key, value) => {
    setState("saving");
    const r = await saveRecordAction(orgId, kind, id, { [key]: value }).catch(() => null);
    if (!r || !r.ok) {
      setState("failed");
      toast({ title: r && !r.ok ? r.error : "That didn't save. Try again.", tone: "error" });
      return false;
    }
    if (r.needs) {
      setState("idle");
      setNeeds({ stageId: String(value), keys: r.needs.keys, labels: r.needs.labels });
      return false;
    }
    setState("saved");
    start(() => router.refresh());
    return true;
  };

  const main = fields.filter((f) => !f.more && f.kind !== "CUSTOM");
  const more = fields.filter((f) => f.more);
  const custom = fields.filter((f) => f.kind === "CUSTOM");

  return (
    <div className="space-y-4">
      <div className="text-muted-foreground flex h-4 items-center justify-end text-xs" aria-live="polite">
        {state === "saving" ? "Saving…" : state === "saved" ? "All changes saved" : state === "failed" ? "Last change not saved" : ""}
      </div>
      <dl className={cn("grid gap-x-4 gap-y-3", compact ? "grid-cols-1" : "sm:grid-cols-[9rem_minmax(0,1fr)]")}>
        {[...main, ...custom].map((f) => (
          <FieldRow key={f.key} f={f} orgId={orgId} orgSlug={orgSlug} save={save} readOnly={readOnly} compact={compact} />
        ))}
        {showMore &&
          more.map((f) => (
            <FieldRow key={f.key} f={f} orgId={orgId} orgSlug={orgSlug} save={save} readOnly={readOnly} compact={compact} />
          ))}
      </dl>
      {more.length > 0 && (
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
        >
          <ChevronDown className={cn("size-4 transition-transform", showMore && "rotate-180")} aria-hidden="true" />
          {showMore ? "Fewer fields" : `${more.length} more fields`}
        </button>
      )}
      {needs && (
        <NeedsDialog
          title="Before it moves"
          needs={needs}
          fields={fields}
          orgId={orgId}
          onCancel={() => setNeeds(null)}
          onSubmit={async (fill) => {
            setState("saving");
            const r = await saveRecordAction(orgId, kind, id, { ...fill, stage: needs.stageId }).catch(() => null);
            if (!r || !r.ok) {
              setState("failed");
              toast({ title: r && !r.ok ? r.error : "That didn't save.", tone: "error" });
              return;
            }
            if (r.needs) {
              setNeeds({ ...needs, keys: r.needs.keys, labels: r.needs.labels });
              setState("idle");
              return;
            }
            setNeeds(null);
            setState("saved");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function FieldRow({
  f,
  orgId,
  orgSlug,
  save,
  readOnly,
  compact,
}: {
  f: EditField;
  orgId: string;
  orgSlug: string;
  save: Saver;
  readOnly: boolean;
  compact: boolean;
}) {
  return (
    <>
      <dt className={cn("text-muted-foreground text-sm", !compact && "sm:pt-2")}>
        {f.label}
        {f.required && <span className="sr-only"> (required)</span>}
        {f.required && (
          <span aria-hidden="true" className="text-tint-danger-foreground ms-0.5">
            *
          </span>
        )}
      </dt>
      <dd className="min-w-0">
        <FieldEditor f={f} orgId={orgId} orgSlug={orgSlug} save={save} readOnly={readOnly || Boolean(f.readOnly)} />
      </dd>
    </>
  );
}

/** One field's editor; saves on blur, on Enter, or when something is picked. */
export function FieldEditor({
  f,
  orgId,
  orgSlug,
  save,
  readOnly,
  onLocal,
}: {
  f: EditField;
  orgId: string;
  orgSlug: string;
  save?: Saver;
  readOnly?: boolean;
  /** For forms that collect values instead of saving each (the needs dialog). */
  onLocal?: (value: unknown) => void;
}) {
  const initial = f.value ?? (f.kind === "CHECKBOX" ? false : "");
  const [value, setValue] = useState<unknown>(initial);
  const [display, setDisplay] = useState<string | null | undefined>(f.display);
  useEffect(() => {
    setValue(f.value ?? (f.kind === "CHECKBOX" ? false : ""));
    setDisplay(f.display);
  }, [f.value, f.display, f.kind]);

  const commit = async (next: unknown) => {
    if (onLocal) {
      onLocal(next);
      return;
    }
    if (!save || JSON.stringify(next ?? "") === JSON.stringify(f.value ?? "")) return;
    const ok = await save(f.key, next);
    if (!ok) setValue(f.value ?? "");
  };
  const set = (next: unknown) => {
    setValue(next);
    if (onLocal) onLocal(next);
  };

  if (readOnly) {
    return <p className="py-2 text-sm">{readValue(f, value, display) || <span className="text-muted-foreground">Empty</span>}</p>;
  }

  const fieldType = f.kind === "CUSTOM" ? f.field!.type : f.kind;
  switch (fieldType) {
    case "LONG_TEXT":
      return (
        <Textarea
          value={String(value ?? "")}
          onChange={(e) => set(e.target.value)}
          onBlur={() => commit(value)}
          rows={3}
          aria-label={f.label}
        />
      );
    case "CHECKBOX":
      return (
        <Switch
          checked={value === true}
          onCheckedChange={(v) => {
            set(v);
            void commit(v);
          }}
          aria-label={f.label}
        />
      );
    case "SELECT":
    case "STAGE":
    case "OWNER": {
      const options =
        f.kind === "CUSTOM"
          ? (f.field!.options.choices ?? []).map((c) => ({ value: c.id, label: c.label }))
          : (f.options ?? []);
      return (
        <FieldSelect
          value={String(value ?? "")}
          onChange={(e) => {
            set(e.target.value);
            void commit(e.target.value);
          }}
          aria-label={f.label}
        >
          {f.kind !== "STAGE" && <option value="">{f.kind === "OWNER" ? "Nobody" : "Not set"}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FieldSelect>
      );
    }
    case "MULTI_SELECT": {
      const picked = new Set(Array.isArray(value) ? (value as string[]) : []);
      const choices = f.field!.options.choices ?? [];
      return (
        <div className="flex flex-wrap gap-1.5 py-1">
          {choices.map((c) => {
            const on = picked.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = choices.filter((x) => (x.id === c.id ? !on : picked.has(x.id))).map((x) => x.id);
                  set(next);
                  void commit(next.length ? next : null);
                }}
                className={cn(
                  "h-8 rounded-full border px-3 text-[13px]",
                  on ? "bg-primary text-primary-foreground border-transparent" : "border-input hover:bg-muted",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      );
    }
    case "MEMBER":
      return (
        <FieldSelect
          value={String(value ?? "")}
          onChange={(e) => {
            set(e.target.value);
            void commit(e.target.value || null);
          }}
          aria-label={f.label}
        >
          <option value="">Nobody</option>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FieldSelect>
      );
    case "COMPANY":
    case "PERSON":
      return (
        <CrmPicker
          orgId={orgId}
          kind={fieldType === "COMPANY" ? "company" : "person"}
          value={(value as string) || null}
          display={display}
          placeholder={fieldType === "COMPANY" ? "Pick a company" : "Pick a person"}
          onPick={(hit) => {
            set(hit?.id ?? null);
            setDisplay(hit?.label ?? null);
            void commit(hit?.id ?? null);
          }}
        />
      );
    case "RELATION": {
      const target = f.field!.options.target?.kind ?? "person";
      const refs = readRelation(value);
      if (target === "record") {
        return <p className="text-muted-foreground py-2 text-sm">{refs.length ? `${refs.length} linked` : "Link rows from the database"}</p>;
      }
      return (
        <RelationEditor
          orgId={orgId}
          orgSlug={orgSlug}
          kind={target}
          refs={refs}
          single={Boolean(f.field!.options.single)}
          labels={(f.display ? JSON.parse(f.display) : {}) as Record<string, string>}
          onChange={(next) => {
            set(next);
            void commit(next.length ? next : null);
          }}
        />
      );
    }
    case "AI":
      return (
        <div className="flex items-center gap-2">
          <Input
            value={String(value ?? "")}
            onChange={(e) => set(e.target.value)}
            onBlur={() => commit(value)}
            aria-label={f.label}
            className="min-w-0 flex-1"
          />
          <Button type="button" variant="outline" size="sm" disabled title={AI_FILL_PENDING}>
            <Sparkles className="size-3.5" aria-hidden="true" />
            Fill
          </Button>
        </div>
      );
    case "NUMBER":
    case "CURRENCY":
      return (
        <Input
          type="number"
          inputMode="decimal"
          step={fieldType === "CURRENCY" ? "0.01" : "any"}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))}
          onBlur={() => commit(value === "" ? null : value)}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          aria-label={f.label}
          className="max-w-48"
        />
      );
    case "DATE":
      return (
        <Input
          type="date"
          value={String(value ?? "")}
          onChange={(e) => {
            set(e.target.value);
            void commit(e.target.value || null);
          }}
          aria-label={f.label}
          className="max-w-48"
        />
      );
    default:
      return (
        <Input
          type={fieldType === "EMAIL" ? "email" : fieldType === "URL" ? "url" : fieldType === "PHONE" ? "tel" : "text"}
          value={String(value ?? "")}
          onChange={(e) => set(e.target.value)}
          onBlur={() => commit(value)}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          aria-label={f.label}
        />
      );
  }
}

function readValue(f: EditField, value: unknown, display?: string | null): string {
  if (display) return display;
  if (value === null || value === undefined || value === "") return "";
  if (f.kind === "CHECKBOX") return value === true ? "Yes" : "No";
  if (f.options) return f.options.find((o) => o.value === value)?.label ?? String(value);
  if (f.kind === "CUSTOM" && f.field?.options.choices) {
    const ids = Array.isArray(value) ? value : [value];
    return ids.map((i) => f.field!.options.choices!.find((c) => c.id === i)?.label ?? "").filter(Boolean).join(", ");
  }
  return typeof value === "object" ? "" : String(value);
}

function RelationEditor({
  orgId,
  orgSlug,
  kind,
  refs,
  single,
  labels,
  onChange,
}: {
  orgId: string;
  orgSlug: string;
  kind: "person" | "company" | "deal";
  refs: RelationRef[];
  single: boolean;
  labels: Record<string, string>;
  onChange: (refs: RelationRef[]) => void;
}) {
  const [names, setNames] = useState(labels);
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1">
      {refs.map((r) => (
        <Badge key={r.id} variant="secondary" className="gap-1 pe-1">
          <Link href={crmRecordHref(orgSlug, r.kind as "person" | "company" | "deal", r.id)} className="hover:underline">
            {names[`${r.kind}:${r.id}`] ?? "Linked"}
          </Link>
          <button
            type="button"
            aria-label="Remove link"
            onClick={() => onChange(refs.filter((x) => x.id !== r.id))}
            className="hover:bg-background grid size-5 place-items-center rounded-full"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </Badge>
      ))}
      {(!single || refs.length === 0) && (
        <CrmPicker
          orgId={orgId}
          kind={kind}
          value={null}
          allowClear={false}
          placeholder="Link"
          onPick={(hit) => {
            if (!hit || refs.some((r) => r.id === hit.id)) return;
            setNames((n) => ({ ...n, [`${kind}:${hit.id}`]: hit.label }));
            onChange([...refs, { kind, id: hit.id }]);
          }}
        />
      )}
    </div>
  );
}

/**
 * What a stage asks for before an item moves into it: just those fields, in
 * one step (a reason on Lost, an amount on Pledged).
 */
export function NeedsDialog({
  title,
  needs,
  fields,
  orgId,
  onSubmit,
  onCancel,
  reasonPrompt,
}: {
  title: string;
  needs: { keys: string[]; labels: string[] };
  /** Editors for the keys, when known (the record form); others get a text box. */
  fields: readonly EditField[];
  orgId: string;
  onSubmit: (fill: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  /** Ask for a reason even when it isn't required (the closing stages). */
  reasonPrompt?: string;
}) {
  const [fill, setFill] = useState<Record<string, unknown>>({});
  const [pending, setPending] = useState(false);
  const keys = reasonPrompt && !needs.keys.includes("closeReason") ? ["closeReason", ...needs.keys] : needs.keys;
  const labelOf = (k: string, i: number) =>
    k === "closeReason" ? "Reason" : (needs.labels[needs.keys.indexOf(k)] ?? needs.labels[i] ?? k);
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {reasonPrompt ?? (needs.labels.length === 1 ? `Add ${needs.labels[0]} first.` : `Add these first.`)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            await onSubmit(fill);
            setPending(false);
          }}
        >
          {keys.map((k, i) => {
            const known =
              fields.find((f) => f.key === k || f.key === `custom.${k}`) ??
              ({ key: k, label: labelOf(k, i), kind: k === "closeReason" ? "LONG_TEXT" : "TEXT", value: null } as EditField);
            const key = known.key;
            return (
              <label key={key} className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">{known.label}</span>
                <FieldEditor
                  f={{ ...known, value: fill[key] ?? known.value }}
                  orgId={orgId}
                  orgSlug=""
                  onLocal={(v) => setFill((cur) => ({ ...cur, [key]: v }))}
                />
              </label>
            );
          })}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Moving…" : "Move it"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
