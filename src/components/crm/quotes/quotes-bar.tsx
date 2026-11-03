"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createQuoteAction } from "@/app/app/[orgSlug]/crm/quote-actions";
import { FileText, Plus, ReceiptText } from "@/components/icons";
import { CrmPicker } from "@/components/crm/crm-picker";
import { useUrlState } from "@/components/crm/use-url";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { ExpandChip } from "@/components/ui/toolbar-chips";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

/**
 * The Quotes tab's bar, the Tasks bar pattern: what state they're in (with
 * counts), quotes or invoices, search at the right, and New. New asks for
 * the one thing a quote needs, who it's for, then opens the editor.
 */
export function QuotesBar({
  orgId,
  orgSlug,
  counts,
}: {
  orgId: string;
  orgSlug: string;
  counts: Record<string, number>;
}) {
  const url = useUrlState();
  const router = useRouter();
  const status = url.get("status") ?? "open";
  const kind = url.get("kind");
  const [open, setOpen] = useState(false);
  const [newKind, setNewKind] = useState<"quote" | "invoice">("quote");
  const [forKind, setForKind] = useState<"deal" | "company" | "person">("deal");
  const [pending, setPending] = useState(false);

  async function make(id: string) {
    setPending(true);
    const target = forKind === "deal" ? { dealId: id } : forKind === "company" ? { companyId: id } : { personId: id };
    const r = await createQuoteAction(orgId, { ...target, kind: newKind }).catch(() => null);
    setPending(false);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
      return;
    }
    router.push(`/app/${orgSlug}/crm/quotes/${r.id}`);
  }

  return (
    <div className="@container/toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="State"
          value={status}
          onSelect={(v) => url.set({ status: v === "open" ? undefined : v })}
          options={[
            { value: "open", label: "Open", count: counts.open },
            { value: "accepted", label: "Accepted", count: counts.accepted },
            { value: "paid", label: "Paid", count: counts.paid },
            { value: "closed", label: "Declined or expired", count: counts.closed },
          ]}
        />
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Show">
          <ExpandChip icon={FileText} label="Quotes" active={kind === "quote"} onClick={() => url.set({ kind: kind === "quote" ? undefined : "quote" })} />
          <ExpandChip
            icon={ReceiptText}
            label="Invoices"
            active={kind === "invoice"}
            onClick={() => url.set({ kind: kind === "invoice" ? undefined : "invoice" })}
          />
        </div>
        <div className="ms-auto flex min-w-48 flex-1 items-center justify-end gap-2">
          <SearchField
            key={url.get("q") ?? ""}
            defaultValue={url.get("q") ?? ""}
            placeholder="Search quotes"
            aria-label="Search quotes"
            onKeyDown={(e) => {
              if (e.key === "Enter") url.set({ q: (e.target as HTMLInputElement).value.trim() || undefined });
            }}
            onClear={() => url.set({ q: undefined })}
          />
          <Button variant="create" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New
          </Button>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New {newKind}</DialogTitle>
            <DialogDescription>Pick who it&apos;s for. You add the lines next.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quote or invoice">
              {(["quote", "invoice"] as const).map((k) => (
                <button key={k} type="button" aria-pressed={newKind === k} onClick={() => setNewKind(k)} className={cn(chipClass(newKind === k), "h-8 px-3 text-[13px]")}>
                  {k === "quote" ? "Quote" : "Invoice"}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="For">
              {(
                [
                  ["deal", "An item"],
                  ["company", "A company"],
                  ["person", "A person"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={forKind === k} onClick={() => setForKind(k)} className={cn(chipClass(forKind === k), "h-8 px-3 text-[13px]")}>
                  {label}
                </button>
              ))}
            </div>
            <CrmPicker
              key={forKind}
              orgId={orgId}
              kind={forKind}
              value={null}
              autoOpen
              allowClear={false}
              placeholder={pending ? "Making it…" : "Search"}
              onPick={(hit) => {
                if (hit) void make(hit.id);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
