import {
  CalendarClock,
  Check,
  FileSpreadsheet,
  FileText,
  Folder,
  Inbox,
  ListChecks,
  Receipt,
  Sparkles,
  Ticket,
  Video,
} from "@/components/icons";

import { cn } from "@/lib/utils";

import { BrandMark } from "./brand-mark";
import { brandBySlug } from "./brands";
import { Chip, Stage, TextingArt, type ArtSize } from "./art-kit";

/*
 * The main features drawn as illustrations, Notion-style: a soft backdrop,
 * a big symbol and a few product fragments placed around it. Built from the
 * app's own symbols (Lucide) and tokens, so they follow light and dark.
 * Decoration: callers mark them aria-hidden. `size="lg"` is the feature
 * page's hero, the default the homepage card, `sm` an integration card.
 */

const ORBIT = [
  { icon: FileText, label: "Drafts docs", at: "top-[10%] left-[8%]" },
  { icon: ListChecks, label: "Plans tasks", at: "top-[10%] right-[8%]" },
  { icon: Inbox, label: "Reads email", at: "top-[44%] left-[3%]" },
  { icon: CalendarClock, label: "Books meetings", at: "top-[44%] right-[3%]" },
  { icon: Receipt, label: "Files receipts", at: "bottom-[9%] left-[12%]" },
  { icon: Sparkles, label: "Writes updates", at: "bottom-[9%] right-[12%]" },
] as const;

/** AI: the spark in the middle, everything it does around it, your model in the corner. */
export function AiArt({ size = "md" }: { size?: ArtSize }) {
  return (
    <Stage tone="bg-(--tag-plum)/12" size={size}>
      <span className="border-foreground/15 absolute top-1/2 left-1/2 size-[200px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed" />
      <span className="bg-card ring-card/50 absolute top-1/2 left-1/2 grid size-[78px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-[var(--elevation-2)] ring-8">
        <Sparkles className="size-9" strokeWidth={1.75} />
      </span>
      {ORBIT.map(({ icon: Icon, label, at }) => (
        <Chip key={label} className={at}>
          <Icon className="size-4" />
          {label}
        </Chip>
      ))}
    </Stage>
  );
}

const FILES = [
  { icon: FileText, name: "Contract.docx", at: "top-[22%] right-[8%] rotate-[3deg]" },
  { icon: FileSpreadsheet, name: "Budget.xlsx", at: "top-[46%] right-[14%] -rotate-[2deg]" },
  { icon: Receipt, name: "Receipt.pdf", at: "bottom-[14%] right-[6%] rotate-[2deg]" },
] as const;

/** Docs and files: a live page with a line turned into a task, beside the files it keeps. */
export function DocsArt({ size = "md" }: { size?: ArtSize }) {
  return (
    <Stage tone="bg-(--tag-forest)/12" size={size}>
      <div className="bg-card absolute top-6 left-[8%] flex w-[46%] max-w-[240px] -rotate-2 flex-col gap-2.5 rounded-[16px] p-4 shadow-[var(--elevation-2)]">
        <span className="display-title text-[15px]">Launch plan</span>
        <span className="bg-foreground/15 h-2 w-full rounded-full" />
        <span className="bg-foreground/15 h-2 w-[86%] rounded-full" />
        <span className="self-start rounded-[6px] bg-(--tag-navy)/12 px-2 py-1 text-[11px] font-semibold text-(--tag-navy)">
          → Task: send the press kit
        </span>
        <span className="bg-foreground/15 h-2 w-[70%] rounded-full" />
        <span className="bg-foreground/15 h-2 w-[80%] rounded-full" />
      </div>
      <span className="bg-card absolute top-6 right-[30%] grid size-11 place-items-center rounded-[12px] shadow-[var(--elevation-1)]">
        <Folder className="size-5" />
      </span>
      {FILES.map(({ icon: Icon, name, at }) => (
        <Chip key={name} className={at}>
          <Icon className="text-muted-foreground size-4" />
          {name}
        </Chip>
      ))}
    </Stage>
  );
}

const CALLS = ["zoom", "google-meet", "microsoft-teams"] as const;

