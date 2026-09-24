import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
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
      <section className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border p-4">
        <AlertTriangle className="text-destructive size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{next.title} has stopped working.</p>
          <p className="text-muted-foreground text-sm">
            {next.title === "Club website data"
              ? "New check-ins are not arriving. The setup page says what the database returned and what to change."
              : "The last connection test failed. The setup page says what the service returned and what to change."}
          </p>
        </div>
        <Button asChild>
          <Link href={`/app/${orgSlug}/setup/status`}>
            See what failed
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </section>
    );
  }

  if (!next) return null;

  return (
    <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">
          {state.connectedCount === 0
            ? "Connect your club's accounts to fill this place up"
            : `${state.connectedCount} of ${state.totalCount} connected — next up, ${next.title.toLowerCase()}`}
        </p>
        <p className="text-muted-foreground text-sm">
          {state.connectedCount === 0
            ? `Start with ${next.title.toLowerCase()}: ${next.unlocks[0]!.toLowerCase()}. About ${next.minutes} minutes.`
            : `${next.unlocks[0]}. About ${next.minutes} minutes.`}
        </p>
      </div>
      <Button asChild>
        <Link href={href}>
          {state.connectedCount === 0 ? "Start setup" : "Continue setup"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </Button>
    </section>
  );
}
