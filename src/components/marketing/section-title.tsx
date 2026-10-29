import { cn } from "@/lib/utils";

/** The page's column: 1200px with a 24px gutter, as every section uses. */
export const CONTAINER = "mx-auto w-full max-w-[1200px] px-6";

/** A section's headline: the display face, 36 to 64px, set tight. */
export function SectionTitle({
  children,
  className,
  as: Tag = "h2",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <Tag
      className={cn(
        "display-title text-[clamp(36px,5vw,64px)] leading-[1.02] tracking-[-0.04em]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * A section's opening: a small label, the headline and a line of
 * description, centred (Notion's sections) or on the left.
 */
export function SectionIntro({
  label,
  title,
  children,
  align = "center",
  className,
}: {
  label?: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "mx-auto max-w-[760px] items-center text-center" : "max-w-[640px]",
        className,
      )}
    >
      {label && <span className="text-foreground/70 text-[14px] font-semibold">{label}</span>}
      <SectionTitle className="text-balance">{title}</SectionTitle>
      {children && (
        <p className="text-foreground/80 max-w-[620px] text-[17px] leading-[1.55] text-pretty sm:text-[18px]">
          {children}
        </p>
      )}
    </div>
  );
}
