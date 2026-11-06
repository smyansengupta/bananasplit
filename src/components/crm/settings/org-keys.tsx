"use client";

import { useState, type FormEvent } from "react";

import {
  removeOrgKeyAction,
  saveOrgKeyAction,
  setSpendCapAction,
  testOrgKeyAction,
  type OrgKeysActionResult,
} from "@/app/app/[orgSlug]/crm/org-keys-actions";
import { SettingsCard, SettingsStatus } from "@/app/app/[orgSlug]/settings/settings-card";
import { ExternalLink, KeyRound, RefreshCw, Trash2 } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMicros } from "@/lib/crm/ai-outputs";
import {
  formatCents,
  ORG_KEY_GROUPS,
  orgKeyInfo,
  type OrgKeyGroup,
  type OrgKeyId,
  type OrgKeysView,
  type OrgKeyState,
} from "@/lib/crm/org-keys";
import { cn } from "@/lib/utils";

/**
 * The organization's own keys for everything the CRM pays per use, with
 * the monthly spending cap and this month's use (owners and admins). Each
 * provider shows its saved key masked ("sk-ant-…4f2a"), Save (or Replace),
 * Test it and Remove (owners), and what it cost this month. Keys are
 * write-only: once saved, only the last four characters come back.
 * Standalone: it updates itself from each action's answer.
 *
 * Props:
 * - `orgId`: the organization's id.
 * - `view`: the first state (`OrgKeysView` in src/lib/crm/org-keys.ts),
 *   from `loadOrgKeys(orgId, actor)` in src/server/crm/org-keys.ts on the
 *   page (actor: `resolveActor(orgId)`), or from `loadOrgKeysAction`.
 * - `groups` (optional): which groups to show, in order; by default all of
 *   "ai", "research", "phone" and "email".
 * - `showCap` (optional, default true): show the monthly cap card.
 */
export function OrgKeys({
  orgId,
  view: initial,
  groups,
  showCap = true,
}: {
  orgId: string;
  view: OrgKeysView;
  groups?: readonly OrgKeyGroup[];
  showCap?: boolean;
}) {
  const [view, setView] = useState(initial);
  const shown = (groups ?? ORG_KEY_GROUPS.map((g) => g.id))
    .map((id) => ORG_KEY_GROUPS.find((g) => g.id === id))
    .filter((g): g is (typeof ORG_KEY_GROUPS)[number] => Boolean(g));

  function take(r: OrgKeysActionResult | null) {
    if (r?.view) setView(r.view);
  }

  return (
    <div className="space-y-5">
      {showCap && <CapCard orgId={orgId} view={view} onResult={take} />}
      {shown.map((g) => (
        <SettingsCard key={g.id} id={`org-keys-${g.id}`} title={g.label} description={g.body}>
          {g.id === "ai" && !view.aiOnPlan && (
            <p className="bg-tint-warning text-tint-warning-foreground rounded-tile p-3 text-sm">
              Your plan doesn&apos;t include AI yet, so saved AI keys aren&apos;t used.
            </p>
          )}
          <ul className="divide-border divide-y">
            {view.keys
              .filter((k) => k.group === g.id)
              .map((k) => (
                <KeyRow key={k.id} orgId={orgId} state={k} canRemove={view.canRemove} onResult={take} />
              ))}
          </ul>
        </SettingsCard>
      ))}
    </div>
  );
}

function CapCard({ orgId, view, onResult }: { orgId: string; view: OrgKeysView; onResult: (r: OrgKeysActionResult | null) => void }) {
  const [value, setValue] = useState(view.capCents === null ? "" : String(view.capCents / 100));
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const capMicros = view.capCents === null ? null : view.capCents * 10_000;
  const share = capMicros ? Math.min(1, view.spentMicros / capMicros) : 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    const raw = value.trim().replace(/^\$/, "");
    const dollars = raw === "" ? null : Number(raw);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) {
      setStatus({ tone: "error", text: "Enter an amount in dollars, or leave it empty for no cap." });
      return;
    }
    setPending(true);
    setStatus(null);
    const r = await setSpendCapAction(orgId, dollars).catch(() => null);
    setPending(false);
    onResult(r);
    setStatus(r ? (r.ok ? { tone: "ok", text: r.message } : { tone: "error", text: r.error }) : { tone: "error", text: "That didn't save." });
  }

  return (
    <form onSubmit={(e) => void save(e)}>
      <SettingsCard
        id="org-keys-cap"
        title="Monthly spending cap"
        description="One cap for everything your keys pay for: AI, research, lookups, texts, calls, transcripts and bulk email. Past it, the CRM stops and says so until next month or until you raise it."
        footer={
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        }
        status={<SettingsStatus status={status} />}
      >
        <div className="grid max-w-60 gap-1.5">
          <Label htmlFor="org-keys-cap-input">Cap in dollars</Label>
          <Input
            id="org-keys-cap-input"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="No cap"
            maxLength={10}
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm">
            <b className="tabular-nums">{formatMicros(view.spentMicros)}</b>
            <span className="text-muted-foreground">
              {" "}
              used in {view.month}
              {view.capCents !== null ? ` of ${formatCents(view.capCents)}` : ""}. Estimated from list prices; your providers&apos; bills are exact.
            </span>
          </p>
          {capMicros !== null && (
            <div
              role="meter"
              aria-label="This month's use against the cap"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(share * 100)}
              className="bg-muted-strong h-2 overflow-hidden rounded-full"
            >
              <div className={cn("h-full rounded-full", share >= 1 ? "bg-destructive" : "bg-primary")} style={{ width: `${share * 100}%` }} />
            </div>
          )}
        </div>
      </SettingsCard>
    </form>
  );
}

