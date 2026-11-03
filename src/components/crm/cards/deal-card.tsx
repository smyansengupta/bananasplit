"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { moveDealAction, saveRecordAction } from "@/app/app/[orgSlug]/crm/actions";
import { makeDealQuoteAction, pushDealStepAction, setDealStepAtAction, setDealTypeAction } from "@/app/app/[orgSlug]/crm/deal-actions";
import {
  AMBIENT_BUTTON,
  AmbientButton,
  AmbientWhy,
  MAX_AMBIENT,
  type AmbientAction,
} from "@/components/ambient/ambient-button";
import { CrmCard } from "@/components/crm/card/crm-card";
import { dueWords } from "@/components/crm/card/next-step";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { QuoteBlock, SentLine, useQuoteSend, type DealQuoteView } from "@/components/crm/deals/deal-quote";
import { TypeTag } from "@/components/crm/pipeline-view";
import { RecordActions, type HistoryItem } from "@/components/crm/record-actions";
import { NeedsDialog, RecordFields } from "@/components/crm/record-fields";
import { Timeline, type TimelineItem } from "@/components/crm/timeline";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { formatMoney } from "@/lib/crm/fields";
import { hrefWithOpen } from "@/lib/crm/overlay";
import type { EditField } from "@/lib/crm/record-form";
import { CHOICE_COLOR_CLASS, type ChoiceColor } from "@/lib/databases/fields";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

export type { DealQuoteView };

/**
 * A deal, as a card over whatever CRM page you're on (?open=deal:<id>):
 * its name, company, amount and type in the header; the pipeline's stages
 * as pills that move it in one click (Undo in the toast); and Overview (the
 * next step and what it needs, or once won, the invoice), Quote (its lines,
 * total and Send the quote), Timeline and Details. ?tab=quote opens it on
 * the quote.
 */

export interface DealCardData {
  id: string;
  title: string;
  deleted: boolean;
  company: { id: string; name: string } | null;
  amount: string | null;
  hasAmount: boolean;
  type: { label: string; color: ChoiceColor } | null;
  typeChoices: { label: string; color: ChoiceColor }[];
  /** May add the Type field to the pipeline (a CRM manager). */
  canAddTypes: boolean;
  typeFieldId: string | null;
  stageId: string;
  stages: { id: string; name: string; kind: "OPEN" | "WON" | "LOST"; requiredFields: string[] }[];
  wonLabel: string;
  lostLabel: string;
  closeReason: string | null;
  nextStep: string | null;
  nextStepAt: string | null;
  expectedOn: string | null;
  owner: string | null;
  contact: { id: string; name: string } | null;
  finance: string | null;
  quote: DealQuoteView | null;
  invoice: DealQuoteView | null;
  form: EditField[];
  timeline: TimelineItem[];
  history: HistoryItem[];
  members: Record<string, string>;
}

const TABS = ["overview", "quote", "timeline", "details"] as const;
const UNDO =
  "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-muted";
