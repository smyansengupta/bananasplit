"use client";

import { Check } from "@/components/icons";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import type { OrgKind, OrgPlan } from "@/generated/prisma/enums";
import type { PricedPlan } from "@/lib/billing/features";
import { formatStorage, formatUsed } from "@/lib/billing/storage";
import { cn } from "@/lib/utils";

import { switchPlan } from "./actions";

export interface PlanCard {
  plan: PricedPlan;
  name: string;
  price: string;
  per: string;
  who: string;
  /** "Includes", "Everything in Team, plus". */
  intro: string;
  features: string[];
  /** Storage, largest file, note history (shown under the features). */
  limits: { label: string; value: string }[];
  storageBytes: number;
}

/** Up or down the ladder: a trial is Team Advanced, so choosing Team from it locks its extras. */
const RANK: Record<OrgPlan, number> = { FREE: 0, PERSONAL_PLUS: 1, CLUB: 1, SOCIETY: 2, TRIAL: 2 };

/**
 * The two tiers a space can be on, side by side, the current one marked
 * (neither during a club's trial): Personal Free and Personal Plus for a
 * Personal space, Team and Team Advanced for a club. The owner gets a
 * button on the other (with a confirm that says what changes, and that a
 * space left over its storage only stops taking uploads); everyone else
 * sees who can choose.
 */
export function PlanCards({
  orgId,
  kind,
  current,
  cards,
  canSwitch,
  usedBytes,
}: {
  orgId: string;
  kind: OrgKind;
  current: OrgPlan;
  cards: PlanCard[];
  canSwitch: boolean;
  usedBytes: number;
}) {
  const router = useRouter();
  const [confirmEl, confirm] = useConfirm();
  const verb = current === "TRIAL" ? "Choose" : "Switch to";

  async function choose(card: PlanCard) {
    const down = RANK[card.plan] < RANK[current];
    const lost = cards
      .filter((c) => RANK[c.plan] > RANK[card.plan] && RANK[c.plan] <= RANK[current])
      .flatMap((c) => c.features);
    const over =
      usedBytes > card.storageBytes
        ? ` You're using ${formatUsed(usedBytes, card.storageBytes)} and ${card.name} has ${formatStorage(card.storageBytes)}: uploads pause until you're back under. Nothing is deleted.`
        : "";
    const ok = await confirm({
      title: `${verb} ${card.name}?`,
      description: down
        ? `These will be locked until you switch back: ${lost.join(", ")}. Nothing is deleted.${over}`
        : `It takes effect right away. Billing isn't connected yet, so nothing is charged.${over}`,
      confirmLabel: `${verb} ${card.name}`,
      tone: down ? "destructive" : "default",
      run: async () => {
        const result = await switchPlan(orgId, card.plan);
        return result.error;
      },
    });
    if (!ok) return;
    toast({
      title: kind === "PERSONAL" ? `You're on ${card.name}` : `Your club is on the ${card.name} plan`,
      tone: "success",
    });
    router.refresh();
  }

  return (
    <>
      <div className="grid gap-4.5 md:grid-cols-2">
        {cards.map((card) => {
          const isCurrent = card.plan === current;
          return (
            <div
              key={card.plan}
              className={cn(
                "bg-card edge rounded-card flex flex-col gap-5 p-6 max-sm:p-4.5",
                isCurrent && "ring-brand-accent ring-2",
              )}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="heading">{card.name}</h2>
                  {isCurrent && <Badge variant="accent">Current plan</Badge>}
                </div>
                <p className="text-muted-foreground text-sm">{card.who}</p>
              </div>
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="numeral text-3xl">{card.price}</span>
                <span className="text-muted-foreground text-sm">{card.per}</span>
              </p>
              <div className="space-y-2">
                <p className="eyebrow">{card.intro}</p>
                <ul className="space-y-1.5 text-sm">
                  {card.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              <dl className="bg-muted rounded-tile grid grid-cols-3 gap-2 px-4 py-3 text-sm">
                {card.limits.map((l) => (
                  <div key={l.label} className="min-w-0">
                    <dt className="text-muted-foreground text-xs">{l.label}</dt>
                    <dd className="figure font-semibold">{l.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-auto">
                {isCurrent ? null : canSwitch ? (
                  <Button
                    variant={RANK[card.plan] > RANK[current] ? "default" : "outline"}
                    className="w-full"
                    onClick={() => void choose(card)}
                  >
                    {verb} {card.name}
                  </Button>
                ) : (
                  <p className="text-muted-foreground text-xs">Only the owner can choose a plan.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {confirmEl}
    </>
  );
}