const STATUS_BADGE: Record<OrgKeyState["status"], { label: string; variant: "success" | "destructive" | "secondary" | "info" }> = {
  connected: { label: "Working", variant: "success" },
  attention: { label: "Needs attention", variant: "destructive" },
  untested: { label: "Not tested", variant: "info" },
  none: { label: "No key", variant: "secondary" },
};

function KeyRow({
  orgId,
  state,
  canRemove,
  onResult,
}: {
  orgId: string;
  state: OrgKeyState;
  canRemove: boolean;
  onResult: (r: OrgKeysActionResult | null) => void;
}) {
  const info = orgKeyInfo(state.id)!;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...defaults(state.id), ...state.values }));
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmUi, confirm] = useConfirm();
  const saved = state.status !== "none";
  const fieldId = (name: string) => `org-key-${state.id}-${name}`;

  async function act(kind: "save" | "test" | "remove", run: () => Promise<OrgKeysActionResult>) {
    setBusy(kind);
    setStatus(null);
    const r = await run().catch(() => null);
    setBusy(null);
    onResult(r);
    if (!r) {
      setStatus({ tone: "error", text: "That didn't work. Try again." });
      return;
    }
    setStatus(r.ok ? { tone: "ok", text: r.message } : { tone: "error", text: r.error });
    if (r.ok && kind === "save") {
      setOpen(false);
      setValues((v) => Object.fromEntries(Object.entries(v).filter(([name]) => info.fields.find((f) => f.name === name)?.type !== "secret")));
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Remove the ${info.label} key?`,
      description: "Anything in the CRM that uses it stops until a new key is saved.",
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (ok) await act("remove", () => removeOrgKeyAction(orgId, state.id));
  }

  return (
    <li className="space-y-3 py-3.5 first:pt-0 last:pb-0">
      {confirmUi}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {info.label}
            <Badge variant={STATUS_BADGE[state.status].variant}>{STATUS_BADGE[state.status].label}</Badge>
          </p>
          <p className="text-muted-foreground text-[13px]">{info.body}</p>
        </div>
        {state.masked && <code className="bg-muted rounded-md px-2 py-0.5 font-mono text-xs">{state.masked}</code>}
      </div>

      <p className="text-muted-foreground text-xs">
        {saved || state.uses > 0
          ? `${formatMicros(state.spentMicros)} this month, ${state.uses} ${state.uses === 1 ? "use" : "uses"}. `
          : ""}
        {info.priceNote}
      </p>
      {state.status === "attention" && state.lastError && <p className="text-destructive text-sm">{state.lastError}</p>}

      {open ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act("save", () => saveOrgKeyAction(orgId, state.id, values));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {info.fields.map((f) => (
              <div key={f.name} className="grid gap-1.5">
                <Label htmlFor={fieldId(f.name)}>
                  {f.label}
                  {f.optional && <span className="text-muted-foreground font-normal"> (optional)</span>}
                </Label>
                {f.type === "select" ? (
                  <Select value={values[f.name] ?? ""} onValueChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}>
                    <SelectTrigger id={fieldId(f.name)} className="w-full">
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectContent>
                      {(f.options ?? []).map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={fieldId(f.name)}
                    type={f.type === "secret" ? "password" : "text"}
                    autoComplete="off"
                    spellCheck={false}
                    value={values[f.name] ?? ""}
                    onChange={(e) => setValues((s) => ({ ...s, [f.name]: e.target.value }))}
                    placeholder={f.type === "secret" && saved ? "Leave empty to keep the saved one" : f.placeholder}
                    maxLength={600}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            Get a key at{" "}
            <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-foreground inline-flex items-center gap-1 underline underline-offset-2">
              {info.keyUrl.replace(/^https:\/\//, "").replace(/\/.*$/, "")}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
            . It&apos;s stored encrypted and never shown again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={busy !== null}>
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant={saved ? "outline" : "default"} onClick={() => setOpen(true)} disabled={busy !== null}>
            <KeyRound className="size-4" aria-hidden="true" />
            {saved ? "Replace key" : "Add key"}
          </Button>
          {saved && (
            <Button type="button" size="sm" variant="outline" onClick={() => void act("test", () => testOrgKeyAction(orgId, state.id))} disabled={busy !== null}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {busy === "test" ? "Testing…" : "Test it"}
            </Button>
          )}
          {saved && canRemove && (
            <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => void remove()} disabled={busy !== null}>
              <Trash2 className="size-4" aria-hidden="true" />
              {busy === "remove" ? "Removing…" : "Remove"}
            </Button>
          )}
          {saved && !canRemove && <span className="text-muted-foreground text-xs">Only owners can remove a key.</span>}
        </div>
      )}
      <SettingsStatus status={status} />
    </li>
  );
}

function defaults(id: OrgKeyId): Record<string, string> {
  return id === "openai" ? { vendor: "openai" } : {};
}