/** Meetings and events: the date, the call it booked, and the event filling up. */
export function MeetingsArt({ size = "md" }: { size?: ArtSize }) {
  return (
    <Stage tone="bg-(--tag-burgundy)/12" size={size}>
      <div className="bg-card absolute top-7 left-[9%] flex w-[110px] flex-col items-center overflow-hidden rounded-[16px] shadow-[var(--elevation-2)]">
        <span className="bg-primary text-primary-foreground w-full py-1 text-center text-[11px] font-bold">
          THU
        </span>
        <span className="numeral py-2 text-[44px]">30</span>
        <span className="text-muted-foreground pb-2 text-[11px] font-semibold">2:00 PM</span>
      </div>
      <div className="bg-card absolute top-8 right-[7%] flex w-[52%] max-w-[250px] flex-col gap-2.5 rounded-[16px] p-3.5 shadow-[var(--elevation-2)]">
        <span className="flex items-center gap-2 text-[12px] font-semibold">
          <Video className="size-4" /> Design review
        </span>
        <span className="flex gap-1.5">
          {CALLS.map((slug, i) => (
            <span
              key={slug}
              className={cn(
                "grid flex-1 place-items-center rounded-[10px] py-1.5",
                i === 0 ? "ring-foreground bg-muted ring-2" : "bg-muted",
              )}
            >
              <BrandMark brand={brandBySlug(slug)} size={22} />
            </span>
          ))}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-(--tag-forest)">
          <Check className="size-3.5" strokeWidth={3} /> Link created · 6 invites sent
        </span>
      </div>
      <Chip className="bottom-[12%] left-[22%]">
        <Ticket className="size-4" />
        Spring showcase · 86 going
      </Chip>
    </Stage>
  );
}

const SPEND = [
  { name: "Events", pct: 72 },
  { name: "Marketing", pct: 85 },
  { name: "Food", pct: 100, over: true },
] as const;

/** Finance: the budget by category, runway, and a receipt waiting to be paid back. */
export function FinanceArt({ size = "md" }: { size?: ArtSize }) {
  return (
    <Stage tone="bg-(--tag-forest)/12" size={size}>
      <div className="bg-card absolute top-7 left-[8%] flex w-[54%] max-w-[270px] flex-col gap-2.5 rounded-[16px] p-3.5 shadow-[var(--elevation-2)]">
        <span className="flex items-baseline justify-between text-[12px] font-semibold">
          Fall budget
          <span className="text-muted-foreground text-[11px] font-medium">$5,750 of $7,000</span>
        </span>
        {SPEND.map((c) => (
          <span key={c.name} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium">{c.name}</span>
            <span className="bg-foreground/10 h-1.5 overflow-hidden rounded-full">
              <span
                className={cn(
                  "block h-full rounded-full",
                  "over" in c ? "bg-destructive" : "bg-banana",
                )}
                style={{ width: `${c.pct}%` }}
              />
            </span>
          </span>
        ))}
      </div>
      <div className="bg-card absolute top-8 right-[8%] flex w-[110px] flex-col items-center gap-1 rounded-[16px] p-3 shadow-[var(--elevation-2)]">
        <span className="text-muted-foreground text-[11px] font-semibold">Runway</span>
        <span className="numeral text-[34px] leading-none">14</span>
        <span className="text-muted-foreground text-[11px]">months</span>
      </div>
      <Chip className="right-[10%] bottom-[12%]">
        <Receipt className="size-4" />
        Receipt · $86 · to approve
      </Chip>
    </Stage>
  );
}

/** The illustration for a product page's slug (the homepage card and the page's hero). */
export { Chip, Stage, TextingArt, type ArtSize };

export function ProductArt({
  slug,
  size = "md",
}: {
  slug: "texting" | "ai" | "docs" | "meetings" | "finance";
  size?: ArtSize;
}) {
  switch (slug) {
    case "texting":
      return <TextingArt size={size} />;
    case "ai":
      return <AiArt size={size} />;
    case "docs":
      return <DocsArt size={size} />;
    case "meetings":
      return <MeetingsArt size={size} />;
    case "finance":
      return <FinanceArt size={size} />;
  }
}
