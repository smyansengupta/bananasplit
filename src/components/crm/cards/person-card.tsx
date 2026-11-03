"use client";

import { Phone } from "@/components/icons";
import { useState } from "react";

import { AmbientButton, AmbientWhy } from "@/components/ambient/ambient-button";
import { CrmAvatar, CrmCard, CrmCardButton } from "@/components/crm/card/crm-card";
import { Composer, type ComposerSeed } from "@/components/crm/card/composer";
import { NextStepBar, type NextStep } from "@/components/crm/card/next-step";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { RecordActions, type HistoryItem } from "@/components/crm/record-actions";
import { RecordFields } from "@/components/crm/record-fields";
import { Timeline, type TimelineItem } from "@/components/crm/timeline";
import { EmptyState } from "@/components/empty-state";
import type { EditField } from "@/lib/crm/record-form";
import { cn } from "@/lib/utils";

/**
 * A person, as a card over whatever CRM page you're on (?open=person:<id>):
 * who they are in the header, with Call when there's a number and "…" for
 * history, merge and the trash; Overview (the next step, the brief, the
 * latest thing and what it needs, money owed), Timeline, Deals and Details
 * (click a value to change it); one composer at the foot.
 */

export interface PersonCardData {
  id: string;
  name: string;
  title: string | null;
  company: { id: string; name: string } | null;
  relationship: string | null;
  phone: string | null;
  deleted: boolean;
  owner: string | null;
  nextStep: NextStep | null;
  brief: { text: string; points: string[] } | null;
  latest: {
    title: string;
    when: string;
    text: string;
    reply: { messageId: string; subject: string } | null;
    why: string | null;
  } | null;
  money: { paid: string; pledged: string; owed: string; due: boolean; company: string } | null;
  deals: {
    id: string;
    title: string;
    stage: string;
    kind: string;
    amount: string | null;
    pipeline: string;
  }[];
  form: EditField[];
  timeline: TimelineItem[];
  history: HistoryItem[];
  members: Record<string, string>;
  channels: {
    email: { to: string } | null;
    emailBlocked: string | null;
    text: { to: string } | null;
  };
  conflict: string | null;
  templates: { id: string; name: string; subject: string | null; body: string }[];
  booking: string | null;
}

