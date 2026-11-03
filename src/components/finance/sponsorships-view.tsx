"use client";

import { Banknote, Handshake, Plus, Ticket, Trash2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createSponsor,
  createSponsorship,
  updateSponsorship,
  updateSponsorshipStatus,
  deleteSponsor,
  deleteSponsorship,
} from "@/app/app/[orgSlug]/finance/sponsorships-actions";
import { AmbientActions } from "@/components/ambient/ambient-button";
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
import { invoiceLate, lateReason, reminderMailto } from "@/lib/ambient/finance";
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
  /** When the money is due (a late invoice gets Send a reminder). */
  expectedOn?: Date | string | null;
  sponsor: {
    id: string;
    name: string;
    contactName?: string | null;
    contactEmail?: string | null;
  };
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
    icon: Banknote,
  },
  {
    value: SponsorshipType.CREDITS,
    label: "Credits",
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
  currentUserId,
  budgetHref,
  orgName = "our organization",
}: {
  orgId: string;
  sponsors: Sponsor[];
  sponsorships: Sponsorship[];
  periodId: string | null;
  members: { userId: string; name: string | null; email: string }[];
  /** A new sponsorship is yours to look after unless you pick someone else. */
  currentUserId?: string;
  budgetHref?: string;
  /** Signs the reminder to a sponsor. */
  orgName?: string;
}) {
  const router = useRouter();
  // When the page was loaded: how late an invoice is.
  const [now] = useState(() => new Date());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [showNewSponsor, setShowNewSponsor] = useState(false);
  const [sponsorName, setSponsorName] = useState("");

  const [showNewSponsorship, setShowNewSponsorship] = useState(false);
  // Typed: an existing sponsor's name picks it; anything else adds a new one.
  const [sponsorText, setSponsorText] = useState("");
  const [startStatus, setStartStatus] = useState<SponsorshipStatus>("COMMITTED");
  const [type, setType] = useState<SponsorshipType>(SponsorshipType.CASH);
  const [amount, setAmount] = useState("");
  const [tier, setTier] = useState("");
  const [ownerId, setOwnerId] = useState(
    members.some((m) => m.userId === currentUserId) ? currentUserId! : (members[0]?.userId ?? ""),
  );

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
      const typed = sponsorText.trim();
      const known = sponsors.find((x) => x.name.toLowerCase() === typed.toLowerCase());
      const result = await createSponsorship(orgId, {
        ...(known ? { sponsorId: known.id } : { sponsorName: typed }),
        budgetPeriodId: periodId,
        type,
        amountCents,
        tier: tier || null,
        ownerId,
        status: startStatus,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowNewSponsorship(false);
      setType(SponsorshipType.CASH);
      setSponsorText("");
      setAmount("");
      setTier("");
      router.refresh();
    });
  }

  function edit(sponsorshipId: string, input: Record<string, unknown>) {
    setError(null);
    startTransition(async () => {
      const result = await updateSponsorship(orgId, sponsorshipId, input);
      if (result.error) setError(result.error);
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
      title: `Delete the sponsorship from ${name}?`,
      description: received ? "The money received stays under Transactions." : undefined,
      confirmLabel: "Delete",
      run: async () => (await deleteSponsorship(orgId, id)).error,
    });
    if (ok) {
      toast({ title: "Deleted" });
      router.refresh();
    }
  }

  async function removeSponsor(id: string, name: string) {
    const ok = await confirm({
      title: `Delete ${name}?`,
      confirmLabel: "Delete",
      run: async () => (await deleteSponsor(orgId, id)).error,
    });
    if (ok) {
      toast({ title: "Deleted" });
      router.refresh();
    }
  }

  const openForm = () => {
    setError(null);
    setShowNewSponsorship(true);
  };

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
          <h2 id="sponsorships-title" className="sr-only">
            Sponsorships
          </h2>
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
                <span aria-hidden="true" className="bg-muted-strong hatch size-2.5 rounded-[3px]" />
                Pledged, not received{" "}
                <b className="figure font-semibold">{formatCents(committedTotal)}</b>
              </span>
              {hasCredits && (
                <span className="text-muted-foreground inline-flex items-center gap-1.5">
                  <Ticket className="size-3.5" aria-hidden="true" />
                  Credits{" "}
                  <span className="figure">
                    {formatCents(creditsReceivedTotal)} received,{" "}
                    {formatCents(creditsCommittedTotal)} committed
                  </span>
                </span>
              )}
            </div>
          </div>
        )}
        {cashTotal === 0 && hasCredits && (
          <p className="text-muted-foreground figure px-6 text-sm">
            Credits: {formatCents(creditsReceivedTotal)} received,{" "}
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
              <Segmented
                label="Where it stands"
                value={startStatus}
                onSelect={(v) => setStartStatus(v as SponsorshipStatus)}
                options={(["PROSPECT", "COMMITTED", "RECEIVED"] as const).map((st) => ({
                  value: st,
                  label: STATUS_LABEL[st],
                }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-muted-foreground block text-[13px] font-medium">Sponsor</span>
                <Input
                  list="sponsor-names"
                  aria-label="Sponsor"
                  value={sponsorText}
                  onChange={(e) => setSponsorText(e.target.value)}
                  autoComplete="off"
                />
                <datalist id="sponsor-names">
                  {sponsors.map((x) => (
                    <option key={x.id} value={x.name} />
                  ))}
                </datalist>
              </label>
              <label className="space-y-1.5">
                <span className="text-muted-foreground block text-[13px] font-medium">Owner</span>
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
                <span className="text-muted-foreground block text-[13px] font-medium">
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
                <span className="text-muted-foreground block text-[13px] font-medium">Tier</span>
                <Input
                  placeholder="Gold, Silver…"
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                />
              </label>
            </div>
            {type === "CREDITS" && (
              <p className="text-muted-foreground text-[13px]">Not counted in the balance.</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowNewSponsorship(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending || !sponsorText.trim() || !ownerId || !amount.trim()}
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
              description={periodId ? undefined : "Needs a budget period first."}
              action={
                periodId ? (
                  <Button variant="outline" onClick={openForm}>
                    <Plus aria-hidden="true" />
                    New sponsorship
                  </Button>
                ) : budgetHref ? (
                  <Button variant="outline" asChild>
                    <a href={budgetHref}>Open Budget</a>
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
                        <Select
                          value={s.owner.id}
                          onValueChange={(v) => edit(s.id, { ownerId: v })}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={`Owner of the sponsorship from ${s.sponsor.name}`}
                            className="hover:bg-muted -ml-1.5 border-transparent bg-transparent pr-2 pl-1.5"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {members.map((m) => (
                              <SelectItem key={m.userId} value={m.userId}>
                                {m.name ?? m.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                        {(s.status === "COMMITTED" || s.status === "INVOICED") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="ms-1"
                            disabled={isPending}
                            onClick={() => handleStatusChange(s.id, "RECEIVED")}
                          >
                            Mark received
                          </Button>
                        )}
                        <LateInvoice sponsorship={s} orgName={orgName} now={now} />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        <AmountCell
                          cents={s.amountCents}
                          label={`Amount from ${s.sponsor.name}`}
                          onSave={(cents) => edit(s.id, { amountCents: cents })}
                        />
                        {s.type === "CREDITS" && (
                          <span className="text-muted-foreground block text-xs font-normal">
                            in credits
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-1.5">
                        <ItemMenu
                          label={`Actions for ${s.sponsor.name}`}
                          items={[
                            {
                              label: "Delete",
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
          !showNewSponsor && <p className="text-muted-foreground text-sm">No sponsors yet</p>
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
                      label: "Delete",
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

/** An amount you can change where it is: click, type, and it saves when you leave the field. */
function AmountCell({
  cents,
  label,
  onSave,
}: {
  cents: number;
  label: string;
  onSave: (cents: number) => void;
}) {
  const [value, setValue] = useState((cents / 100).toFixed(2));
  return (
    <span className="relative inline-block">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-sm">
        $
      </span>
      <Input
        aria-label={label}
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          let next: number;
          try {
            next = parseDollarsToCents(value);
          } catch {
            setValue((cents / 100).toFixed(2));
            return;
          }
          setValue((next / 100).toFixed(2));
          if (next !== cents) onSave(next);
        }}
        className="hover:border-input focus-visible:border-input h-8 w-28 border-transparent bg-transparent pl-5 text-right tabular-nums shadow-none"
      />
    </span>
  );
}

/**
 * Send a reminder, on an invoice past its date: the email written and ready
 * in the treasurer's own mail app, to the sponsor's contact.
 */
function LateInvoice({
  sponsorship: s,
  orgName,
  now,
}: {
  sponsorship: Sponsorship;
  orgName: string;
  now: Date;
}) {
  const late = s.expectedOn
    ? invoiceLate({ status: s.status, expectedOn: s.expectedOn }, now)
    : null;
  const to = s.sponsor.contactEmail?.trim();
  if (late === null || !s.expectedOn || !to) return null;
  return (
    <AmbientActions
      why
      className="ms-1 mt-1 items-start"
      actions={[
        {
          key: "remind",
          label: "Send a reminder",
          reason: lateReason(s.expectedOn, late),
          ariaLabel: `Send ${s.sponsor.name} a reminder`,
          href: reminderMailto({
            to,
            contactName: s.sponsor.contactName ?? null,
            orgName,
            amountCents: s.amountCents,
            expectedOn: s.expectedOn,
          }),
        },
      ]}
    />
  );
}
