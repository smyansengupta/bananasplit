"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createQuoteAction } from "@/app/app/[orgSlug]/crm/quote-actions";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { crmQuoteHref } from "@/lib/crm/href";

/** New quote and New invoice on a record: a draft made for it, then its card. */
export function NewQuoteButtons({
  orgId,
  orgSlug,
  target,
}: {
  orgId: string;
  orgSlug: string;
  target: { dealId?: string; companyId?: string; personId?: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function make(kind: "quote" | "invoice") {
    setPending(true);
    const r = await createQuoteAction(orgId, { ...target, kind }).catch(() => null);
    setPending(false);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
      return;
    }
    router.push(crmQuoteHref(orgSlug, { id: r.id, dealId: target.dealId }));
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void make("quote")}>
        <Plus className="size-4" aria-hidden="true" />
        Quote
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void make("invoice")}>
        <Plus className="size-4" aria-hidden="true" />
        Invoice
      </Button>
    </div>
  );
}