export function PersonCard({
  orgId,
  orgSlug,
  data,
}: {
  orgId: string;
  orgSlug: string;
  data: PersonCardData | null;
}) {
  const { setOpen, close } = useCrmOpen();
  const [seed, setSeed] = useState<ComposerSeed | null>(null);

  if (!data) {
    return (
      <CrmCard title="Not here">
        <EmptyState
          title="This person isn't in the CRM any more"
          description="They may have been merged into someone else, or you can't see them."
        />
      </CrmCard>
    );
  }

  const first = data.name.split(" ")[0] ?? data.name;
  const subtitle = [
    data.title && data.company
      ? `${data.title} at ${data.company.name}`
      : (data.title ?? data.company?.name ?? null),
    data.relationship?.toLowerCase(),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <CrmCard
      title={data.name}
      subtitle={subtitle || undefined}
      avatar={<CrmAvatar name={data.name} />}
      description={`${data.name}: overview, timeline, deals and details`}
      actions={
        <>
          {data.phone && (
            <CrmCardButton label={`Call ${first}`} href={`tel:${data.phone}`}>
              <Phone className="size-4" aria-hidden="true" />
            </CrmCardButton>
          )}
          <RecordActions
            orgId={orgId}
            orgSlug={orgSlug}
            kind="person"
            id={data.id}
            name={data.name}
            deleted={data.deleted}
            history={data.history}
            menu
            onTrashed={close}
          />
        </>
      }
      tabs={[
        { value: "overview", label: "Overview" },
        { value: "timeline", label: "Timeline" },
        { value: "deals", label: "Deals", count: data.deals.length || undefined },
        { value: "details", label: "Details" },
      ]}
      foot={
        data.deleted ? undefined : (
          <Composer
            orgId={orgId}
            person={{ id: data.id, name: data.name }}
            channels={{ email: Boolean(data.channels.email), text: Boolean(data.channels.text) }}
            conflict={data.conflict}
            templates={data.templates}
            booking={data.booking}
            seed={seed}
            alsoOn={data.company ? [{ kind: "company", id: data.company.id }] : []}
          />
        )
      }
    >
      {(tab) => {
        if (tab === "timeline") {
          return (
            <Timeline
              orgId={orgId}
              orgSlug={orgSlug}
              target={{ kind: "person", id: data.id }}
              initial={data.timeline}
              members={data.members}
              alsoOn={data.company ? [{ kind: "company", id: data.company.id }] : []}
              logForm={false}
            />
          );
        }
        if (tab === "deals") {
          return data.deals.length === 0 ? (
            <p className="text-muted-foreground text-sm">No deals with {first} yet.</p>
          ) : (
            <ul className="grid gap-2">
              {data.deals.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setOpen({ kind: "deal", id: d.id })}
                    className="bg-card ring-foreground/6 hover:bg-muted/60 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-start ring-1"
                  >
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[15px]">{d.title}</b>
                      <span className="text-muted-foreground text-[13px]">
                        {d.stage}, {d.pipeline}
                      </span>
                    </span>
                    {d.amount && <b className="tabular-nums">{d.amount}</b>}
                  </button>
                </li>
              ))}
            </ul>
          );
        }
        if (tab === "details") {
          return (
            <div className="space-y-3">
              <RecordFields
                orgId={orgId}
                orgSlug={orgSlug}
                kind="person"
                id={data.id}
                fields={data.form}
                readOnly={data.deleted}
              />
              {!data.deleted && (
                <p className="text-muted-foreground text-xs">Click a value to change it.</p>
              )}
            </div>
          );
        }
        return (
          <div className="space-y-4">
            {!data.deleted && <NextStepBar orgId={orgId} personId={data.id} step={data.nextStep} />}
            {data.brief && (
              <div className="space-y-2 text-[15px] leading-relaxed">
                <p>{data.brief.text}</p>
                {data.brief.points.length > 0 && (
                  <ul className="text-muted-foreground list-disc space-y-1 ps-5 text-sm">
                    {data.brief.points.slice(0, 4).map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {data.latest && (
              <div className="bg-card ring-foreground/6 space-y-2 rounded-2xl p-4 ring-1">
                <div className="flex items-baseline gap-2">
                  <b className="min-w-0 flex-1 truncate text-[15px]">{data.latest.title}</b>
                  <span className="text-muted-foreground shrink-0 text-xs">{data.latest.when}</span>
                </div>
                {data.latest.text && (
                  <p className="text-muted-foreground line-clamp-3 text-sm">“{data.latest.text}”</p>
                )}
                {data.latest.reply && data.channels.email && (
                  <div className="flex flex-nowrap items-center gap-2 pt-0.5">
                    <AmbientButton
                      action={{
                        key: "reply",
                        label: "Reply",
                        tone: "solid",
                        reason: data.latest.why ?? "",
                        run: async () => {
                          setSeed({
                            nonce: Date.now(),
                            channel: "email",
                            replyTo: data.latest!.reply,
                            subject: "",
                            body: "",
                          });
                          return {};
                        },
                      }}
                    />
                    {data.latest.why && (
                      <AmbientWhy className="min-w-0 truncate">{data.latest.why}</AmbientWhy>
                    )}
                  </div>
                )}
              </div>
            )}
            {data.money && (
              <div className="bg-card ring-foreground/6 flex flex-nowrap items-center gap-3 rounded-2xl px-4 py-3 ring-1">
                <span className="min-w-0 flex-1">
                  <span className="text-muted-foreground block text-xs">
                    Paid by {data.money.company}
                  </span>
                  <b className={cn("text-[15px] tabular-nums")}>
                    {data.money.paid} of {data.money.pledged}
                  </b>
                </span>
                {data.money.due && data.channels.email && (
                  <>
                    <AmbientWhy className="whitespace-nowrap">
                      {data.money.owed} still to come
                    </AmbientWhy>
                    <AmbientButton
                      action={{
                        key: "remind",
                        label: "Remind",
                        tone: "spark",
                        reason: `${data.money.owed} still to come`,
                        done: "Drafted below.",
                        run: async () => {
                          setSeed({
                            nonce: Date.now(),
                            channel: "email",
                            subject: "A quick reminder",
                            body: `Hi ${first},\n\nA quick reminder that ${data.money!.owed} of the ${data.money!.pledged} from ${data.money!.company} is still to come. Let me know if anything is holding it up.\n\nThank you!`,
                          });
                          return {};
                        },
                      }}
                    />
                  </>
                )}
              </div>
            )}
            {!data.brief && !data.latest && !data.money && (
              <p className="text-muted-foreground text-sm">
                Nothing with {first} yet. Write below, or log a call or a note.
              </p>
            )}
            {data.owner && <p className="text-muted-foreground text-xs">Owner: {data.owner}</p>}
          </div>
        );
      }}
    </CrmCard>
  );
}
