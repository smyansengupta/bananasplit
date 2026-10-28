"use client";

import { Check } from "@/components/icons";
import { useRef } from "react";

import { cn } from "@/lib/utils";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Three seeds pop out of the circle in the glow colour (the banana's three
 * seeds), 520ms, then go. Nothing under reduced motion.
 */
function popSeeds(host: HTMLElement) {
  if (reducedMotion() || typeof host.animate !== "function") return;
  for (let k = 0; k < 3; k++) {
    const seed = document.createElement("span");
    const angle = ((-90 + k * 120 + 20) * Math.PI) / 180;
    seed.setAttribute("aria-hidden", "true");
    seed.className = "bg-glow pointer-events-none absolute top-1/2 left-1/2 rounded-full";
    seed.style.cssText = "width:5px;height:10px;margin:-5px 0 0 -2.5px";
    host.appendChild(seed);
    const animation = seed.animate(
      [
        { transform: `translate(0,0) rotate(${k * 120}deg) scale(.4)`, opacity: 1 },
        {
          transform: `translate(${Math.cos(angle) * 24}px,${Math.sin(angle) * 24}px) rotate(${k * 120}deg) scale(1)`,
          opacity: 0,
        },
      ],
      { duration: 520, easing: "cubic-bezier(.2,.75,.15,1)" },
    );
    animation.onfinish = () => seed.remove();
  }
}

/**
 * The task checkbox (Moonstone 7.10): a 22px circle that fills with the
 * goal block's colour and springs a little when done, with the seed pop.
 * Form checkboxes stay rounded squares (ui/checkbox); this one is for tasks.
 */
export function TaskCheck({
  done,
  onToggle,
  disabled,
  label,
  className,
  size = 22,
}: {
  done: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** "Complete Book the room" / "Reopen Book the room". */
  label: string;
  className?: string;
  size?: 18 | 22;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!done && ref.current) popSeeds(ref.current);
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{ width: size, height: size }}
      className={cn(
        "group/check relative grid shrink-0 place-items-center rounded-full border-[1.5px] transition-[background-color,border-color,transform] duration-200 outline-none",
        "focus-visible:outline-foreground ease-(--ease-spring) focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none",
        "disabled:cursor-default disabled:opacity-60",
        done
          ? "bg-block-goal border-block-goal text-block-goal-foreground scale-[1.08]"
          : "border-muted-foreground hover:border-foreground hover:text-muted-foreground text-transparent",
        className,
      )}
    >
      <Check
        className={cn(size === 22 ? "size-[13px]" : "size-[11px]")}
        strokeWidth={2.6}
        aria-hidden="true"
      />
    </button>
  );
}
