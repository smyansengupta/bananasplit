"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { addTextSenderAction } from "@/app/app/[orgSlug]/crm/phone-actions";
import { UserPlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { crmRecordHref } from "@/lib/crm/href";

/**
 * Someone texted the organization's number and isn't in the CRM: their name
 * (optional) and one click adds them, with every text from that number on
 * their timeline, and opens their page.
 */
export function AddTextSender({ orgId, orgSlug, textId }: { orgId: string; orgSlug: string; textId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  async function add() {
    setPending(true);
    const r = await addTextSenderAction(orgId, textId, name.trim() || null).catch(() => null);
    setPending(false);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't save.", tone: "error" });
      return;
    }
    toast({ title: "Added. Their texts are on their timeline.", tone: "success" });
    router.push(crmRecordHref(orgSlug, "person", r.personId));
  }
  return (
    <form
      className="mt-1.5 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" aria-label="Their name" className="h-8 min-w-0 flex-1" maxLength={200} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        <UserPlus className="size-4" aria-hidden="true" />
        Add as person
      </Button>
    </form>
  );
}