const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function DealCard({
  orgId,
  orgSlug,
  data,
}: {
  orgId: string;
  orgSlug: string;
  data: DealCardData | null;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const { setOpen } = useCrmOpen();
  const asked = params.get("tab");
  const [tab, setTab] = useState<string>(
    (TABS as readonly string[]).includes(asked ?? "") ? asked! : "overview",
  );
  const [moving, setMoving] = useState<{
    stage: DealCardData["stages"][number];
    needs: { keys: string[]; labels: string[] };
    reason?: string;
  } | null>(null);
  const [moved, setMoved] = useState<{ from: string; name: string } | null>(null);

  // Closing takes `tab` with it, so the next card opens on its overview.
  const close = () => {
    const rest = new URLSearchParams(params.toString());
    rest.delete("tab");
    router.replace(hrefWithOpen(pathname, rest, null), { scroll: false });
  };

  if (!data) {
    return (
      <CrmCard title="Not here" onClose={close}>
        <EmptyState
          title="This deal isn't in the CRM any more"
          description="It may have been moved to the trash, or you can't see it."
        />
      </CrmCard>
    );
  }

  const stage = data.stages.find((s) => s.id === data.stageId);
  const won = stage?.kind === "WON";
  const lost = stage?.kind === "LOST";
  const at = data.stages.findIndex((s) => s.id === data.stageId);

  const labelOf = (k: string) =>
    data.form.find((f) => f.key === k || f.key === `custom.${k}`)?.label ?? k;

  const move = async (
    to: DealCardData["stages"][number],
    extra: { closeReason?: string | null; fill?: Record<string, unknown> } = {},
  ) => {
    const from = data.stageId;
    const r = await moveDealAction(orgId, data.id, { stageId: to.id, ...extra }).catch(() => null);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't move. Try again.", tone: "error" });
      return;
    }
    if (r.needs) {
      setMoving({ stage: to, needs: r.needs });
      return;
    }
    // Undo sits in the card: a toast outside it would close the card when clicked.
    setMoved({ from, name: to.name });
    router.refresh();
  };

  const undoMove = async () => {
    if (!moved) return;
    setMoved(null);
    const u = await moveDealAction(orgId, data.id, { stageId: moved.from }).catch(() => null);
    if (!u || !u.ok || u.needs) toast({ title: "It couldn't go back. Pick the stage again.", tone: "error" });
    router.refresh();
  };

  const pick = (to: DealCardData["stages"][number]) => {
    if (to.id === data.stageId || data.deleted) return;
    if (to.kind !== "OPEN") {
      setMoving({
        stage: to,
        needs: { keys: to.requiredFields, labels: to.requiredFields.map(labelOf) },
        reason:
          to.kind === "WON"
            ? `What made it ${data.wonLabel.toLowerCase()}? Optional.`
            : `Why ${data.lostLabel.toLowerCase()}?`,
      });
      return;
    }
    void move(to);
  };

  const subtitle = (
    <span className="flex min-w-0 items-center gap-1.5">
      {data.company && (
        <button
          type="button"
          className="text-foreground truncate font-semibold hover:underline"
          onClick={() => setOpen({ kind: "company", id: data.company!.id })}
        >
          {data.company.name}
        </button>
      )}
      {[data.amount, data.type?.label].filter(Boolean).length > 0 && (
        <span className="truncate">
          {data.company ? ", " : ""}
          {[data.amount, data.type?.label].filter(Boolean).join(", ")}
        </span>
      )}
    </span>
  );

  const strip = (
    <div role="group" aria-label="Stage" className="flex flex-wrap gap-1.5">
      {data.stages.map((s, i) => {
        const on = s.id === data.stageId;
        const past = !on && i < at && stage?.kind === "OPEN";
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            disabled={data.deleted}
            onClick={() => {
              setMoved(null);
              pick(s);
            }}
            className={cn(
              "focus-glow inline-flex h-[30px] items-center rounded-full px-3.5 text-[13px] whitespace-nowrap transition-colors outline-none disabled:opacity-60",
              on
                ? s.kind === "WON"
                  ? "bg-(--chart-3) font-semibold text-white"
                  : s.kind === "LOST"
                    ? "bg-destructive font-semibold text-white"
                    : "bg-foreground text-background font-semibold"
                : past
                  ? "bg-muted text-foreground/80 ring-border ring-1"
                  : "text-muted-foreground ring-border hover:bg-muted ring-1",
            )}
          >
            {s.name}
          </button>
        );
      })}
      {moved && (
        <span className="ms-1 flex items-center gap-2">
          <span className="text-muted-foreground text-[13px]">Moved to {moved.name}.</span>
          <button type="button" className={cn(AMBIENT_BUTTON, UNDO)} onClick={() => void undoMove()}>
            Undo
          </button>
        </span>
      )}
    </div>
  );

  return (
    <>
      <CrmCard
        title={data.title}
        subtitle={subtitle}
        description={`${data.title}: overview, quote, timeline and details`}
        onClose={close}
        actions={
          <RecordActions
            orgId={orgId}
            orgSlug={orgSlug}
            kind="deal"
            id={data.id}
            name={data.title}
            deleted={data.deleted}
            history={data.history}
            menu
            onTrashed={close}
          />
        }
        strip={strip}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "quote", label: data.invoice && won ? "Invoice" : "Quote" },
          { value: "timeline", label: "Timeline" },
          { value: "details", label: "Details" },
        ]}
        tab={tab}
        onTab={setTab}
      >
        {(t) => {
          if (t === "timeline") {
            return (
              <Timeline
                orgId={orgId}
                orgSlug={orgSlug}
                target={{ kind: "deal", id: data.id }}
                initial={data.timeline}
                members={data.members}
                alsoOn={data.company ? [{ kind: "company", id: data.company.id }] : []}
              />
            );
          }
          if (t === "details") return <Details orgId={orgId} orgSlug={orgSlug} data={data} />;
          if (t === "quote") return <QuoteTab orgId={orgId} orgSlug={orgSlug} data={data} won={won} />;
          return (
            <div className="space-y-4">
              {won ? (
                <WonBar orgId={orgId} data={data} onQuote={() => setTab("quote")} />
              ) : lost ? (
                <div className="bg-muted rounded-2xl px-4 py-3 text-[15px]">
                  <b>{stage?.name}.</b> {data.closeReason ?? ""}
                </div>
              ) : (
                <NextBar orgId={orgId} data={data} onQuote={() => setTab("quote")} />
              )}
              <dl className="divide-border/60 divide-y text-[15px]">
                <Fact label="Contact">
                  {data.contact ? (
                    <button
                      type="button"
                      className="font-semibold hover:underline"
                      onClick={() => setOpen({ kind: "person", id: data.contact!.id })}
                    >
                      {data.contact.name}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">Nobody yet</span>
                  )}
                </Fact>
                <Fact label="Expected to close">
                  {data.expectedOn ? shortDay(data.expectedOn) : <span className="text-muted-foreground">Not set</span>}
                </Fact>
                <Fact label="Owner">{data.owner ?? <span className="text-muted-foreground">Nobody</span>}</Fact>
                {data.finance && <Fact label="Finance">{data.finance}</Fact>}
              </dl>
              {data.timeline.length > 0 && (
                <ul className="space-y-3 pt-1">
                  {data.timeline.slice(0, 2).map((item) => (
                    <li key={item.id} className="flex gap-3">
                      <span aria-hidden="true" className="bg-muted-foreground/50 mt-2 size-2 shrink-0 rounded-full" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <b className="min-w-0 flex-1 truncate text-[15px]">{item.subject ?? "Activity"}</b>
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {new Date(item.occurredAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        </span>
                        {item.body && (
                          <span className="text-muted-foreground line-clamp-2 text-sm">
                            {item.body.replace(/\s+/g, " ").trim()}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        }}
      </CrmCard>
      {moving && (
        <NeedsDialog
          title={`Move to ${moving.stage.name}`}
          needs={moving.needs}
          fields={data.form}
          orgId={orgId}
          reasonPrompt={moving.reason}
          onCancel={() => setMoving(null)}
          onSubmit={async (fill) => {
            const { closeReason, ...rest } = fill;
            const m = moving;
            setMoving(null);
            await move(m.stage, {
              closeReason: (closeReason as string) ?? null,
              fill: Object.keys(rest).length ? rest : undefined,
            });
          }}
        />
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <dt className="text-muted-foreground w-36 shrink-0 text-sm">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

/** The one bar on top of an open deal: its next step and what it needs now. */
function NextBar({ orgId, data, onQuote }: { orgId: string; data: DealCardData; onQuote: () => void }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [when, setWhen] = useState("");
  const [pushed, setPushed] = useState<{ before: string | null } | null>(null);
  const step = data.nextStep?.trim() || null;
  const due = data.nextStepAt ? dueWords(new Date(data.nextStepAt)) : null;
  const quote = data.quote;

  const actions: AmbientAction[] = [];
  let why: string | null = null;
  if (!step) {
    // The bar already says there's none: no reason beside the button.
    actions.push({
      key: "add",
      label: "Add a next step",
      tone: "solid",
      reason: "No next step",
      run: async () => {
        setAdding(true);
        return {};
      },
    });
  } else if (due?.late) {
    why = `Due ${due.words}`;
    actions.push({
      key: "push",
      label: "Push a day",
      tone: "outline",
      reason: "Moves the next step a day",
      run: async () => {
        const r = await pushDealStepAction(orgId, data.id, 1);
        if (r.ok) setPushed({ before: r.before });
        return r;
      },
    });
  }
  if (data.hasAmount && !quote) {
    why = why ?? "No quote yet";
    actions.unshift({
      key: "make",
      label: "Make a quote",
      tone: actions.length ? "outline" : "solid",
      reason: "No quote yet",
      run: async () => {
        const r = await makeDealQuoteAction(orgId, data.id, "quote");
        if (r.ok) onQuote();
        return r;
      },
    });
  } else if (quote && (quote.status === "DRAFT" || quote.status === "DECLINED" || quote.status === "EXPIRED")) {
    why = why ?? (quote.status === "DRAFT" ? "Quote drafted, not sent" : `The quote was ${quote.status.toLowerCase()}`);
    actions.unshift({
      key: "send",
      label: "Send the quote",
      tone: "solid",
      reason: why,
      run: async () => {
        onQuote();
        return {};
      },
    });
  } else if (quote?.status === "SENT" && quote.sentAt) {
    why = why ?? `Quote sent ${shortDay(quote.sentAt)}`;
  }
  const shown = actions.slice(0, MAX_AMBIENT);

  if (pushed) {
    return (
      <div className="bg-muted flex flex-nowrap items-center gap-3 rounded-2xl px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-[15px]">
          <b>Next:</b> {step}
          {due && <span className="text-muted-foreground">, {due.words}</span>}
        </span>
        <span className="text-muted-foreground shrink-0 text-sm">Pushed a day.</span>
        <button
          type="button"
          className={cn(AMBIENT_BUTTON, UNDO)}
          onClick={async () => {
            const before = pushed.before;
            setPushed(null);
            await runAction(() => setDealStepAtAction(orgId, data.id, before));
            router.refresh();
          }}
        >
          Undo
        </button>
      </div>
    );
  }

  if (adding) {
    return (
      <form
        className="bg-muted flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const r = await runAction(() =>
            saveRecordAction(orgId, "deal", data.id, { nextStep: text.trim(), nextStepAt: when || null }),
          );
          if (r && !r.ok) {
            toast({ title: r.error, tone: "error" });
            return;
          }
          setAdding(false);
          router.refresh();
        }}
      >
        <Input
          autoFocus
          aria-label="Next step"
          placeholder="Send Marcus the quote"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="bg-card h-9 min-w-40 flex-1"
        />
        <Input
          type="date"
          aria-label="By"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="bg-card h-9 w-40"
        />
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground h-7 rounded-full px-3 text-[12.5px] font-semibold"
          onClick={() => setAdding(false)}
        >
          Cancel
        </button>
        <button type="submit" className="bg-foreground text-background h-7 rounded-full px-3 text-[12.5px] font-semibold">
          Save
        </button>
      </form>
    );
  }

  return (
    <div className="bg-muted flex flex-nowrap items-center gap-3 rounded-2xl px-4 py-3">
      <span className="min-w-0 flex-1 truncate text-[15px]">
        {step ? (
          <>
            <b>Next:</b> {step}
            {due && <span className={cn("text-muted-foreground", due.late && "text-destructive")}>, {due.words}</span>}
          </>
        ) : (
          <b>No next step</b>
        )}
      </span>
      {why && shown.length > 0 && <AmbientWhy className="shrink-0 whitespace-nowrap">{why}</AmbientWhy>}
      {shown.map((a) => (
        <AmbientButton key={a.key} action={a} />
      ))}
    </div>
  );
}

/** Once won: the invoice, drafted from the quote, and Send the invoice. */
function WonBar({ orgId, data, onQuote }: { orgId: string; data: DealCardData; onQuote: () => void }) {
  const invoice = data.invoice;
  const { send, undo, held, out } = useQuoteSend(orgId, invoice);
  const total = invoice ? formatMoney(invoice.totalCents, invoice.currency) : null;
  if (held || out) {
    return (
      <div className="bg-tint-success rounded-2xl px-4 py-3">
        <SentLine kind="invoice" held={held} out={out} onUndo={() => void undo()} />
      </div>
    );
  }
  let line: React.ReactNode;
  let action: AmbientAction | null = null;
  if (!invoice) {
    line = <> No invoice yet.</>;
    action = {
      key: "draft",
      label: "Draft the invoice",
      tone: "solid",
      reason: "Won, no invoice yet",
      run: async () => {
        const r = await makeDealQuoteAction(orgId, data.id, "invoice");
        if (r.ok) onQuote();
        return r;
      },
    };
  } else if (invoice.status === "PAID") {
    line = <> Paid in full, {total}.</>;
  } else if (invoice.status === "SENT" && invoice.sentAt) {
    line = <> Invoice {invoice.number} for {total} sent {shortDay(invoice.sentAt)}.</>;
  } else {
    line = <> An invoice for {total} is drafted.</>;
    if (invoice.to?.email) {
      action = {
        key: "send",
        label: "Send the invoice",
        tone: "solid",
        reason: `Goes to ${invoice.to.name}`,
        run: () => send(),
      };
    }
  }
  return (
    <div className="bg-tint-success text-tint-success-foreground flex flex-nowrap items-center gap-3 rounded-2xl px-4 py-3">
      <span className="min-w-0 flex-1 truncate text-[15px]">
        <b>Won.</b>
        {line}
      </span>
      {action && (
        <>
          <AmbientWhy className="shrink-0 whitespace-nowrap">{action.reason}</AmbientWhy>
          <AmbientButton action={action} />
        </>
      )}
    </div>
  );
}

function QuoteTab({
  orgId,
  orgSlug,
  data,
  won,
}: {
  orgId: string;
  orgSlug: string;
  data: DealCardData;
  won: boolean;
}) {
  if (!data.quote && !data.invoice) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-[15px]">
          No quote yet. Make one filled from this deal, then send it in a tracked email.
        </p>
        <div className="flex flex-nowrap items-center gap-2">
          <AmbientButton
            action={{
              key: "make",
              label: "Make a quote",
              tone: "solid",
              reason: "Filled from this deal",
              run: () => makeDealQuoteAction(orgId, data.id, "quote"),
            }}
          />
          <AmbientWhy>Filled from this deal</AmbientWhy>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {data.invoice && <QuoteBlock key={data.invoice.id} orgId={orgId} orgSlug={orgSlug} quote={data.invoice} />}
      {data.quote && (!won || !data.invoice || data.quote.status !== "PAID") && (
        <QuoteBlock key={data.quote.id} orgId={orgId} orgSlug={orgSlug} quote={data.quote} />
      )}
    </div>
  );
}

function Details({ orgId, orgSlug, data }: { orgId: string; orgSlug: string; data: DealCardData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const typeKey = data.typeFieldId ? `custom.${data.typeFieldId}` : null;
  const canPick = Boolean(data.typeFieldId) || data.canAddTypes;
  const setType = async (label: string | null) => {
    setBusy(true);
    const r = await runAction(() => setDealTypeAction(orgId, data.id, label));
    setBusy(false);
    if (r && !r.ok) toast({ title: r.error, tone: "error" });
    router.refresh();
  };
  return (
    <div className="space-y-4">
      {canPick && !data.deleted && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground w-36 shrink-0 text-sm">Type</span>
          {data.typeChoices.map((c) => {
            const on = data.type?.label === c.label;
            return (
              <button
                key={c.label}
                type="button"
                aria-pressed={on}
                disabled={busy}
                onClick={() => void setType(on ? null : c.label)}
                className={cn(
                  "rounded-full transition-opacity disabled:opacity-60",
                  !on && "opacity-55 hover:opacity-100",
                )}
              >
                <TypeTag label={c.label} color={c.color} className={cn(on && "ring-foreground/30 ring-2")} />
              </button>
            );
          })}
        </div>
      )}
      {!canPick && data.type && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-36 shrink-0 text-sm">Type</span>
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", CHOICE_COLOR_CLASS[data.type.color])}>
            {data.type.label}
          </span>
        </div>
      )}
      <RecordFields
        orgId={orgId}
        orgSlug={orgSlug}
        kind="deal"
        id={data.id}
        fields={typeKey ? data.form.filter((f) => f.key !== typeKey) : data.form}
        readOnly={data.deleted}
      />
      {!data.deleted && <p className="text-muted-foreground text-xs">Click a value to change it.</p>}
    </div>
  );
}
