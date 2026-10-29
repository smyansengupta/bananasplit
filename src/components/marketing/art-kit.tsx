import { Bell, Check, MessageCircle } from "@/components/icons";

import { CoreMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

import { IMESSAGE } from "./palette";

/*
 * The pieces every illustration is drawn with (the feature art, the
 * solutions and integrations art, onboarding's step pictures): a soft
 * backdrop and small white cards floating on it. Client-safe: nothing here
 * reads the file system (BrandMark does, so it stays in feature-art).
 */

export type ArtSize = "sm" | "md" | "lg";

const STAGE = {
  sm: "h-[176px]",
  md: "h-[230px]",
  lg: "h-[340px] sm:h-[380px]",
} as const;

/** The backdrop every illustration sits on. */
export function Stage({
  tone,
  size,
  children,
}: {
  tone: string;
  size: ArtSize;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative w-full overflow-hidden rounded-[20px]", tone, STAGE[size])}>
      {children}
    </div>
  );
}

/** A small white card floating on the backdrop. */
export function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "bg-card absolute flex items-center gap-2 rounded-[12px] px-3 py-2 text-[12px] font-semibold whitespace-nowrap shadow-[var(--elevation-1)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Texting: a phone's thread, wired to the task and the reminder it made. */
export function TextingArt({ size = "md" }: { size?: ArtSize }) {
  return (
    <Stage tone="bg-(--tag-navy)/12" size={size}>
      <div className="bg-card absolute top-7 left-[8%] flex w-[46%] max-w-[230px] flex-col gap-2 rounded-[26px] p-3.5 pb-8 shadow-[var(--elevation-2)]">
        <span className="flex items-center justify-center gap-1.5 pb-1 text-[11px] font-semibold">
          <span className="bg-muted grid size-6 place-items-center rounded-full">
            <CoreMark size={15} />
          </span>
          Bananasplit
        </span>
        <span
          className="self-end rounded-[14px] rounded-br-[5px] px-2.5 py-1.5 text-[11.5px] leading-[1.35]"
          style={{ backgroundColor: IMESSAGE.blue, color: IMESSAGE.white }}
        >
          Book the venue by Fri. Maya owns it.
        </span>
        <span className="bg-muted self-start rounded-[14px] rounded-bl-[5px] px-2.5 py-1.5 text-[11.5px]">
          Done ✓
        </span>
        <span
          className="self-end rounded-[14px] rounded-br-[5px] px-2.5 py-1.5 text-[11.5px]"
          style={{ backgroundColor: IMESSAGE.blue, color: IMESSAGE.white }}
        >
          What&apos;s due this week?
        </span>
      </div>
      <svg
        className="text-foreground/25 absolute top-[38%] left-[52%] h-16 w-[16%]"
        viewBox="0 0 100 60"
        fill="none"
        preserveAspectRatio="none"
      >
        <path
          d="M0 30 C 40 30, 50 8, 100 8 M0 30 C 40 30, 50 52, 100 52"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="5 5"
        />
      </svg>
      <Chip className="top-[24%] right-[6%]">
        <Check className="size-4 text-(--tag-forest)" strokeWidth={3} />
        Task · Book the venue
      </Chip>
      <Chip className="right-[10%] bottom-[22%]">
        <Bell className="size-4" />
        Reminder · Thu 9 AM
      </Chip>
      <span className="bg-card absolute right-[38%] bottom-4 grid size-10 place-items-center rounded-full shadow-[var(--elevation-1)]">
        <MessageCircle className="size-5" style={{ color: IMESSAGE.blue }} />
      </span>
    </Stage>
  );
}
