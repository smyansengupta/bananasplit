import { ArrowRight, Check, Mail, Mic, RefreshCw, Video } from "@/components/icons";
import { CoreMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

import { BrandMark } from "./brand-mark";
import { brandBySlug, type BrandGroup } from "./brands";
import { Chip, Stage } from "./feature-art";

/*
 * One small illustration per kind of connection (the integration cards):
 * something from the other app on the left, what it became in Bananasplit
 * on the right. Decoration: callers mark them aria-hidden.
 */

/** A white card on the backdrop. */
function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "bg-card absolute flex flex-col gap-2 rounded-[14px] p-3 shadow-[var(--elevation-1)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Its app's logo and name, as a card's heading. */
function From({ slug, label }: { slug: string; label?: string }) {
  const brand = brandBySlug(slug);
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] font-semibold">
      <BrandMark brand={brand} size={18} />
      {label ?? brand.name}
    </span>
  );
}

/** Bananasplit, as a card's heading. */
function InBananasplit({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] font-semibold">
      <span className="bg-muted grid size-[18px] place-items-center rounded-[6px]">
        <CoreMark size={12} />
      </span>
      {label}
    </span>
  );
}

/** The hand-off between the two cards: an arrow, or the sync symbol. */
function Handoff({ className, sync = false }: { className?: string; sync?: boolean }) {
  const Icon = sync ? RefreshCw : ArrowRight;
  return (
    <span
      className={cn(
        "bg-card absolute top-1/2 left-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-[var(--elevation-1)]",
        className,
      )}
    >
      <Icon className="size-4" strokeWidth={2.5} />
    </span>
  );
}

const LINE = "bg-foreground/15 block h-1.5 rounded-full";

function NotesArt() {
  return (
    <Stage tone="bg-(--tag-rust)/12" size="sm">
      <Card className="top-5 left-[5%] w-[40%] -rotate-2">
        <From slug="granola" label="Granola notes" />
        <span className={cn(LINE, "w-full")} />
        <span className={cn(LINE, "w-[80%]")} />
        <span className={cn(LINE, "w-[60%]")} />
      </Card>
      <Handoff />
      <Card className="top-5 right-[5%] w-[40%] rotate-1">
        <InBananasplit label="Design review" />
        <span className={cn(LINE, "w-full")} />
        <span className="self-start rounded-[6px] bg-(--tag-navy)/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-(--tag-navy)">
          → 3 tasks
        </span>
      </Card>
      <Chip className="bottom-3 left-[8%]">
        <Mic className="size-3.5" />
        Wispr Flow · dictated 2 min
      </Chip>
    </Stage>
  );
}

const CALLS = ["zoom", "microsoft-teams", "google-meet"] as const;

function MeetingsArt() {
  return (
    <Stage tone="bg-(--tag-burgundy)/12" size="sm">
      <Card className="top-5 right-[8%] left-[8%] gap-2.5">
        <span className="flex items-center justify-between text-[12px] font-semibold">
          <span className="flex items-center gap-1.5">
            <Video className="size-4" /> Sprint planning
          </span>
          <span className="text-muted-foreground text-[11px] font-medium">Mon 10 AM</span>
        </span>
        <span className="flex gap-1.5">
          {CALLS.map((slug, i) => (
            <span
              key={slug}
              className={cn(
                "bg-muted grid flex-1 place-items-center rounded-[10px] py-1.5",
                i === 0 && "ring-foreground ring-2",
              )}
            >
              <BrandMark brand={brandBySlug(slug)} size={20} />
            </span>
          ))}
        </span>
      </Card>
      <Chip className="right-[10%] bottom-3">
        <Check className="size-3.5 text-(--tag-forest)" strokeWidth={3} />
        Zoom link added · 8 invites sent
      </Chip>
    </Stage>
  );
}

function InboxArt() {
  return (
    <Stage tone="bg-(--tag-navy)/12" size="sm">
      <Card className="top-5 left-[5%] w-[44%] -rotate-1">
        <From slug="outlook" label="Inbox" />
        <span className="flex items-start gap-1.5 text-[11px] leading-[1.35]">
          <Mail className="text-muted-foreground mt-px size-3.5 flex-none" />
          Please send the budget by Nov 3.
        </span>
      </Card>
      <Handoff className="left-[52%]" />
      <Card className="top-5 right-[5%] w-[38%] rotate-1">
        <InBananasplit label="New task" />
        <span className="text-[11.5px] font-semibold">Send the budget</span>
        <span className="text-muted-foreground text-[10.5px]">Due Nov 3 · You</span>
      </Card>
      <Chip className="bottom-3 left-[10%]">
        <BrandMark brand={brandBySlug("canvas")} size={20} />
        Canvas · essay due Fri → task
      </Chip>
    </Stage>
  );
}

const ROWS = ["Maya Chen", "Jay Patel"] as const;

/** A two-row table, for the sync drawing. */
function MiniTable({ head }: { head: React.ReactNode }) {
  return (
    <>
      {head}
      <span className="flex flex-col">
        {ROWS.map((name) => (
          <span
            key={name}
            className="border-foreground/8 flex justify-between border-t py-1 text-[10.5px]"
          >
            {name}
            <span className="bg-foreground/15 h-1.5 w-6 self-center rounded-full" />
          </span>
        ))}
      </span>
    </>
  );
}

function DataArt() {
  return (
    <Stage tone="bg-(--tag-forest)/12" size="sm">
      <Card className="top-5 left-[5%] w-[40%] gap-1.5">
        <MiniTable head={<From slug="supabase" label="members" />} />
      </Card>
      <Handoff sync />
      <Card className="top-5 right-[5%] w-[40%] gap-1.5">
        <MiniTable head={<InBananasplit label="Members" />} />
      </Card>
      <Chip className="bottom-3 left-1/2 -translate-x-1/2">
        <Check className="size-3.5 text-(--tag-forest)" strokeWidth={3} />
        Synced just now
      </Chip>
    </Stage>
  );
}

/** The illustration for an integration card's group. */
export function IntegrationArt({ group }: { group: Exclude<BrandGroup, "ai"> }) {
  switch (group) {
    case "notes":
      return <NotesArt />;
    case "meetings":
      return <MeetingsArt />;
    case "inbox":
      return <InboxArt />;
    case "data":
      return <DataArt />;
  }
}
