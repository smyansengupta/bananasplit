"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { setNextStepAction } from "@/app/app/[orgSlug]/crm/people-actions";
import { AmbientButton, AmbientWhy } from "@/components/ambient/ambient-button";
import { Composer } from "@/components/crm/card/composer";
import { CrmAvatar, CrmCard } from "@/components/crm/card/crm-card";
import { NotesList, type NoteItem } from "@/components/crm/card/notes";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { RecordActions, type HistoryItem } from "@/components/crm/record-actions";
import { RecordFields } from "@/components/crm/record-fields";
import { EmptyState } from "@/components/empty-state";
import type { EditField } from "@/lib/crm/record-form";
import { hrefWithOpen, type CrmOpen } from "@/lib/crm/overlay";
import { cn } from "@/lib/utils";

/**
 * A company as a card over whatever CRM page you're on
 * (?open=company:<id>, Company.dc.html): who they are in the header with
 * "…" for history, merge and the trash; Overview (the next thing anyone
 * here is due to do, what they are, money, the open deal, and someone
 * nobody has talked to with who to ask for an intro), People, Notes (its
 * own and its people's; any can become a task), Deals and Details (click a
 * value to change it). The composer at the foot has Note and Task.
 */

export interface CompanyCardData {
  id: string;
  name: string;
  subtitle: string | null;
  deleted: boolean;
  about: string | null;
  next: { text: string; open: CrmOpen | null; label: string | null } | null;
  facts: { label: string; value: string }[];
  openDeal: { id: string; label: string } | null;
  intro: { quiet: string; best: { id: string; name: string }; why: string } | null;
  people: { id: string; name: string; sub: string | null; last: string }[];
  deals: { id: string; title: string; kind: string; stage: string; amount: string | null }[];
  form: EditField[];
  history: HistoryItem[];
  /** Its notes and its people's, newest first. */
  notes: NoteItem[];
  members: { id: string; name: string }[];
}

const ROW =
  "bg-card ring-foreground/6 hover:bg-muted/60 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-start ring-1";

