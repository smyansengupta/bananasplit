import { Columns3 } from "@/components/icons";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

import { crmShell } from "../../shell";

export const metadata = { title: "New item" };

/**
 * New › New item: with one pipeline, straight to its board with the form
 * open; with several, pick which (one click each).
 */
export default async function NewCrmItemPage({ params }: PageProps<"/app/[orgSlug]/crm/items/new">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const base = `/app/${orgSlug}/crm/pipelines`;
  if (shell.pipelines.length === 1) redirect(`${base}/${shell.pipelines[0]!.id}?new=1`);
  return (
    <div className="space-y-7">
      <div className="space-y-3">
        <BackLink href={`/app/${orgSlug}/crm`} label="CRM" />
        <PageHeader title="New item" description="Which pipeline does it go in?" />
      </div>
      {shell.pipelines.length === 0 ? (
        <EmptyState
          icon={Columns3}
          title="No pipelines yet"
          description="Add one in CRM settings."
          action={
            shell.access.manager ? (
              <Button asChild>
                <Link href={`/app/${orgSlug}/crm/settings`}>CRM settings</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shell.pipelines.map((p) => (
            <Link
              key={p.id}
              href={`${base}/${p.id}?new=1`}
              className="bg-card ring-foreground/6 rounded-card hover:bg-muted/50 flex flex-col gap-1 p-5 ring-1"
            >
              <b className="text-[15px]">New {p.itemNoun}</b>
              <span className="text-muted-foreground text-[13px]">{p.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
