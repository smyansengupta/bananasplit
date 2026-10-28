"use client";

import { formatDistanceToNow } from "date-fns";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Banknote,
  Download,
  Ticket,
  Trash2,
  UserPlus,
  UserX,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  addGuest,
  deleteGuest,
  setGuestCheckedIn,
  setGuestPaid,
  setGuestStatus,
} from "@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions";
import { EmptyState } from "@/components/empty-state";
import { ItemMenu } from "@/components/item-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchField } from "@/components/ui/search-field";
import { chipClass } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { avatarTint } from "@/components/user-avatar";
import { formatPhone, initials, instagramUrl } from "@/lib/rsvp/format";
import { formatCents } from "@/lib/rsvp/pay";
import { cn } from "@/lib/utils";

export interface RsvpGuest {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Instagram handle, without the @. */
  instagram: string | null;
  status: "GOING" | "WAITLIST" | "CANCELLED";
  checkedIn: boolean;
  createdAt: string;
  /** Whose invite link they signed up with. */
  invitedBy: string | null;
  /** Still-signed-up guests who came through their link. */
  invitedCount: number;
  /** Bring list lines they took. */
  bringing: string[];
  /** Split the cost: what they said and whether a host confirmed it. */
  paid: { cents: number | null; claimed: boolean; confirmed: boolean };
}

type Filter = "all" | "GOING" | "WAITLIST" | "CANCELLED";

const STATUS_BADGE: Record<
  RsvpGuest["status"],
  { label: string; variant: "success" | "accent" | "secondary" }
