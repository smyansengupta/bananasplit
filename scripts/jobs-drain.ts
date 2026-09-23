/**
 * pnpm jobs:drain — run the background-job outbox locally.
 *
 * In development there is no Vercel Cron, so due jobs (reminders, digests,
 * site rebuilds, maintenance, and any mail an after() drain did not pick
 * up) wait until something drains them. This script does what
 * /api/cron/jobs does, from the command line, as the app_service role:
 *
 *   pnpm jobs:drain                 drain everything due once, then exit
 *   pnpm jobs:drain --watch         keep draining every 5 seconds (Ctrl+C stops)
 *   pnpm jobs:drain --kind gcal     only one kind
 *   pnpm jobs:drain --maintenance   also enqueue today's maintenance jobs first
 *
 * Mail goes to the dev sink (console and .data/mail/) unless RESEND_API_KEY
 * or EMAIL_DELIVERY says otherwise. Cache invalidation is skipped (there is
 * no Next.js cache in this process); cached loaders refresh on their own
 * revalidate interval.
 */
import "dotenv/config";

import { disconnectAll } from "@/server/db/clients";
import { drainJobs, type DrainSummary } from "@/server/jobs/drain";
import { scheduleDailyMaintenance } from "@/server/jobs/maintenance";
import { isJobKind, type JobKind } from "@/server/jobs/registry";

function parseArgs(argv: string[]) {
  const args = { watch: false, maintenance: false, kinds: [] as JobKind[] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--watch") args.watch = true;
    else if (arg === "--maintenance") args.maintenance = true;
    else if (arg === "--kind") {
      const kind = argv[++i] ?? "";
      if (!isJobKind(kind)) throw new Error(`unknown job kind: ${kind}`);
      args.kinds.push(kind);
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: pnpm jobs:drain [--watch] [--maintenance] [--kind <kind>]...");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function report(summary: DrainSummary): void {
  if (summary.refused) {
    console.log(`[jobs:drain] refused: ${summary.refused}`);
    return;
  }
  if (summary.claimed === 0) return;
  const kinds = Object.entries(summary.kinds)
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
  console.log(
    `[jobs:drain] ran ${summary.claimed}: ${summary.done} done, ${summary.retried} retry, ${summary.dead} dead, ${summary.cancelled} cancelled, ${summary.lost} lost (${kinds})`,
  );
}

async function drainUntilIdle(kinds: JobKind[]): Promise<number> {
  let total = 0;
  for (;;) {
    const summary = await drainJobs({ budgetMs: 270_000, kinds: kinds.length ? kinds : undefined });
    report(summary);
    total += summary.claimed;
    if (summary.refused || summary.claimed === 0) return total;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.maintenance) await scheduleDailyMaintenance();

  if (!args.watch) {
    const n = await drainUntilIdle(args.kinds);
    console.log(`[jobs:drain] done (${n} job${n === 1 ? "" : "s"})`);
    return;
  }

  console.log("[jobs:drain] watching for due jobs every 5s (Ctrl+C to stop)");
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  while (!stopping) {
    await drainUntilIdle(args.kinds);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

main()
  .catch((error) => {
    console.error("[jobs:drain] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectAll());
