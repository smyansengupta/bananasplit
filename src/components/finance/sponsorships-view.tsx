"use client";

import { Banknote, Handshake, Plus, Ticket, Trash2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createSponsor,
  createSponsorship,
  updateSponsorshipStatus,
  deleteSponsor,
  deleteSponsorship,
} from "@/app/app/[orgSlug]/finance/sponsorships-actions";
import { TableFrame } from "@/components/databases/table-frame";
import { EmptyState } from "@/components/empty-state";
import { ItemMenu } from "@/components/item-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { MixBar } from "@/components/ui/meters";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { SponsorshipStatus, SponsorshipType } from "@/generated/prisma/enums";
import { formatCents, parseDollarsToCents } from "@/lib/finance/money";

/**
 * Finance › Sponsorships (Moonstone): the cash pipeline (received solid,
 * pledged but not yet received hatched), every sponsorship in the one table
 * style with its status as a chip you can change, and the sponsors as pills.
 */

interface Sponsor {
  id: string;
  name: string;
}

interface Sponsorship {
  id: string;
  type: SponsorshipType;
  amountCents: number;
  tier: string | null;
  status: SponsorshipStatus;
  sponsor: { id: string; name: string };
  owner: { id: string; name: string | null; email: string };
}

/** Status chips: still to come is neutral, invoiced is in progress, received is paid, lost is red. */
const STATUS_VARIANT: Record<
  SponsorshipStatus,
  "secondary" | "info" | "success" | "outline" | "destructive"
> = {
  PROSPECT: "outline",
  COMMITTED: "secondary",
  INVOICED: "info",
  RECEIVED: "success",
  DECLINED: "destructive",
  WRITTEN_OFF: "destructive",
};

const STATUS_LABEL: Record<SponsorshipStatus, string> = {
  PROSPECT: "Prospect",
  COMMITTED: "Committed",
  INVOICED: "Invoiced",
  RECEIVED: "Received",
  DECLINED: "Declined",
  WRITTEN_OFF: "Written off",
};

const TYPE_OPTIONS = [
  {
    value: SponsorshipType.CASH,
    label: "Cash",
    hint: "Money paid to the organization",
    icon: Banknote,
  },
  {
    value: SponsorshipType.CREDITS,
    label: "Credits",
    hint: "Cloud, API or software credits",
    icon: Ticket,
  },
] as const;

function sumCents(rows: Sponsorship[], type: SponsorshipType, statuses: SponsorshipStatus[]) {
  return rows
    .filter((s) => s.type === type && statuses.includes(s.status))
    .reduce((sum, s) => sum + s.amountCents, 0);
}

