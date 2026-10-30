import "@/app/e/rsvp.css";

import type { RsvpCover } from "@/lib/rsvp/cover";
import { resolveRsvpBackground } from "@/lib/rsvp/backgrounds";
import { cn } from "@/lib/utils";

/** A small picture of the public page: its glow, cover and title. */
export function PagePreview({
  cover,
  background,
  title,
  className,
}: {
  cover: RsvpCover | null;
  background: string;
  title: string;
  className?: string;
}) {
  const resolved = resolveRsvpBackground(background, Boolean(cover));
  const bg = resolved.id;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rsvp-page rsvp-preview rounded-tile relative isolate flex aspect-[4/3] w-full flex-col gap-2 overflow-hidden border p-3",
        `rsvp-glow-${bg}`,
        className,
      )}
    >
      {bg === "cover" && cover && (
        // eslint-disable-next-line @next/next/no-img-element -- a stored WebP variant
        <img
          src={cover.s480}
          alt=""
          className="absolute inset-x-0 top-0 -z-10 h-2/3 w-full scale-125 [mask-image:linear-gradient(var(--foreground),transparent)] object-cover opacity-40 blur-xl"
        />
      )}
      <div className="flex gap-2.5">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored WebP variant
          <img
            src={cover.s480}
            alt=""
            className="size-14 flex-none rounded-[10px] object-cover shadow-sm"
          />
        ) : (
          <span className="bg-card font-heading text-foreground grid size-14 flex-none place-items-center rounded-[10px] text-2xl">
            {title.trim()[0]?.toUpperCase() ?? "B"}
          </span>
        )}
        <span className="font-heading text-[15px] leading-tight break-words">{title}</span>
      </div>
      <span className="bg-card mt-auto h-9 rounded-[12px] shadow-sm" />
    </div>
  );
}
