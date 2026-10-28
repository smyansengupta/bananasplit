import { cn } from "@/lib/utils";

const STEPS = ["Your account", "Your profile", "Your organization's workspace"] as const;

/**
 * The three steps in, under the headline on the sign-up panel: one account
 * for everyone, your profile, then your organization's workspace, on the
 * graphite panel. Numbered 22px dots: the current one
 * solid in the panel's text colour, the rest a translucent tint of it.
 */
export function JoinSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0 text-[15px] font-medium">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const here = n === current;
        return (
          <li
            key={label}
            className="flex items-center gap-2.5"
            aria-current={here ? "step" : undefined}
          >
            <span
              className={cn(
                "grid size-[22px] place-items-center rounded-full text-[11px] font-bold tabular-nums",
                here ? "bg-chrome-foreground text-chrome" : "bg-chrome-foreground/15",
              )}
            >
              {n}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
