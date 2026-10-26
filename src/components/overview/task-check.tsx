"use client";

import { Check } from "@/components/icons";
import { useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The 22px circle check (redesign guide 16): it fills with the goal block
 * colour, bounces on the spring and pops a few seeds when a task is done.
 * Under reduced motion it just fills.
 */
export function TaskCheck({
  checked,
  onCheck,
  label,
  disabled,
}: {
  checked: boolean;
  onCheck: () => void;
  label: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  function celebrate() {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.28)" }, { transform: "scale(1.08)" }],
      { duration: 360, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
    );
    for (let i = 0; i < 6; i++) {
      const seed = document.createElement("span");
      seed.setAttribute("aria-hidden", "true");
      seed.className = "pointer-events-none absolute top-1/2 left-1/2 size-1.5 rounded-full bg-block-goal";
      el.appendChild(seed);
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const d = 18;
      seed
        .animate(
          [
            { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
            {
              transform: `translate(calc(-50% + ${Math.cos(angle) * d}px), calc(-50% + ${Math.sin(angle) * d}px)) scale(0.4)`,
              opacity: 0,
            },
          ],
          { duration: 520, easing: "cubic-bezier(0.2, 0.75, 0.15, 1)" },
        )
        .finished.finally(() => seed.remove());
    }
  }

  return (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (checked) return;
        celebrate();
        onCheck();
      }}
      className={cn(
        "relative z-10 grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] transition-[background-color,border-color,color] duration-200",
        "focus-visible:outline-foreground focus-visible:outline-2 focus-visible:outline-offset-2",
        checked
          ? "bg-block-goal border-block-goal text-block-goal-foreground scale-[1.08]"
          : "border-muted-foreground hover:border-foreground hover:text-muted-foreground text-transparent",
      )}
    >
      <Check className="size-[13px]" strokeWidth={2.6} aria-hidden="true" />
    </button>
  );
}
