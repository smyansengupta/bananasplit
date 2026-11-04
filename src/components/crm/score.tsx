import { ArrowDownRight, ArrowUpRight } from "@/components/icons";

/**
 * A record's score (0 to 100) with what gave it: the learned model's top
 * reasons on an open item, else the score rules that hold. Plain markup,
 * rendered on the server.
 */
export function ScoreReasons({
  score,
  by,
  reasons,
  accuracy,
}: {
  score: number;
  by: "model" | "rules" | "none";
  reasons: { label: string; direction: "up" | "down" }[];
  accuracy: number | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="numeral text-[28px] leading-none">{score}</span>
        <span className="text-muted-foreground text-xs">
          {by === "model"
            ? `chance of winning, learned from your own items${accuracy !== null ? ` (right ${Math.round(accuracy * 100)}% of the time)` : ""}`
            : by === "rules"
              ? "of 100, from your score rules"
              : "of 100. Add score rules under Automations."}
        </span>
      </div>
      {reasons.length > 0 && (
        <ul className="space-y-1 text-sm">
          {reasons.map((r) => (
            <li key={r.label} className="flex items-center gap-2">
              {r.direction === "up" ? (
                <ArrowUpRight className="size-3.5 text-[var(--chart-2)]" aria-label="Helps" />
              ) : (
                <ArrowDownRight className="text-tint-danger-foreground size-3.5" aria-label="Hurts" />
              )}
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
