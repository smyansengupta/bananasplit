"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { bringInAction } from "@/app/app/[orgSlug]/crm/actions";
import { AmbientButton } from "@/components/ambient/ambient-button";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { toast } from "@/components/ui/toaster";

/**
 * A brand-new CRM's People (States.dc.html, "Nobody here yet"): the
 * people Bananasplit already knows (members and event guests) in one
 * click, a spreadsheet through Import, or one person at a time through
 * the New card; or the full setup.
 */
export function PeopleEmpty({
  orgId,
  orgSlug,
  members,
  contacts,
}: {
  orgId: string;
  orgSlug: string;
  members: number;
  contacts: number;
}) {
  const router = useRouter();
  const { hrefFor } = useCrmOpen();
  const base = `/app/${orgSlug}/crm`;
  const known = members + contacts;
  const who = [
    members ? `${members} ${members === 1 ? "member" : "members"}` : null,
    contacts ? `${contacts} event ${contacts === 1 ? "guest" : "guests"}` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  return (
    <section className="bg-card ring-foreground/6 mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-[22px] p-7 ring-1 max-sm:p-5">
      <div className="space-y-1.5">
        <h2 className="heading text-2xl">Nobody here yet</h2>
        <p className="text-muted-foreground text-[15px]">
          Start with the people you already know. Pick any of these.
        </p>
      </div>
      <div className="divide-border/70 flex flex-col divide-y">
        {known > 0 && (
          <Choice title="People already in Bananasplit" sub={who}>
            <AmbientButton
              action={{
                key: "bring",
                label: `Bring in ${known.toLocaleString("en-US")}`,
                tone: "solid",
                reason: `${who} aren't in the CRM yet`,
                run: async () => {
                  let added = 0;
                  let queued = 0;
                  for (const source of ["members", "contacts"] as const) {
                    if ((source === "members" ? members : contacts) === 0) continue;
                    const r = await bringInAction(orgId, source);
                    if (!r.ok) return r;
                    added += r.added + r.linked;
                    queued += r.queued;
                  }
                  toast({
                    title: queued
                      ? `${(added + queued).toLocaleString("en-US")} are coming in. They show up here in a minute.`
                      : `Brought in ${added.toLocaleString("en-US")}.`,
                  });
                  router.refresh();
                  return {};
                },
              }}
            />
          </Choice>
        )}
        <Choice title="A spreadsheet" sub="CSV, Excel or another CRM's export.">
          <AmbientButton
            action={{ key: "file", label: "Choose a file", tone: "outline", reason: "Import", href: `${base}/import` }}
          />
        </Choice>
        <Choice title="One at a time" sub="A name and an email is enough.">
          <AmbientButton
            action={{
              key: "one",
              label: "Add a person",
              tone: "outline",
              reason: "New person",
              href: hrefFor({ kind: "new", what: "person" }),
            }}
          />
        </Choice>
      </div>
      <Link href={`${base}/setup`} className="text-muted-foreground self-start text-sm font-medium underline-offset-4 hover:underline">
        Or walk through the full setup
      </Link>
    </section>
  );
}

function Choice({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <b className="block text-[15px]">{title}</b>
        <span className="text-muted-foreground text-sm">{sub}</span>
      </div>
      {children}
    </div>
  );
}