export function CompanyCard({
  orgId,
  orgSlug,
  data,
}: {
  orgId: string;
  orgSlug: string;
  data: CompanyCardData | null;
}) {
  const { close, hrefFor } = useCrmOpen();
  const pathname = usePathname() ?? "";
  const params = useSearchParams();

  if (!data) {
    return (
      <CrmCard title="Not here">
        <EmptyState
          title="This company isn't in the CRM any more"
          description="It may have been merged into another, or you can't see it."
        />
      </CrmCard>
    );
  }

  // New person with this company already filled in.
  const addHere = (() => {
    const next = new URLSearchParams(params.toString());
    next.set("with", `company:${data.id}`);
    return hrefWithOpen(pathname, next, { kind: "new", what: "person" });
  })();

  return (
    <CrmCard
      title={data.name}
      subtitle={data.subtitle ?? undefined}
      avatar={
        <span className="[&>span]:!rounded-2xl">
          <CrmAvatar name={data.name} />
        </span>
      }
      description={`${data.name}: overview, people, notes, deals and details`}
      actions={
        <RecordActions
          orgId={orgId}
          orgSlug={orgSlug}
          kind="company"
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
        { value: "people", label: "People", count: data.people.length || undefined },
        { value: "notes", label: "Notes", count: data.notes.length || undefined },
        { value: "deals", label: "Deals", count: data.deals.length || undefined },
        { value: "details", label: "Details" },
      ]}
      foot={
        data.deleted ? undefined : (
          <Composer
            orgId={orgId}
            orgSlug={orgSlug}
            record={{ kind: "company", id: data.id, name: data.name }}
            members={data.members}
            channels={{ email: false, text: false }}
            conflict={null}
            templates={[]}
            booking={[]}
          />
        )
      }
    >
      {(tab) => {
        if (tab === "notes") {
          return (
            <NotesList
              orgId={orgId}
              orgSlug={orgSlug}
              target={{ kind: "company", id: data.id }}
              notes={data.notes}
              members={data.members}
              recordName={data.name}
              readOnly={data.deleted}
            />
          );
        }
        if (tab === "people") {
          return (
            <div className="grid gap-2">
              {data.people.length === 0 && (
                <p className="text-muted-foreground text-sm">Nobody from {data.name} yet.</p>
              )}
              {data.people.map((p) => (
                <Link key={p.id} href={hrefFor({ kind: "person", id: p.id })} scroll={false} className={ROW}>
                  <CrmAvatar name={p.name} size={36} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[15px]">{p.name}</b>
                    {p.sub && <span className="text-muted-foreground block truncate text-[13px]">{p.sub}</span>}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[13px]">{p.last}</span>
                </Link>
              ))}
              {!data.deleted && (
                <div className="pt-1">
                  <AmbientButton
                    action={{
                      key: "add",
                      label: "Add a person here",
                      tone: "outline",
                      reason: `Someone new at ${data.name}`,
                      href: addHere,
                    }}
                  />
                </div>
              )}
            </div>
          );
        }
        if (tab === "deals") {
          return data.deals.length === 0 ? (
            <p className="text-muted-foreground text-sm">No deals with {data.name} yet.</p>
          ) : (
            <div className="grid gap-2">
              {data.deals.map((d) => (
                <Link key={d.id} href={hrefFor({ kind: "deal", id: d.id })} scroll={false} className={ROW}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      d.kind === "WON"
                        ? "bg-(--tag-forest)"
                        : d.kind === "LOST"
                          ? "bg-muted-foreground/50"
                          : "bg-(--attention)",
                    )}
                  />
                  <b className="min-w-0 flex-1 truncate text-[15px]">{d.title}</b>
                  <span className="text-muted-foreground shrink-0 text-[13px]">{d.stage}</span>
                  {d.amount && <b className="shrink-0 text-[15px] tabular-nums">{d.amount}</b>}
                </Link>
              ))}
            </div>
          );
        }
        if (tab === "details") {
          return (
            <div className="space-y-3">
              <RecordFields
                orgId={orgId}
                orgSlug={orgSlug}
                kind="company"
                id={data.id}
                fields={data.form}
                readOnly={data.deleted}
              />
              {!data.deleted && <p className="text-muted-foreground text-xs">Click a value to change it.</p>}
            </div>
          );
        }
        return (
          <div className="space-y-4">
            {data.next ? (
              <div className="bg-muted flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
                <span className="min-w-0 flex-1 text-[15px]">
                  <b>Next:</b> {data.next.text}
                </span>
                {data.next.open && data.next.label && (
                  <AmbientButton
                    action={{
                      key: "open",
                      label: data.next.label,
                      tone: "outline",
                      reason: data.next.text,
                      href: hrefFor(data.next.open),
                    }}
                  />
                )}
              </div>
            ) : (
              !data.deleted && (
                <div className="bg-muted flex flex-nowrap items-center gap-2 rounded-2xl px-4 py-3">
                  <span className="min-w-0 flex-1 text-[15px]">
                    <b>Next:</b> nothing set
                  </span>
                  <AmbientWhy className="whitespace-nowrap">No next step</AmbientWhy>
                  <AmbientButton
                    action={{
                      key: "next",
                      label: "Add a next step",
                      tone: "outline",
                      reason: "No next step",
                      done: "Follow up in a week.",
                      run: () => setNextStepAction(orgId, "company", data.id, 7),
                    }}
                  />
                </div>
              )
            )}
            {data.about && <p className="text-[15px] leading-relaxed">{data.about}</p>}
            <dl className="divide-border/70 divide-y">
              {data.facts.map((f) => (
                <Fact key={f.label} label={f.label}>
                  {f.value}
                </Fact>
              ))}
              {data.openDeal && (
                <Fact label="Open deal">
                  <Link
                    href={hrefFor({ kind: "deal", id: data.openDeal.id })}
                    scroll={false}
                    className="underline-offset-4 hover:underline"
                  >
                    {data.openDeal.label}
                  </Link>
                </Fact>
              )}
              {data.intro && !data.deleted && (
                <Fact label={`Nobody has talked to ${data.intro.quiet}`}>
                  <span className="flex flex-nowrap items-center justify-end gap-2">
                    <AmbientWhy className="whitespace-nowrap">{data.intro.why}</AmbientWhy>
                    <AmbientButton
                      action={{
                        key: "intro",
                        label: `Ask ${data.intro.best.name.split(" ")[0]} for an intro`,
                        tone: "spark",
                        reason: `${data.intro.why}, and ${data.intro.best.name} knows them`,
                        href: hrefFor({ kind: "person", id: data.intro.best.id }),
                      }}
                    />
                  </span>
                </Fact>
              )}
            </dl>
          </div>
        );
      }}
    </CrmCard>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-[15px] font-semibold">{children}</dd>
    </div>
  );
}
