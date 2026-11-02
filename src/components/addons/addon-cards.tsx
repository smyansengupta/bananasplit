import Link from "next/link";
import type { ReactNode } from "react";

import { AddAddOnButton } from "@/components/addons/addon-controls";
import { Mini, PANEL, Pill } from "@/components/addons/addon-page";
import { Check } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ADD_ON_INFO, type AddOnId } from "@/lib/addons";
import { cn } from "@/lib/utils";

/**
 * Integrations and apps' add-on cards: a small picture of what each does,
 * its name, one line, and the one thing to do next (Add, or Open once it's
 * there). CRM is shown as coming later.
 */

function Preview({ tint, children }: { tint: string; children: ReactNode }) {
  return (
    <div aria-hidden="true" className={cn("flex h-[168px] items-end px-[22px] pt-[22px]", tint)}>
      <Mini className="w-full gap-2 rounded-b-none p-4">{children}</Mini>
    </div>
  );
}

const FORMS_PREVIEW = (
  <Preview tint="bg-tint-info">
    <b className="text-[13px]">Which logo should we go with?</b>
    {(
      [
        ["The round one", "62%", true],
        ["The wordmark", "38%", false],
      ] as const
    ).map(([k, v, on]) => (
      <span key={k} className="flex items-center gap-2 text-[12.5px]">
        <span
          className={cn(
            "size-3.5 rounded-full",
            on ? "border-4 border-[var(--chart-1)]" : "border-border border-[1.5px]",
          )}
        />
        {k}
        <span className="text-muted-foreground ml-auto">{v}</span>
      </span>
    ))}
  </Preview>
);

const FINANCE_PREVIEW = (
  <Preview tint="bg-tint-success">
    <span className="flex items-center text-[12.5px]">
      <b className="flex-1 text-[13px]">This quarter&apos;s budget</b>
      <span className="text-muted-foreground">$6,620 of $9,000</span>
    </span>
    <span className="bg-muted flex h-2.5 gap-0.5 overflow-hidden rounded-full">
      <span className="w-[34%] bg-[var(--chart-3)]" />
      <span className="w-[22%] bg-[var(--chart-1)]" />
      <span className="w-[18%] bg-[var(--chart-4)]" />
    </span>
    <span className="text-muted-foreground flex gap-3 text-xs">
      <span>Events</span>
      <span>Food</span>
      <span>Merch</span>
    </span>
  </Preview>
);

const CRM_PREVIEW = (
  <Preview tint={PANEL.pink}>
    {(
      [
        ["Northbank Credit Union", "Follow up", "amber"],
        ["Harbor Light Coffee", "Sponsor", "success"],
        ["Alder Robotics", "Talked once", "muted"],
      ] as const
    ).map(([name, tag, tint]) => (
      <span key={name} className="flex items-center gap-2 text-[12.5px] opacity-90">
        <b className="flex-1 truncate">{name}</b>
        <Pill tint={tint}>{tag}</Pill>
      </span>
    ))}
  </Preview>
);

function Card({
  preview,
  name,
  tag,
  body,
  foot,
  actions,
}: {
  preview: ReactNode;
  name: string;
  tag?: ReactNode;
  body: string;
  foot: string;
  actions: ReactNode;
}) {
  return (
    <li className="bg-card text-card-foreground ring-foreground/6 rounded-card edge flex flex-col overflow-hidden ring-1">
      {preview}
      <div className="flex flex-1 flex-col gap-3 p-[22px] pt-5">
        <div className="flex items-center gap-2.5">
          <h3 className="heading text-[19px]">{name}</h3>
          {tag}
        </div>
        <p className="text-sm leading-relaxed">{body}</p>
        <p className="text-muted-foreground text-[12.5px]">{foot}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">{actions}</div>
      </div>
    </li>
  );
}

export function AddOnCards({
  orgId,
  orgSlug,
  added,
  canManage,
  locked,
}: {
  orgId: string;
  orgSlug: string;
  added: readonly AddOnId[];
  canManage: boolean;
  /** Add-ons the plan doesn't include: offered as an upgrade, not an Add. */
  locked: readonly AddOnId[];
}) {
  const base = `/app/${orgSlug}`;
  const card = (id: AddOnId, preview: ReactNode) => {
    const info = ADD_ON_INFO[id];
    const on = added.includes(id);
    const page = `${base}/integrations/${id}`;
    return (
      <Card
        key={id}
        preview={preview}
        name={info.name}
        tag={
          on ? (
            <Pill tint="success">
              <Check className="mr-1 size-3" aria-hidden="true" />
              Added
            </Pill>
          ) : undefined
        }
        body={info.summary}
        foot={!on && locked.includes(id) ? `Not on your plan. ${info.who}.` : info.who}
        actions={
          on ? (
            <>
              <Button asChild variant="outline">
                <Link href={`${base}${info.path}`}>Open {info.name}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href={page}>Details</Link>
              </Button>
            </>
          ) : (
            <>
              {locked.includes(id)
                ? canManage && (
                    <Button asChild>
                      <Link href={`${base}/settings/plan`}>See plans</Link>
                    </Button>
                  )
                : canManage && <AddAddOnButton orgId={orgId} orgSlug={orgSlug} id={id} />}
              <Button asChild variant="ghost">
                <Link href={page}>Details</Link>
              </Button>
            </>
          )
        }
      />
    );
  };
  return (
    <ul className="grid gap-[18px] md:grid-cols-2 xl:grid-cols-3">
      {card("forms", FORMS_PREVIEW)}
      {card("finance", FINANCE_PREVIEW)}
      <Card
        preview={CRM_PREVIEW}
        name="CRM"
        tag={<Pill>Coming later</Pill>}
        body="Sponsors, partners and contacts in one place, with every email and meeting you've had with them."
        foot="Not ready to add yet"
        actions={
          <Button asChild variant="ghost">
            <Link href={`${base}/integrations/crm`}>Details</Link>
          </Button>
        }
      />
    </ul>
  );
}