export function SponsorshipsView({
  orgId,
  sponsors,
  sponsorships,
  periodId,
  members,
}: {
  orgId: string;
  sponsors: Sponsor[];
  sponsorships: Sponsorship[];
  periodId: string | null;
  members: { userId: string; name: string | null; email: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [showNewSponsor, setShowNewSponsor] = useState(false);
  const [sponsorName, setSponsorName] = useState("");

  const [showNewSponsorship, setShowNewSponsorship] = useState(false);
  const [sponsorId, setSponsorId] = useState("");
  const [type, setType] = useState<SponsorshipType>(SponsorshipType.CASH);
  const [amount, setAmount] = useState("");
  const [tier, setTier] = useState("");
  const [ownerId, setOwnerId] = useState(members[0]?.userId ?? "");

  function handleCreateSponsor() {
    setError(null);
    startTransition(async () => {
      const result = await createSponsor(orgId, { name: sponsorName });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSponsorName("");
      setShowNewSponsor(false);
      router.refresh();
    });
  }

  function handleCreateSponsorship() {
    if (!periodId) return;
    setError(null);
    startTransition(async () => {
      let amountCents: number;
      try {
        amountCents = parseDollarsToCents(amount);
      } catch {
        setError("Enter a valid dollar amount.");
        return;
      }
      const result = await createSponsorship(orgId, {
        sponsorId,
        budgetPeriodId: periodId,
        type,
        amountCents,
        tier: tier || null,
        ownerId,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowNewSponsorship(false);
      setType(SponsorshipType.CASH);
      setAmount("");
      setTier("");
      router.refresh();
    });
  }

  function handleStatusChange(sponsorshipId: string, status: string) {
    startTransition(async () => {
      const result = await updateSponsorshipStatus(orgId, sponsorshipId, status);
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  const pledged: SponsorshipStatus[] = ["COMMITTED", "INVOICED"];
  const committedTotal = sumCents(sponsorships, "CASH", pledged);
  const receivedTotal = sumCents(sponsorships, "CASH", ["RECEIVED"]);
  const hasCredits = sponsorships.some((s) => s.type === "CREDITS");
  const creditsCommittedTotal = sumCents(sponsorships, "CREDITS", pledged);
  const creditsReceivedTotal = sumCents(sponsorships, "CREDITS", ["RECEIVED"]);
  const cashTotal = committedTotal + receivedTotal;

  const [confirmEl, confirm] = useConfirm();

  async function removeSponsorship(id: string, name: string, received: boolean) {
    const ok = await confirm({
      title: `Delete the sponsorship from “${name}”?`,
      description: received
        ? "The money received stays in your books as its own transaction. Delete that under Transactions too if it was a mistake."
        : "It's removed from the pipeline and the totals.",
      confirmLabel: "Delete sponsorship",
      run: async () => (await deleteSponsorship(orgId, id)).error,
    });
    if (ok) {
      toast({ title: "Sponsorship deleted", description: name });
      router.refresh();
    }
  }

  async function removeSponsor(id: string, name: string) {
    const ok = await confirm({
      title: `Delete the sponsor “${name}”?`,
      description: "Only a sponsor with no sponsorships can be deleted.",
      confirmLabel: "Delete sponsor",
      run: async () => (await deleteSponsor(orgId, id)).error,
    });
    if (ok) {
      toast({ title: "Sponsor deleted", description: name });
      router.refresh();
    }
  }

  const openForm = () => {
    setError(null);
    setShowNewSponsorship(true);
  };
  const typeHint = TYPE_OPTIONS.find((o) => o.value === type)?.hint;

  return (
    <div className="space-y-4.5">
      {confirmEl}

      {error && (
        <p
          role="alert"
          className="bg-tint-danger text-tint-danger-foreground rounded-tile p-3 text-sm"
        >
          {error}
        </p>
      )}

      <Card aria-labelledby="sponsorships-title" role="region" className="gap-5">
        <div className="flex flex-wrap items-center gap-2.5 px-6">
          <h2 id="sponsorships-title" className="heading text-[17px]">
            Sponsorships
          </h2>
          {sponsorships.length > 0 && <Badge variant="secondary">{sponsorships.length}</Badge>}
          <span className="flex-1" />
          {periodId && sponsorships.length > 0 && !showNewSponsorship && (
            <Button variant="outline" size="sm" onClick={openForm}>
              <Plus aria-hidden="true" />
              New sponsorship
            </Button>
          )}
        </div>

        {cashTotal > 0 && (
          <div className="space-y-3 px-6">
            <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="numeral text-[32px]">{formatCents(receivedTotal)}</span>
              <span className="text-muted-foreground figure text-sm">
                received of {formatCents(cashTotal)} in cash sponsorships
              </span>
            </p>
            <MixBar
              height={14}
              legend={false}
              label={`${formatCents(receivedTotal)} received, ${formatCents(committedTotal)} pledged and still to come`}
              segments={[
                { label: "Received", value: receivedTotal, color: "var(--chart-1)" },
                { label: "Pledged, not received", value: committedTotal, hatch: true },
              ]}
            />
            <div className="flex flex-wrap gap-x-4.5 gap-y-2 text-[13px]">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-(--chart-1)" />
                Received <b className="figure font-semibold">{formatCents(receivedTotal)}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="bg-muted-strong hatch size-2.5 rounded-[3px]" />
                Pledged, not received{" "}
                <b className="figure font-semibold">{formatCents(committedTotal)}</b>
              </span>
              {hasCredits && (
                <span className="text-muted-foreground inline-flex items-center gap-1.5">
                  <Ticket className="size-3.5" aria-hidden="true" />
                  Credits{" "}
                  <span className="figure">
                    {formatCents(creditsReceivedTotal)} received ·{" "}
                    {formatCents(creditsCommittedTotal)} committed
                  </span>
                </span>
              )}
            </div>
          </div>
        )}
        {cashTotal === 0 && hasCredits && (
          <p className="text-muted-foreground figure px-6 text-sm">
            Credits: {formatCents(creditsReceivedTotal)} received ·{" "}
            {formatCents(creditsCommittedTotal)} committed
          </p>
        )}

        {showNewSponsorship && periodId && (
          <form
            aria-label="New sponsorship"
            className="bg-muted/60 rounded-tile mx-6 space-y-4 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateSponsorship();
            }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                label="Type of sponsorship"
                value={type}
                onSelect={(v) => setType(v as SponsorshipType)}
                options={TYPE_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                  icon: o.icon,
                }))}
              />
              <span className="text-muted-foreground text-[13px]">{typeHint}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="eyebrow text-muted-foreground block">Sponsor</span>
                <Select value={sponsorId} onValueChange={setSponsorId} disabled={!sponsors.length}>
                  <SelectTrigger className="w-full" aria-label="Sponsor">
                    <SelectValue
                      placeholder={sponsors.length ? "Choose a sponsor" : "Add a sponsor first"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {sponsors.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5">
                <span className="eyebrow text-muted-foreground block">Owner</span>
                <Select value={ownerId} onValueChange={setOwnerId}>
                  <SelectTrigger className="w-full" aria-label="Owner">
                    <SelectValue placeholder="Who looks after it" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.name ?? m.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5">
                <span className="eyebrow text-muted-foreground block">
                  {type === "CREDITS" ? "Value of the credits" : "Amount"}
                </span>
                <div className="relative">
                  <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm">
                    $
                  </span>
                  <Input
                    placeholder="0.00"
                    inputMode="decimal"
                    aria-label={type === "CREDITS" ? "Value of the credits in dollars" : "Amount"}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="pl-7 tabular-nums"
                  />
                </div>
              </label>
              <label className="space-y-1.5">
                <span className="eyebrow text-muted-foreground block">Tier (optional)</span>
                <Input
                  placeholder="Gold, Silver…"
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                />
              </label>
            </div>
            {type === "CREDITS" && (
              <p className="text-muted-foreground text-[13px]">
                Credits are tracked at their value but never count toward the balance: marking them
                received records no transaction.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowNewSponsorship(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending || !sponsorId || !ownerId || !amount.trim()}
              >
                Create
              </Button>
            </div>
          </form>
        )}

        {sponsorships.length === 0 ? (
          !showNewSponsorship && (
            <EmptyState
              icon={Handshake}
              title="No sponsorships yet"
              description={
                periodId
                  ? "Add a sponsor, then record what they committed, in cash or credits. Cash only counts toward the balance once it's received; credits never do."
                  : "Start a budget period on the Budget tab first: each sponsorship belongs to one."
              }
              action={
                periodId ? (
                  <Button variant="outline" onClick={openForm}>
                    <Plus aria-hidden="true" />
                    New sponsorship
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="px-2.5">
            <TableFrame bare maxHeight="none">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sponsor</TableHead>
                    <TableHead className="max-md:hidden">Owner</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right tabular-nums">Amount</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sponsorships.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-semibold">{s.sponsor.name}</span>
                          {s.type === "CREDITS" && (
                            <Badge variant="secondary">
                              <Ticket aria-hidden="true" />
                              Credits
                            </Badge>
                          )}
                          {s.tier && <Badge variant="outline">{s.tier}</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-md:hidden">
                        {s.owner.name ?? s.owner.email}
                      </TableCell>
                      <TableCell>
                        <Select value={s.status} onValueChange={(v) => handleStatusChange(s.id, v)}>
                          <SelectTrigger
                            size="sm"
                            aria-label={`Status of the sponsorship from ${s.sponsor.name}`}
                            className="hover:bg-muted -ml-1.5 border-transparent bg-transparent pr-2 pl-1"
                          >
                            <SelectValue>
                              <Badge variant={STATUS_VARIANT[s.status]}>
                                {STATUS_LABEL[s.status]}
                              </Badge>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {Object.values(SponsorshipStatus).map((status) => (
                              <SelectItem key={status} value={status}>
                                {STATUS_LABEL[status]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCents(s.amountCents)}
                        {s.type === "CREDITS" && (
                          <span className="text-muted-foreground font-normal"> in credits</span>
                        )}
                      </TableCell>
                      <TableCell className="px-1.5">
                        <ItemMenu
                          label={`Actions for ${s.sponsor.name}`}
                          items={[
                            {
                              label: "Delete sponsorship",
                              icon: Trash2,
                              destructive: true,
                              onSelect: () =>
                                void removeSponsorship(
                                  s.id,
                                  s.sponsor.name,
                                  s.type === "CASH" && s.status === "RECEIVED",
                                ),
                            },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
          </div>
        )}
      </Card>

      <Card aria-labelledby="sponsors-title" role="region" className="gap-4 px-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 id="sponsors-title" className="heading text-[17px]">
            Sponsors
          </h2>
          {sponsors.length > 0 && <Badge variant="secondary">{sponsors.length}</Badge>}
          <span className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowNewSponsor((v) => !v)}
            aria-expanded={showNewSponsor}
          >
            <Plus aria-hidden="true" />
            New sponsor
          </Button>
        </div>
        {showNewSponsor && (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (sponsorName.trim()) handleCreateSponsor();
            }}
          >
            <Input
              autoFocus
              placeholder="Company name"
              aria-label="Sponsor name"
              value={sponsorName}
              onChange={(e) => setSponsorName(e.target.value)}
              className="min-w-56 flex-1"
            />
            <Button type="submit" disabled={isPending || !sponsorName.trim()}>
              Add sponsor
            </Button>
          </form>
        )}
        {sponsors.length === 0 ? (
          !showNewSponsor && (
            <p className="text-muted-foreground text-sm">
              No sponsors yet. Add the companies you work with, then record what each one gives.
            </p>
          )
        ) : (
          <ul className="flex flex-wrap gap-2">
            {sponsors.map((s) => (
              <li
                key={s.id}
                className="bg-muted inline-flex h-8 items-center gap-0.5 rounded-full pr-0.5 pl-3.5 text-[13px] font-medium"
              >
                {s.name}
                <ItemMenu
                  label={`Actions for ${s.name}`}
                  size="xs"
                  items={[
                    {
                      label: "Delete sponsor",
                      icon: Trash2,
                      destructive: true,
                      onSelect: () => void removeSponsor(s.id, s.name),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
