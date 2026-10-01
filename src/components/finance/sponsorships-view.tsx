"use client";

import { Handshake, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createSponsor,
  createSponsorship,
  updateSponsorshipStatus,
  deleteSponsor,
  deleteSponsorship,
} from "@/app/app/[orgSlug]/finance/sponsorships-actions";
import { ItemMenu } from "@/components/item-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SponsorshipStatus } from "@/generated/prisma/enums";
import { formatCents, parseDollarsToCents } from "@/lib/finance/money";
import { EmptyState } from "@/components/empty-state";

interface Sponsor {
  id: string;
  name: string;
}

interface Sponsorship {
  id: string;
  amountCents: number;
  tier: string | null;
  status: SponsorshipStatus;
  sponsor: { id: string; name: string };
  owner: { id: string; name: string | null; email: string };
}

const STATUS_VARIANT: Record<
  SponsorshipStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PROSPECT: "outline",
  COMMITTED: "secondary",
  INVOICED: "secondary",
  RECEIVED: "default",
  DECLINED: "destructive",
  WRITTEN_OFF: "destructive",
};

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
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [showNewSponsor, setShowNewSponsor] = useState(false);
  const [sponsorName, setSponsorName] = useState("");

  const [showNewSponsorship, setShowNewSponsorship] = useState(false);
  const [sponsorId, setSponsorId] = useState("");
  const [amount, setAmount] = useState("");
  const [tier, setTier] = useState("");
  const [ownerId, setOwnerId] = useState(members[0]?.userId ?? "");

  function handleCreateSponsor() {
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
        amountCents,
        tier: tier || null,
        ownerId,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowNewSponsorship(false);
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

  const committedTotal = sponsorships
    .filter((s) => s.status === "COMMITTED" || s.status === "INVOICED")
    .reduce((sum, s) => sum + s.amountCents, 0);
  const receivedTotal = sponsorships
    .filter((s) => s.status === "RECEIVED")
    .reduce((sum, s) => sum + s.amountCents, 0);

  const [confirmEl, confirm] = useConfirm();

  async function removeSponsorship(id: string, name: string, received: boolean) {
    const ok = await confirm({
      title: `Delete the sponsorship from \u201c${name}\u201d?`,
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
      title: `Delete the sponsor \u201c${name}\u201d?`,
      description: "Only a sponsor with no sponsorships can be deleted.",
      confirmLabel: "Delete sponsor",
      run: async () => (await deleteSponsor(orgId, id)).error,
    });
    if (ok) {
      toast({ title: "Sponsor deleted", description: name });
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {confirmEl}
      <div className="flex gap-6 text-sm">
        <p>
          <span className="text-muted-foreground">Committed: </span>
          <span className="font-medium">{formatCents(committedTotal)}</span>
        </p>
        <p>
          <span className="text-muted-foreground">Received: </span>
          <span className="font-medium">{formatCents(receivedTotal)}</span>
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Sponsors</h2>
          <Button variant="outline" size="sm" onClick={() => setShowNewSponsor((v) => !v)}>
            New sponsor
          </Button>
        </div>
        {showNewSponsor && (
          <div className="flex gap-2">
            <Input
              placeholder="Company name"
              value={sponsorName}
              onChange={(e) => setSponsorName(e.target.value)}
            />
            <Button onClick={handleCreateSponsor} disabled={!sponsorName.trim()}>
              Add
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {sponsors.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-0.5 rounded-full border py-0.5 ps-2.5 pe-0.5 text-xs">
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
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Sponsorships</h2>
          {periodId && (
            <Button variant="outline" size="sm" onClick={() => setShowNewSponsorship((v) => !v)}>
              New sponsorship
            </Button>
          )}
        </div>

        {showNewSponsorship && (
          <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
            <Select value={sponsorId} onValueChange={setSponsorId}>
              <SelectTrigger>
                <SelectValue placeholder="Sponsor" />
              </SelectTrigger>
              <SelectContent>
                {sponsors.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger>
                <SelectValue placeholder="Owner" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name ?? m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              placeholder="Tier (optional)"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
            />
            <Button
              className="col-span-2"
              onClick={handleCreateSponsorship}
              disabled={!sponsorId || !ownerId || !amount.trim()}
            >
              Create
            </Button>
          </div>
        )}

        <ul className="space-y-1.5">
          {sponsorships.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium">{s.sponsor.name}</span>
                {s.tier && <Badge variant="outline">{s.tier}</Badge>}
                <span className="text-muted-foreground">{formatCents(s.amountCents)}</span>
              </span>
              <span className="flex items-center gap-1">
                <Select value={s.status} onValueChange={(v) => handleStatusChange(s.id, v)}>
                  <SelectTrigger className="w-40">
                    <SelectValue>
                      <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(SponsorshipStatus).map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ItemMenu
                  label={`Actions for ${s.sponsor.name}`}
                  items={[
                    {
                      label: "Delete sponsorship",
                      icon: Trash2,
                      destructive: true,
                      onSelect: () => void removeSponsorship(s.id, s.sponsor.name, s.status === "RECEIVED"),
                    },
                  ]}
                />
              </span>
            </li>
          ))}
          {sponsorships.length === 0 && (
            <EmptyState
              size="compact"
              icon={Handshake}
              title="No sponsorships yet"
              description="Add a sponsor, then record what they committed. Money only counts toward the balance once it's received."
            />
          )}
        </ul>
      </div>
    </div>
  );
}
