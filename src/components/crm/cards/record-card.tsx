"use client";

import { CrmAvatar, CrmCard } from "@/components/crm/card/crm-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { RecordActions, type HistoryItem } from "@/components/crm/record-actions";
import { RecordFields } from "@/components/crm/record-fields";
import { Timeline, type TimelineItem } from "@/components/crm/timeline";
import { EmptyState } from "@/components/empty-state";
import type { EditField } from "@/lib/crm/record-form";

/**
 * A company or a deal as a card (the plain first cut, until their own
 * cards land): Overview (the facts, its people, its deals), Timeline and
 * Details. People and deals open their own card in its place.
 */

export interface RecordCardData {
  kind: "company" | "deal";
  id: string;
  name: string;
  subtitle: string | null;
  deleted: boolean;
  facts: { label: string; value: string }[];
  people: { id: string; name: string; sub: string | null }[];
  deals: { id: string; title: string; sub: string; amount: string | null }[];
  company?: { id: string; name: string } | null;
  form: EditField[];
  timeline: TimelineItem[];
  history: HistoryItem[];
  members: Record<string, string>;
}

export function RecordCard({
  orgId,
  orgSlug,
  data,
}: {
  orgId: string;
  orgSlug: string;
  data: RecordCardData | null;
}) {
  const { setOpen, close } = useCrmOpen();
  if (!data) {
    return (
      <CrmCard title="Not here">
        <EmptyState
          title="This isn't in the CRM any more"
          description="It may have been merged or moved to the trash, or you can't see it."
        />
      </CrmCard>
    );
  }
  const alsoOn = data.company ? [{ kind: "company" as const, id: data.company.id }] : [];
  return (
    <CrmCard
      title={data.name}
      subtitle={data.subtitle ?? undefined}
      avatar={<CrmAvatar name={data.name} />}
      actions={
        <RecordActions
          orgId={orgId}
          orgSlug={orgSlug}
          kind={data.kind}
          id={data.id}
          name={data.name}
          deleted={data.deleted}
          history={data.history}
          menu
          onTrashed={close}
        />
      }
      tabs={[
        { value: "overview", label: "Overview" },
        { value: "timeline", label: "Timeline" },
        { value: "details", label: "Details" },
      ]}
    >
      {(tab) => {
        if (tab === "timeline") {
          return (
            <Timeline
              orgId={orgId}
              orgSlug={orgSlug}
              target={{ kind: data.kind, id: data.id }}
              initial={data.timeline}
              members={data.members}
              alsoOn={alsoOn}
            />
          );
        }
        if (tab === "details") {
          return (
            <div className="space-y-3">
              <RecordFields
                orgId={orgId}
                orgSlug={orgSlug}
                kind={data.kind}
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
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-3">
              {data.facts.map((f) => (
                <div key={f.label} className="bg-muted rounded-2xl px-4 py-3">
                  <dt className="text-muted-foreground text-xs">{f.label}</dt>
                  <dd className="truncate text-[15px] font-semibold">{f.value}</dd>
                </div>
              ))}
            </dl>
            {data.company && (
              <Row
                label={data.company.name}
                sub="Company"
                onClick={() => setOpen({ kind: "company", id: data.company!.id })}
              />
            )}
            {data.people.length > 0 && (
              <section className="space-y-2">
                <h3 className="heading text-sm">People</h3>
                {data.people.map((p) => (
                  <Row
                    key={p.id}
                    label={p.name}
                    sub={p.sub}
                    onClick={() => setOpen({ kind: "person", id: p.id })}
                  />
                ))}
              </section>
            )}
            {data.deals.length > 0 && (
              <section className="space-y-2">
                <h3 className="heading text-sm">Deals</h3>
                {data.deals.map((d) => (
                  <Row
                    key={d.id}
                    label={d.title}
                    sub={d.sub}
                    end={d.amount}
                    onClick={() => setOpen({ kind: "deal", id: d.id })}
                  />
                ))}
              </section>
            )}
          </div>
        );
      }}
    </CrmCard>
  );
}

function Row({
  label,
  sub,
  end,
  onClick,
}: {
  label: string;
  sub: string | null;
  end?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-card ring-foreground/6 hover:bg-muted/60 flex w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-start ring-1"
    >
      <CrmAvatar name={label} size={32} />
      <span className="min-w-0 flex-1">
        <b className="block truncate text-sm">{label}</b>
        {sub && <span className="text-muted-foreground block truncate text-xs">{sub}</span>}
      </span>
      {end && <b className="text-sm tabular-nums">{end}</b>}
    </button>
  );
}
