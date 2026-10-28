import { ArrowUp, Check } from "@/components/icons";

import { cn } from "@/lib/utils";

import { BrandMark } from "./brand-mark";
import { BRANDS, brandBySlug, type BrandGroup } from "./brands";
import { IntegrationArt } from "./integration-art";
import { CLAUDE_CHAT } from "./palette";
import { CONTAINER, SectionIntro } from "./section-title";

/** The apps of one group, as logo chips. */
function Apps({ group }: { group: BrandGroup }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {BRANDS.filter((b) => b.group === group).map((b) => (
        <span
          key={b.slug}
          className="bg-card flex items-center gap-2 rounded-full py-1 pr-3.5 pl-1"
        >
          <BrandMark brand={b} size={30} />
          <span className="text-[14px] font-semibold">{b.name}</span>
        </span>
      ))}
    </div>
  );
}

const ADDED = [
  "Finalize the sponsor deck · Jay · Mon",
  "Book the venue for Nov 14 · Maya · Fri",
  "Send the press kit · Sam · Wed",
  "Schedule the volunteer briefing · Alex",
] as const;

/** A Claude chat telling Bananasplit to add the tasks it just wrote. */
function ClaudeChatSample() {
  const claude = brandBySlug("claude");
  return (
    <div
      className="flex flex-col gap-3 rounded-[20px] p-4 shadow-[var(--elevation-1)] sm:p-5"
      style={{ backgroundColor: CLAUDE_CHAT.surface, color: CLAUDE_CHAT.ink }}
    >
      <span className="flex items-center gap-2 text-[12px] font-semibold">
        <BrandMark brand={claude} size={22} />
        Claude
      </span>
      <span
        className="max-w-[85%] self-end rounded-[16px] px-3.5 py-2.5 text-[13px] leading-[1.45]"
        style={{ backgroundColor: CLAUDE_CHAT.bubble }}
      >
        Turn the launch plan into tasks and add them all to Bananasplit.
      </span>
      <div className="flex flex-col gap-2 text-[13px] leading-[1.5]">
        <span>Done. I added 4 tasks to your Fall launch project in Bananasplit:</span>
        <span
          className="flex flex-col gap-1.5 rounded-[12px] border p-3"
          style={{ borderColor: CLAUDE_CHAT.border }}
        >
          {ADDED.map((task) => (
            <span key={task} className="flex items-center gap-2 text-[12.5px]">
              <span
                className="grid size-4 flex-none place-items-center rounded-full"
                style={{ backgroundColor: CLAUDE_CHAT.accent, color: CLAUDE_CHAT.onAccent }}
              >
                <Check className="size-2.5" strokeWidth={3.5} />
              </span>
              {task}
            </span>
          ))}
        </span>
        <span style={{ color: CLAUDE_CHAT.muted }}>
          Owners and due dates are set, and each one is linked to the launch plan.
        </span>
      </div>
      <span
        className="mt-1 flex items-center justify-between rounded-[14px] border px-3.5 py-2.5 text-[12.5px]"
        style={{
          borderColor: CLAUDE_CHAT.border,
          color: CLAUDE_CHAT.muted,
          backgroundColor: CLAUDE_CHAT.input,
        }}
      >
        Reply to Claude…
        <span
          className="grid size-6 place-items-center rounded-[8px]"
          style={{ backgroundColor: CLAUDE_CHAT.accent, color: CLAUDE_CHAT.onAccent }}
        >
          <ArrowUp className="size-3.5" strokeWidth={2.5} />
        </span>
      </span>
    </div>
  );
}

/** The apps of one group as small overlapping logos (the integration cards). */
function AppMarks({ group }: { group: BrandGroup }) {
  const apps = BRANDS.filter((b) => b.group === group);
  return (
    <span className="ml-auto flex flex-none" aria-label={apps.map((b) => b.name).join(", ")}>
      {apps.map((b) => (
        <span key={b.slug} className="ring-muted -ml-1.5 rounded-[8px] ring-2 first:ml-0">
          <BrandMark brand={b} size={24} />
        </span>
      ))}
    </span>
  );
}

/** What each other kind of connection does, in a line a team can act on. */
const GROUPS: readonly { group: Exclude<BrandGroup, "ai">; title: string; body: string }[] = [
  {
    group: "notes",
    title: "Notes that file themselves",
    body: "Granola notes and Wispr Flow dictation land in your docs, filed with the right project.",
  },
  {
    group: "meetings",
    title: "Book the call in place",
    body: "Make a Zoom, Teams or Meet call from any event. Invites go out for you.",
  },
  {
    group: "inbox",
    title: "Your inbox, turned into tasks",
    body: "Email, invites and Canvas assignments become tasks with due dates.",
  },
  {
    group: "data",
    title: "Your database, in sync",
    body: "Your Supabase tables stay in sync with Bananasplit's databases.",
  },
];

/**
 * "Works with the apps you already use.": the one integrations section
 * (SaaS homepage report, section order 8). Your AI first and large, with a
 * Claude chat adding tasks to Bananasplit, then what each other kind of
 * connection does, in a compact card: a drawing of it at work, then its
 * line and its apps' logos.
 */
export function Integrations() {
  return (
    <section
      id="integrations"
      className={cn(CONTAINER, "flex scroll-mt-20 flex-col gap-12 pt-28 sm:gap-14 sm:pt-36")}
    >
      <SectionIntro title="Works with the apps you already use.">
        Keep the tools your team loves. Bananasplit plugs into them, and the work they create shows
        up where everyone can see it.
      </SectionIntro>
      <div className="bg-muted/70 rounded-card grid items-center gap-8 p-7 sm:p-10 lg:grid-cols-2 lg:gap-12">
        <div className="flex flex-col gap-5">
          <Apps group="ai" />
          <h3 className="display-title text-[clamp(28px,3vw,40px)] leading-[1.08] tracking-[-0.03em] text-balance">
            Ask your AI. It&apos;s in Bananasplit.
          </h3>
          <p className="text-foreground/75 max-w-[460px] text-[16px] leading-[1.6] text-pretty">
            Tell Claude or ChatGPT to &ldquo;add these to Bananasplit&rdquo; and the tasks, events
            and docs appear in your workspace, with owners and dates already set.
          </p>
        </div>
        <div aria-hidden="true">
          <ClaudeChatSample />
        </div>
      </div>
      <ul className="m-0 grid list-none gap-4 p-0 max-md:-mx-6 max-md:flex max-md:snap-x max-md:snap-mandatory max-md:scroll-px-6 max-md:[scrollbar-width:none] max-md:overflow-x-auto max-md:px-6 max-md:pb-2 md:grid-cols-2">
        {GROUPS.map(({ group, title, body }) => (
          <li
            key={group}
            className="bg-muted/70 rounded-card flex flex-col gap-4 p-5 max-md:w-[86%] max-md:flex-none max-md:snap-start sm:p-6"
          >
            <div aria-hidden="true">
              <IntegrationArt group={group} />
            </div>
            <div className="flex flex-col gap-1.5 px-1">
              <span className="flex items-center gap-2.5">
                <h3 className="text-[19px] leading-[1.25] font-semibold tracking-[-0.015em]">
                  {title}
                </h3>
                <AppMarks group={group} />
              </span>
              <p className="text-foreground/75 text-[15px] leading-[1.5]">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
