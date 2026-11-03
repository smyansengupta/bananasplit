"use client";

import { X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { addDealPersonAction, removeDealPersonAction } from "@/app/app/[orgSlug]/crm/actions";
import { toast } from "@/components/ui/toaster";
import { crmRecordHref } from "@/lib/crm/href";

import { CrmPicker } from "./crm-picker";

/** The people on an item, each with their role, added from a search and removed in one click. */
export function DealPeople({
  orgId,
  orgSlug,
  dealId,
  people,
}: {
  orgId: string;
  orgSlug: string;
  dealId: string;
  people: { id: string; name: string; role: string | null; sub: string | null }[];
}) {
  const router = useRouter();
  return (
    <div className="space-y-2">
      {people.length === 0 && <p className="text-muted-foreground text-sm">Nobody on it yet.</p>}
      <ul className="space-y-1.5 text-sm">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <Link href={crmRecordHref(orgSlug, "person", p.id)} className="font-semibold hover:underline">
              {p.name}
            </Link>
            <span className="text-muted-foreground min-w-0 flex-1 truncate">{p.role ?? p.sub}</span>
            <button
              type="button"
              aria-label={`Take ${p.name} off`}
              className="text-muted-foreground hover:bg-muted grid size-7 place-items-center rounded-full"
              onClick={async () => {
                const r = await removeDealPersonAction(orgId, dealId, p.id).catch(() => null);
                if (!r || !r.ok) toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
                router.refresh();
              }}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <CrmPicker
        orgId={orgId}
        kind="person"
        value={null}
        allowClear={false}
        placeholder="Add a person"
        onPick={async (hit) => {
          if (!hit) return;
          const r = await addDealPersonAction(orgId, dealId, hit.id).catch(() => null);
          if (!r || !r.ok) toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
          router.refresh();
        }}
      />
    </div>
  );
}
