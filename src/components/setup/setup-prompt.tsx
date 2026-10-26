import { AlertTriangle, ArrowRight, Plug } from "@/components/icons";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { setupStep } from "@/server/setup/catalog";
import type { SetupState } from "@/server/setup/progress";

/**
 * The prompt on the org overview, for owners and admins while the club has
 * connections left to make.
 *
 * It names the next concrete thing and what it is worth, rather than
 * nagging with a percentage. A broken connection outranks an unmade one:
 * a sync that has been failing all week is the more urgent sentence.
 *
 * It disappears once setup is finished or dismissed (OrgSettings
 * .setupCompletedAt), and comes back on its own if a connection breaks.
 */
export function SetupPrompt({ orgSlug, state }: { orgSlug: string; state: SetupState }) {
  const broken = state.attention.length > 0;
  if (!broken && !state.promptVisible) return null;

  const next = state.nextStep ? setupStep(state.nextStep) : null;
  const href = `/app/${orgSlug}/setup${next ? `?step=${next.id}` : ""}`;

  if (broken && next) {
    return (
      <section className="rounded-card bg-tint-danger text-tint-danger-foreground flex flex-wrap items-center gap-x-5 gap-y-3 p-5 sm:p-6">
        <span className="bg-card text-destructive grid size-9 shrink-0 place-items-center rounded-full">
          <AlertTriangle className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-[1_1_15rem] space-y-0.5">
          <p className="heading text-[15px]">{next.title} has stopped working.</p>
          <p className="text-sm">
            {next.title === "Club website data"
              ? "New check-ins are not arriving. The setup page says what the database returned and what to change."
              : "The last connection test failed. The setup page says what the service returned and what to change."}
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="bg-card">
          <Link href={`/app/${orgSlug}/setup/status`}>
            See what failed
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      </section>
    );
  }

  if (!next) return null;

  return (
    <Card className="flex-row flex-wrap items-center gap-x-5 gap-y-3 px-5 py-5 sm:px-6">
      {/* IconChip (sm), drawn here: this renders on the server, and IconChip is a client component. */}
      <span className="bg-card ring-foreground/6 grid size-9 shrink-0 place-items-center rounded-full shadow-[var(--edge-highlight)] ring-1">
        <Plug className="size-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-[1_1_15rem] space-y-0.5">
        <p className="heading text-[15px]">
          {state.connectedCount === 0
            ? "Connect your club's accounts to fill this place up"
            : `${state.connectedCount} of ${state.totalCount} connected. Next up, ${next.title.toLowerCase()}`}
        </p>
        <p className="text-muted-foreground text-sm">
          {state.connectedCount === 0
            ? `Start with ${next.title.toLowerCase()}: ${next.unlocks[0]!.toLowerCase()}. About ${next.minutes} minutes.`
            : `${next.unlocks[0]}. About ${next.minutes} minutes.`}
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href={href}>
          {state.connectedCount === 0 ? "Connect tools" : "Keep connecting"}
          <ArrowRight data-icon="inline-end" aria-hidden="true" />
        </Link>
      </Button>
    </Card>
  );
}
