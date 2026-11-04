"use client";

import { ArrowDown, ArrowUp, Bot, Globe, Loader2, Mail, Sparkles } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  fillColumnAction,
  followUpAgentAction,
  saveAgentSettingsAction,
  setAiCapAction,
  setEnrichmentOrderAction,
} from "@/app/app/[orgSlug]/crm/ai-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { formatMicros } from "@/lib/crm/ai-outputs";
import { crmRecordHref } from "@/lib/crm/href";
import { AI_AUTO_LABELS, type AiAuto } from "@/lib/databases/fields";
import type { TargetKind } from "@/lib/crm/suggestions";

interface Line {
  key: string;
  label: string;
  calls: number;
  costMicros: number;
}

interface Run {
  id: string;
  agent: "research" | "follow-up";
  status: "running" | "done" | "stopped" | "failed";
  target: { name: string; kind: TargetKind; id: string } | null;
  steps: { at: string; text: string }[];
  suggestions: string[];
  startedAt: string;
  auto: boolean;
}

function Block({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="bg-card ring-foreground/6 rounded-card space-y-4 p-6 ring-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="heading flex-1 text-lg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * AI in CRM settings: this month's use by feature and member against the
 * hard cap (owners and admins set it), the enrichment waterfall's order,
 * the agents with their run log, AI fields' column fills, and a note on
 * Bananasplit AI to come.
 */
export function AiSettings({
  orgId,
  orgSlug,
  admin,
  connection,
  usage,
  order: initialOrder,
  agents: initialAgents,
  runs,
  fields,
  showCap = true,
}: {
  orgId: string;
  orgSlug: string;
  admin: boolean;
  connection: string | null;
  usage: {
    total: number;
    platform: number;
    calls: number;
    lookups: number;
    byFeature: Line[];
    byMember: Line[];
    capCents: number | null;
    month: string;
  };
  order: { step: string; label: string; available: boolean }[];
  agents: { researchNew: boolean; followUp: boolean; followUpDays: number };
  runs: Run[];
  fields: { id: string; name: string; database: string; auto: AiAuto; research: boolean; hasPrompt: boolean }[];
  /** The cap form; off where the organization's keys card already has it (CRM settings > Connections). */
  showCap?: boolean;
}) {
  const router = useRouter();
  const [cap, setCap] = useState(usage.capCents === null ? "" : String(usage.capCents / 100));
  const [order, setOrder] = useState(initialOrder);
  const [agents, setAgents] = useState(initialAgents);
  const [busy, setBusy] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const capMicros = usage.capCents === null ? null : usage.capCents * 10_000;
  const share = capMicros ? Math.min(1, usage.total / capMicros) : null;

  const saveCap = async (value: string) => {
    const dollars = value.trim() === "" ? null : Number(value);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) {
      toast({ title: "Enter a dollar amount, or leave it empty for no cap.", tone: "error" });
      return;
    }
    setBusy("cap");
    const r = await setAiCapAction(orgId, dollars).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) return toast({ title: r && !r.ok ? r.error : "That didn't save.", tone: "error" });
    toast({ title: dollars === null ? "No monthly cap." : `Capped at $${dollars.toFixed(2)} a month.` });
    router.refresh();
  };

  const move = async (i: number, dir: -1 | 1) => {
    const next = [...order];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
    const r = await setEnrichmentOrderAction(orgId, next.map((o) => o.step)).catch(() => null);
    if (!r || !r.ok) toast({ title: r && !r.ok ? r.error : "That didn't save.", tone: "error" });
  };

  const saveAgents = async (patch: Partial<typeof agents>) => {
    const next = { ...agents, ...patch };
    setAgents(next);
    const r = await saveAgentSettingsAction(orgId, patch).catch(() => null);
    if (!r || !r.ok) {
      setAgents(agents);
      toast({ title: r && !r.ok ? r.error : "That didn't save.", tone: "error" });
    }
  };

  const followUpNow = async () => {
    setBusy("follow-up");
    const r = await followUpAgentAction(orgId, agents.followUpDays).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) return toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
    toast({ title: r.drafted ? `Drafted ${r.drafted} follow-ups. They wait in To approve.` : "Nobody of yours is going cold without a draft." });
    router.refresh();
  };

  const fill = async (fieldId: string, onlyEmpty: boolean) => {
    setBusy(`fill:${fieldId}`);
    const r = await fillColumnAction(orgId, fieldId, onlyEmpty).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) return toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
    toast({
      title:
        r.mode === "none"
          ? "Nothing to fill."
          : r.mode === "batch"
            ? `Sent ${r.rows} rows as one batch at half price. Values arrive within a day, usually within the hour.`
            : `Filling ${r.rows} rows in the background.`,
    });
  };

  return (
    <div className="space-y-5">
      <Block
        title="AI this month"
        action={<span className="text-muted-foreground text-sm">{connection ? `On ${connection}` : "No AI model connected"}</span>}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="bg-muted/45 rounded-2xl px-4 py-3">
            <p className="text-muted-foreground text-xs">Spent in {usage.month}</p>
            <p className="text-2xl font-semibold tabular-nums">{formatMicros(usage.total)}</p>
            <p className="text-muted-foreground text-xs">Estimated, on your organization&apos;s key</p>
          </div>
          <div className="bg-muted/45 rounded-2xl px-4 py-3">
            <p className="text-muted-foreground text-xs">AI requests</p>
            <p className="text-2xl font-semibold tabular-nums">{usage.calls}</p>
            <p className="text-muted-foreground text-xs">{usage.lookups} lookups on data connectors</p>
          </div>
          <div className="bg-muted/45 rounded-2xl px-4 py-3">
            <p className="text-muted-foreground text-xs">Monthly cap</p>
            <p className="text-2xl font-semibold tabular-nums">{capMicros === null ? "None" : formatMicros(capMicros)}</p>
            {share !== null && (
              <div className="bg-foreground/10 mt-2 h-1.5 overflow-hidden rounded-full" aria-label={`${Math.round(share * 100)} percent of the cap used`}>
                <div className={share >= 0.9 ? "bg-block-alert h-full" : "bg-primary h-full"} style={{ width: `${Math.max(2, share * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
        {!showCap ? null : admin ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveCap(cap);
            }}
          >
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Hard monthly cap, in dollars</span>
              <Input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" placeholder="No cap" className="h-10 w-40" />
            </label>
            <Button type="submit" variant="outline" disabled={busy === "cap"}>
              Save
            </Button>
            <p className="text-muted-foreground basis-full text-xs">Every AI request checks it first. Once it&apos;s reached, AI stops until next month or until you raise it.</p>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">Owners and admins set the monthly cap.</p>
        )}
        {(usage.byFeature.length > 0 || usage.byMember.length > 0) && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2">
            <UsageTable title="By feature" lines={usage.byFeature} />
            <UsageTable title="By member" lines={usage.byMember} />
          </div>
        )}
        {!admin && <p className="text-muted-foreground text-xs">You see your own use; owners and admins see everyone&apos;s.</p>}
      </Block>

      <Block title="Enrichment">
        <p className="text-muted-foreground text-sm">
          Enrich tries these in order and stops at the first that finds something, so you pay only for that one. Empty fields fill at once; anything
          already filled in waits in To approve instead.
        </p>
        <ol className="divide-border bg-muted/45 divide-y rounded-2xl">
          {order.map((o, i) => (
            <li key={o.step} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="text-muted-foreground w-5 tabular-nums">{i + 1}</span>
              <span className="flex-1 font-medium">{o.label}</span>
              {o.available ? <Badge variant="success">Ready</Badge> : <Badge variant="secondary">Not connected</Badge>}
              <Button size="icon" variant="ghost" aria-label={`Move ${o.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" aria-hidden="true" />
              </Button>
              <Button size="icon" variant="ghost" aria-label={`Move ${o.label} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
        <p className="text-muted-foreground text-xs">
          Add a Tavily, Hunter or Prospeo key under Research and lookups above. Claude web search works with your
          organization&apos;s Claude key.
        </p>
      </Block>

      <Block title="Agents">
        <p className="text-muted-foreground text-sm">Agents stop at suggestions and drafts. Nothing is sent or changed until someone accepts it in To approve.</p>
        <div className="divide-border divide-y">
          <label className="flex items-center gap-3 py-3">
            <Globe className="text-muted-foreground size-5" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">Research new people and companies</span>
              <span className="text-muted-foreground block text-sm">A brief and missing details from the web, for each one added.</span>
            </span>
            <Switch checked={agents.researchNew} onCheckedChange={(v) => saveAgents({ researchNew: v === true })} aria-label="Research new people and companies" />
          </label>
          <div className="flex flex-wrap items-center gap-3 py-3">
            <Mail className="text-muted-foreground size-5" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Draft follow-ups for people going cold</span>
              <span className="text-muted-foreground block text-sm">
                Every day, a draft to each owner for anyone not contacted in{" "}
                <Input
                  type="number"
                  min={7}
                  max={365}
                  value={agents.followUpDays}
                  onChange={(e) => setAgents({ ...agents, followUpDays: Number(e.target.value) || 60 })}
                  onBlur={() => saveAgents({ followUpDays: agents.followUpDays })}
                  className="inline-flex h-7 w-16 px-2 text-sm"
                  aria-label="Days"
                />{" "}
                days.
              </span>
            </span>
            <Button size="sm" variant="outline" disabled={busy === "follow-up"} onClick={followUpNow}>
              {busy === "follow-up" && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Run for mine now
            </Button>
            <Switch checked={agents.followUp} onCheckedChange={(v) => saveAgents({ followUp: v === true })} aria-label="Draft follow-ups every day" />
          </div>
        </div>
        {runs.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold">Run log</h3>
            <ul className="divide-border bg-muted/45 divide-y rounded-2xl text-sm">
              {runs.map((r) => (
                <li key={r.id} className="px-4 py-2.5">
                  <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpenRun(openRun === r.id ? null : r.id)} aria-expanded={openRun === r.id}>
                    <Bot className="text-muted-foreground size-4" aria-hidden="true" />
                    <span className="font-medium">{r.agent === "research" ? "Research" : "Follow-up"}</span>
                    {r.target && <span className="text-muted-foreground truncate">{r.target.name}</span>}
                    {r.auto && <Badge variant="secondary">Automatic</Badge>}
                    <span className="text-muted-foreground ms-auto shrink-0 text-xs">
                      {new Date(r.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                    <Badge variant={r.status === "done" ? "success" : r.status === "failed" ? "destructive" : "outline"}>
                      {r.status === "done" ? `${r.suggestions.length} suggested` : r.status === "running" ? "Running" : r.status === "failed" ? "Failed" : "Stopped"}
                    </Badge>
                  </button>
                  {openRun === r.id && (
                    <ol className="text-muted-foreground mt-2 list-decimal space-y-0.5 ps-9">
                      {r.steps.map((s, i) => (
                        <li key={i}>{s.text}</li>
                      ))}
                      {r.target && (
                        <li className="list-none">
                          <Link href={crmRecordHref(orgSlug, r.target.kind, r.target.id)} className="text-foreground underline-offset-2 hover:underline">
                            Open {r.target.name}
                          </Link>
                        </li>
                      )}
                    </ol>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Block>

      {fields.length > 0 && (
        <Block title="AI fields">
          <p className="text-muted-foreground text-sm">
            Fill a whole column now. On a Claude key, 10 rows or more go as one batch at half price. A value someone typed in is never replaced;
            a different answer waits in To approve.
          </p>
          <ul className="divide-border bg-muted/45 divide-y rounded-2xl text-sm">
            {fields.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <Sparkles className="text-muted-foreground size-4" aria-hidden="true" />
                <span className="font-medium">{f.name}</span>
                <span className="text-muted-foreground">{f.database}</span>
                <Badge variant="secondary">{AI_AUTO_LABELS[f.auto]}</Badge>
                {f.research && <Badge variant="info">Searches the web</Badge>}
                <span className="ms-auto flex gap-1.5">
                  <Button size="sm" variant="outline" disabled={!f.hasPrompt || busy !== null} onClick={() => fill(f.id, true)} title={f.hasPrompt ? undefined : "Give it a prompt first"}>
                    Fill empty
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!f.hasPrompt || busy !== null} onClick={() => fill(f.id, false)}>
                    Refill all
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <section className="bg-muted/45 rounded-card space-y-1 p-5 text-sm">
        <p className="font-semibold">Bananasplit AI (coming later)</p>
        <p className="text-muted-foreground">
          AI with no key to manage, run by Bananasplit. Until then, AI here runs on your organization&apos;s own Claude or other model key,
          and members can use their own Claude through the connector. Your data never trains any model.
        </p>
      </section>
    </div>
  );
}

function UsageTable({ title, lines }: { title: string; lines: Line[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      <table className="w-full text-sm">
        <tbody className="divide-border divide-y">
          {lines.slice(0, 12).map((l) => (
            <tr key={l.key}>
              <td className="py-1.5">{l.label}</td>
              <td className="text-muted-foreground py-1.5 text-right tabular-nums">{l.calls}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{formatMicros(l.costMicros)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
