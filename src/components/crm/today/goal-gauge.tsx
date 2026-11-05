import type { CSSProperties } from "react";

import { Check } from "@/components/icons";
import { Gauge } from "@/components/ui/meters";
import { goalStanding } from "@/lib/crm/goal-pace";

/**
 * A goal as a ring: how far it's come, a notch for where it should be by
 * now, the share in the middle. Hit, the ring fills in the success colour
 * around a filled check, with a few sparks the moment it's first seen
 * (none under reduced motion). Behind is the attention colour, nothing louder.
 */
export function GoalGauge({
  share,
  pace,
  onTrack,
  size,
  label,
}: {
  share: number;
  /** Where it should be by now, 0 to 1. */
  pace: number;
  onTrack: boolean;
  size: number;
  /** For screen readers: "$12,400 of $25,000". */
  label: string;
}) {
  const standing = goalStanding({ share, pace, onTrack });
  const won = standing === "won";
  const percent = Math.min(999, Math.round(share * 100));
  return (
    <div className="relative shrink-0" data-standing={standing}>
      <Gauge
        value={percent}
        size={size}
        stroke={14}
        tone={won ? "success" : standing === "behind" ? "attention" : "ink"}
        mark={won ? undefined : pace * 100}
        label={label}
      >
        {won ? (
          <span
            className="goal-pop bg-success text-success-foreground grid place-items-center rounded-full"
            style={{ width: size * 0.46, height: size * 0.46 }}
          >
            <Check aria-hidden="true" style={{ width: size * 0.26, height: size * 0.26 }} />
          </span>
        ) : (
          <b className="numeral" style={{ fontSize: Math.round(size * 0.23) }}>
            {percent}%
          </b>
        )}
      </Gauge>
      {won && <Sparks reach={size * 0.62} />}
    </div>
  );
}

function Sparks({ reach }: { reach: number }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      {Array.from({ length: 8 }, (_, i) => (
        <i
          key={i}
          className="goal-spark absolute top-1/2 left-1/2 -ms-[3px] -mt-[3px] size-1.5 rounded-full"
          style={
            {
              "--spark-angle": `${i * 45 + 20}deg`,
              "--spark-reach": `${reach}px`,
              background: i % 2 ? "var(--success)" : "var(--glow)",
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