> = {
  GOING: { label: "Going", variant: "success" },
  WAITLIST: { label: "Waitlist", variant: "accent" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
};

/** Quotes a CSV cell, and defuses spreadsheet formulas (=, +, -, @). */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function RsvpGuests({
  orgId,
  eventId,
  eventTitle,
  guests,
  canAdd,
  shareUrl,
  owes,
}: {
  orgId: string;
  eventId: string;
  eventTitle: string;
  guests: RsvpGuest[];
  canAdd: boolean;
  shareUrl: string | null;
  /** Split the cost: one guest's share now; null when the event is free. */
  owes: number | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [confirmEl, confirm] = useConfirm();

  const counts = useMemo(
    () => ({
      all: guests.filter((g) => g.status !== "CANCELLED").length,
      GOING: guests.filter((g) => g.status === "GOING").length,
      WAITLIST: guests.filter((g) => g.status === "WAITLIST").length,
      CANCELLED: guests.filter((g) => g.status === "CANCELLED").length,
    }),
    [guests],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guests.filter((g) => {
      if (filter === "all" ? g.status === "CANCELLED" : g.status !== filter) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        g.email.includes(q) ||
        g.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\u0000")
      );
    });
  }, [guests, query, filter]);

  function act(id: string, run: () => Promise<{ error?: string }>, done?: string) {
    setBusy(id);
    start(async () => {
      const result = await run();
      setBusy(null);
      if (result.error) toast({ title: "That didn't work", description: result.error });
      else if (done) toast({ title: done });
      router.refresh();
    });
  }

  async function remove(g: RsvpGuest) {
    const ok = await confirm({
      title: `Delete ${g.name}'s sign-up?`,
      description:
        "It's removed for good, with no email to them. To free their spot and keep a record, use Cancel spot instead.",
      confirmLabel: "Delete",
      run: async () => (await deleteGuest(orgId, eventId, g.id)).error,
    });
    if (ok) router.refresh();
  }

  const inviters = useMemo(
    () =>
      guests
        .filter((g) => g.invitedCount > 0 && g.status !== "CANCELLED")
        .sort((a, b) => b.invitedCount - a.invitedCount)
        .slice(0, 5),
    [guests],
  );

  function exportCsv() {
    const rows = [
      [
        "Name",
        "Email",
        "Phone",
        "Instagram",
        "Status",
        "Checked in",
        "Signed up",
        "Invited by",
        "Brought",
        "Bringing",
        ...(owes !== null ? ["Paid"] : []),
      ],
      ...guests.map((g) => [
        g.name,
        g.email,
        g.phone,
        g.instagram ? `@${g.instagram}` : "",
        STATUS_BADGE[g.status].label,
        g.checkedIn ? "Yes" : "No",
        new Date(g.createdAt).toISOString(),
        g.invitedBy ?? "",
        String(g.invitedCount),
        g.bringing.join("; "),
        ...(owes !== null
          ? [
              g.paid.confirmed
                ? `Paid ${formatCents(g.paid.cents ?? owes)}`
                : g.paid.claimed
                  ? `Says paid ${formatCents(g.paid.cents ?? owes)}`
                  : "",
            ]
          : []),
      ]),
    ];
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${
      eventTitle
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase() || "event"
    }-guests.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-4">
      {confirmEl}
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={query}
          onValueChange={setQuery}
          placeholder="Search guests"
          aria-label="Search guests by name, email or phone"
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {(
            [
              ["all", "Signed up"],
              ["GOING", "Going"],
              ["WAITLIST", "Waitlist"],
              ["CANCELLED", "Cancelled"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={chipClass(filter === value)}
            >
              {label}
              <span className="tabular-nums opacity-70">{counts[value]}</span>
            </button>
          ))}
        </div>
        <div className="ms-auto flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={guests.length === 0}>
            <Download aria-hidden="true" />
            Export CSV
          </Button>
          {canAdd && (
            <Button variant="create" onClick={() => setAdding(true)}>
              <UserPlus aria-hidden="true" />
              Add guest
            </Button>
          )}
        </div>
      </div>

      {inviters.length > 0 && (
        <div className="bg-card ring-foreground/6 edge rounded-tile flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm ring-1">
          <span className="text-muted-foreground text-[13px] font-medium">
            Brought the most friends
          </span>
          {inviters.map((g) => (
            <span key={g.id} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-6 place-items-center rounded-full text-[10px] font-bold",
                  avatarTint(g.name),
                )}
              >
                {initials(g.name)}
              </span>
              <span className="font-medium">{g.name}</span>
              <span className="text-muted-foreground tabular-nums">{g.invitedCount}</span>
            </span>
          ))}
        </div>
      )}

      {guests.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="Nobody has signed up yet"
          description={
            shareUrl
              ? "Share the page's link in your group chat, newsletter or socials. Sign-ups show up here as they come in."
              : "Turn on the RSVP page to start taking sign-ups."
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          size="compact"
          title="No guests match"
          description="Try another name or filter."
        />
      ) : (
        <div className="bg-card ring-foreground/6 edge rounded-card overflow-x-auto p-2 ring-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Signed up</TableHead>
                {owes !== null && <TableHead>Paid</TableHead>}
                <TableHead className="text-center">Checked in</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((g) => (
                <TableRow key={g.id} className={cn(busy === g.id && "opacity-60")}>
                  <TableCell>
                    <div className="flex min-w-48 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-8 flex-none place-items-center rounded-full text-[11px] font-bold",
                          avatarTint(g.name),
                        )}
                      >
                        {initials(g.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{g.name}</span>
                        <a
                          href={`mailto:${g.email}`}
                          className="text-muted-foreground block truncate text-xs hover:underline"
                        >
                          {g.email}
                        </a>
                        {g.instagram && (
                          <a
                            href={instagramUrl(g.instagram)}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-muted-foreground block truncate text-xs hover:underline"
                          >
                            @{g.instagram} on Instagram
                          </a>
                        )}
                        {(g.invitedBy || g.bringing.length > 0) && (
                          <span className="text-muted-foreground block truncate text-xs">
                            {[
                              g.invitedBy && `Invited by ${g.invitedBy}`,
                              g.bringing.length > 0 && `Bringing ${g.bringing.join(", ")}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <a href={`tel:${g.phone}`} className="hover:underline">
                      {formatPhone(g.phone)}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[g.status].variant}>
                      {STATUS_BADGE[g.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    {formatDistanceToNow(new Date(g.createdAt), { addSuffix: true })}
                  </TableCell>
                  {owes !== null && (
                    <TableCell className="whitespace-nowrap">
                      {g.status !== "GOING" ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : g.paid.confirmed ? (
                        <Badge variant="success">Paid {formatCents(g.paid.cents ?? owes)}</Badge>
                      ) : (
                        <Button
                          variant={g.paid.claimed ? "default" : "outline"}
                          size="sm"
                          disabled={busy === g.id}
                          onClick={() =>
                            act(
                              g.id,
                              () => setGuestPaid(orgId, eventId, g.id, true),
                              `${g.name} is marked paid`,
                            )
                          }
                          title={
                            g.paid.claimed
                              ? "They said they paid. Confirm once you see it."
                              : "Mark paid (cash at the door, or a payment you got)"
                          }
                        >
                          {g.paid.claimed
                            ? `Confirm ${formatCents(g.paid.cents ?? owes)}`
                            : `Owes ${formatCents(owes)}`}
                        </Button>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    <Checkbox
                      checked={g.checkedIn}
                      disabled={g.status !== "GOING" || busy === g.id}
                      aria-label={`${g.name} checked in`}
                      onCheckedChange={(v) =>
                        act(g.id, () => setGuestCheckedIn(orgId, eventId, g.id, v === true))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <ItemMenu
                      label={`Actions for ${g.name}`}
                      items={[
                        g.status !== "GOING" && {
                          label: "Move to going",
                          icon: ArrowUpToLine,
                          onSelect: () =>
                            act(
                              g.id,
                              () => setGuestStatus(orgId, eventId, g.id, "GOING"),
                              `${g.name} is going`,
                            ),
                        },
                        g.status !== "WAITLIST" && {
                          label: "Move to waitlist",
                          icon: ArrowDownToLine,
                          onSelect: () =>
                            act(
                              g.id,
                              () => setGuestStatus(orgId, eventId, g.id, "WAITLIST"),
                              `${g.name} is on the waitlist`,
                            ),
                        },
                        owes !== null &&
                          g.status === "GOING" &&
                          (g.paid.confirmed || g.paid.claimed) && {
                            label: "Mark not paid",
                            icon: Banknote,
                            onSelect: () =>
                              act(g.id, () => setGuestPaid(orgId, eventId, g.id, false)),
                          },
                        g.status !== "CANCELLED" && {
                          label: "Cancel spot",
                          icon: UserX,
                          onSelect: () =>
                            act(
                              g.id,
                              () => setGuestStatus(orgId, eventId, g.id, "CANCELLED"),
                              `${g.name}'s spot was cancelled`,
                            ),
                        },
                        {
                          label: "Delete",
                          icon: Trash2,
                          destructive: true,
                          separated: true,
                          onSelect: () => void remove(g),
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddGuestDialog
        open={adding}
        onOpenChange={setAdding}
        onAdd={async (input) => {
          const result = await addGuest(orgId, eventId, input);
          if (!result.error) {
            toast({
              title: `${input.name} is going`,
              description: "They'll get a confirmation email.",
            });
            router.refresh();
          }
          return result.error;
        }}
      />
    </section>
  );
}

function AddGuestDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (input: { name: string; email: string; phone: string }) => Promise<string | undefined>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(form: FormData) {
    setError(null);
    const input = {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
    };
    start(async () => {
      const failed = await onAdd(input);
      if (failed) setError(failed);
      else onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a guest</DialogTitle>
          <DialogDescription>
            They go straight onto the going list, even if the event is full, and get the same
            confirmation email as everyone else.
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="guest-name">Name</Label>
            <Input id="guest-name" name="name" required maxLength={100} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="guest-email">Email</Label>
            <Input
              id="guest-email"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="guest-phone">Phone</Label>
            <Input
              id="guest-phone"
              name="phone"
              type="tel"
              required
              maxLength={32}
              autoComplete="off"
            />
          </div>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add guest"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
