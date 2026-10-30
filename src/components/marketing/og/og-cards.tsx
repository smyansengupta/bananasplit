import type { ReactNode } from "react";

import { CoreMark, Logo } from "@/components/brand/logo";
import { Sparkles, UserPlus, type IconComponent } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * The link-preview cards (iMessage, Slack, X, WhatsApp): a 1200x630
 * drawing for each page worth its own picture (every other link shows the
 * main card, src/app/opengraph-image.png), rendered at /dev/og/<card> and screenshotted by
 * scripts/capture-og.mjs into the files scripts/og-cards.json lists. /dev/og
 * shows every card the way Messages draws a link.
 *
 * They are committed PNGs, not next/og routes, deliberately: a preview is
 * fetched by a crawler, not a person, so a static file on the CDN costs
 * nothing per unfurl where a generated image costs a function call every
 * time. Anything that has to say a club's own name does it in the page's
 * metadata instead (src/lib/metadata/share.ts), with the logo the club
 * already uploaded.
 *
 * One system: the same white card, lockup, Bricolage headline and Hanken
 * line on every card, and one picture each that says what the link opens.
 * Fixed colours throughout, never the theme's tokens: these render once, in
 * light, and must not change when a club picks a palette.
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const INK = "#0a0a0a";
const MUTED = "#5c5c58";
const FAINT = "#9a9a94";
const HAIRLINE = "rgba(10,10,10,0.10)";
const PANEL = "#FAFAF8";
const WELL = "#F2F2F0";
const BANANA = "#F2C230";
const BANANA_INK = "#1c1810";
const TINT = "#FDF6E0";
const TINT_EDGE = "rgba(242,194,48,0.55)";
const BUBBLE = "#F0F0EF";
const GREEN = "#2F7D4F";
const GREEN_TINT = "#E5F2EA";
const BLUE = "#2D5FA8";
const BLUE_TINT = "#E6EEF8";

/* ------------------------------------------------------------ the frame */

/** The white card every drawing sits on, at exactly the OG size. */
function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("flex overflow-hidden bg-white", className)}
      style={{ width: OG_WIDTH, height: OG_HEIGHT, color: INK }}
    >
      {children}
    </div>
  );
}

function Mark() {
  return <Logo size={38} textSize={38} />;
}

/** The display line. Breaks are the drawing's own, never text-balance. */
function Headline({ size, children }: { size: number; children: ReactNode }) {
  return (
    <p
      className="display-title m-0"
      style={{ fontSize: size, lineHeight: 0.98, letterSpacing: "-0.045em", textWrap: "nowrap" }}
    >
      {children}
    </p>
  );
}

function Line({
  children,
  width,
  size = 25,
}: {
  children: ReactNode;
  width?: number;
  size?: number;
}) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: size,
        lineHeight: 1.45,
        color: MUTED,
        maxWidth: width,
        textWrap: "pretty",
      }}
    >
      {children}
    </p>
  );
}

/** Words on the left, the picture in a panel on the right. */
function Split({
  headline,
  line,
  children,
  bare = false,
}: {
  headline: ReactNode;
  line: string;
  children: ReactNode;
  /** The picture without the panel behind it (the text thread). */
  bare?: boolean;
}) {
  return (
    <Frame className="items-center gap-[52px] px-[68px]">
      <div className="flex w-[500px] flex-none flex-col gap-[26px]">
        <Mark />
        <Headline size={64}>{headline}</Headline>
        <Line width={480}>{line}</Line>
      </div>
      <div
        className="flex h-[500px] flex-1 flex-col justify-center overflow-hidden"
        style={
          bare
            ? undefined
            : {
                background: PANEL,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 30,
                padding: 30,
              }
        }
      >
        {children}
      </div>
    </Frame>
  );
}

/** The lockup, the headline and a line, centred, with an optional picture under them. */
function Centred({
  headline,
  line,
  children,
  above,
}: {
  headline: ReactNode;
  line: string;
  children?: ReactNode;
  /** A picture above the headline in place of the lockup's usual spot. */
  above?: ReactNode;
}) {
  return (
    <Frame className="flex-col items-center justify-center gap-[26px] px-[80px] text-center">
      {above ?? <Mark />}
      <Headline size={76}>{headline}</Headline>
      <Line width={760} size={28}>
        {line}
      </Line>
      {children}
    </Frame>
  );
}

/** The lockup, a headline and a line on the left, with a picture under them. */
function Stacked({
  headline,
  line,
  children,
}: {
  headline: ReactNode;
  line: string;
  children?: ReactNode;
}) {
  return (
    <Frame className="flex-col justify-center gap-[28px] px-[80px]">
      <Mark />
      <Headline size={70}>{headline}</Headline>
      <Line width={620}>{line}</Line>
      {children}
    </Frame>
  );
}

/* ---------------------------------------------------------- small parts */

/** A large icon on a banana-tinted tile: what an account page is for. */
function IconTile({ icon: Icon }: { icon: IconComponent }) {
  return (
    <span
      className="grid place-items-center"
      style={{
        width: 132,
        height: 132,
        borderRadius: 36,
        background: TINT,
        border: `1px solid ${TINT_EDGE}`,
        color: BANANA_INK,
      }}
    >
      <Icon size={62} strokeWidth={1.75} />
    </span>
  );
}

/** The mark alone on its tile, for the cards that are about the account. */
function MarkTile() {
  return (
    <span
      className="grid place-items-center"
      style={{
        width: 132,
        height: 132,
        borderRadius: 36,
        background: TINT,
        border: `1px solid ${TINT_EDGE}`,
      }}
    >
      <CoreMark size={84} />
    </span>
  );
}

function Pill({
  children,
  tone = "plain",
  size = 21,
}: {
  children: ReactNode;
  tone?: "plain" | "banana" | "green" | "blue" | "muted";
  size?: number;
}) {
  const tones = {
    plain: { background: "#FFFFFF", color: MUTED, border: `1px solid ${HAIRLINE}` },
    banana: { background: BANANA, color: BANANA_INK, border: `1px solid ${BANANA}` },
    green: { background: GREEN_TINT, color: GREEN, border: `1px solid ${GREEN_TINT}` },
    blue: { background: BLUE_TINT, color: BLUE, border: `1px solid ${BLUE_TINT}` },
    muted: { background: WELL, color: MUTED, border: `1px solid ${WELL}` },
  } as const;
  return (
    <span
      className="inline-flex flex-none items-center rounded-full"
      style={{ ...tones[tone], fontSize: size, padding: "8px 18px", fontWeight: 500 }}
    >
      {children}
    </span>
  );
}

/** A small round check, done or not. */
function Check({ done }: { done: boolean }) {
  return (
    <span
      className="grid flex-none place-items-center rounded-full"
      style={{
        width: 30,
        height: 30,
        background: done ? GREEN : "#FFFFFF",
        border: `2px solid ${done ? GREEN : "#CFCFCA"}`,
      }}
    >
      {done && (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

/** Someone's initials in a circle. */
function Face({
  initials,
  tone = "#E8E2D2",
  size = 44,
}: {
  initials: string;
  tone?: string;
  size?: number;
}) {
  return (
    <span
      className="grid flex-none place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: tone,
        color: BANANA_INK,
        fontSize: size * 0.4,
        fontWeight: 600,
      }}
    >
      {initials}
    </span>
  );
}

/** A grey bar standing in for a line of text. */
function Bar({
  width,
  tone = "#E4E4E0",
  height = 14,
}: {
  width: number | string;
  tone?: string;
  height?: number;
}) {
  return <span className="block rounded-full" style={{ width, height, background: tone }} />;
}

/** The panel's own small heading. */
function PanelTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <span className="flex items-center justify-between pb-[16px]">
      <span style={{ fontSize: 24, fontWeight: 600 }}>{children}</span>
      {aside}
    </span>
  );
}

/** A white row inside a panel. */
function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn("flex items-center gap-[14px] rounded-[16px] bg-white px-[18px]", className)}
      style={{ border: `1px solid ${HAIRLINE}`, height: 66, fontSize: 21 }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- pictures */

/** A text thread, the way the home page's phone shows one. */
function Thread({ messages }: { messages: readonly { from: "them" | "you"; text: string }[] }) {
  return (
    <span className="flex flex-col gap-[10px]">
      {messages.map((message) => (
        <span
          key={message.text}
          style={{
            alignSelf: message.from === "you" ? "flex-end" : "flex-start",
            background: message.from === "you" ? BANANA : BUBBLE,
            color: BANANA_INK,
            borderRadius: 26,
            borderBottomRightRadius: message.from === "you" ? 9 : 26,
            borderBottomLeftRadius: message.from === "you" ? 26 : 9,
            padding: "14px 22px",
            fontSize: 22,
            lineHeight: 1.33,
            maxWidth: "88%",
          }}
        >
          {message.text}
        </span>
      ))}
    </span>
  );
}

function DocPage({ title = "Spring kickoff plan" }: { title?: string }) {
  return (
    <span
      className="flex h-full flex-col gap-[16px] rounded-[20px] bg-white p-[30px]"
      style={{ border: `1px solid ${HAIRLINE}` }}
    >
      <span style={{ fontSize: 30, fontWeight: 650, letterSpacing: "-0.02em" }}>{title}</span>
      <span className="flex items-center gap-[10px]">
        <Face initials="MR" size={30} />
        <Face initials="JL" size={30} tone="#DCE7F5" />
        <span style={{ fontSize: 18, color: FAINT }}>Editing now</span>
      </span>
      <Bar width="92%" />
      <Bar width="84%" />
      <span
        className="flex items-center gap-[12px] rounded-[12px] px-[14px] py-[10px]"
        style={{ background: TINT, border: `1px solid ${TINT_EDGE}`, fontSize: 20 }}
      >
        <Check done={false} />
        Reserve the hall for March 12
        <span style={{ marginLeft: "auto", color: MUTED, fontSize: 17 }}>Task</span>
      </span>
      <Bar width="88%" />
      <Bar width="70%" />
      <Bar width="78%" />
    </span>
  );
}

function MeetingNotes() {
  return (
    <span className="flex flex-col gap-[12px]">
      <PanelTitle aside={<Pill tone="blue">Join Zoom</Pill>}>Weekly sync</PanelTitle>
      <span style={{ fontSize: 19, color: MUTED, marginTop: -8 }}>Thursday, 6:00 PM, 8 going</span>
      <span
        className="flex flex-col gap-[10px] rounded-[16px] bg-white p-[20px]"
        style={{ border: `1px solid ${HAIRLINE}` }}
      >
        <span style={{ fontSize: 18, fontWeight: 600, color: MUTED }}>Agenda</span>
        <span style={{ fontSize: 21 }}>1. Kickoff budget</span>
        <span style={{ fontSize: 21 }}>2. Sponsor outreach</span>
        <span style={{ fontSize: 21 }}>3. Volunteers for check-in</span>
      </span>
      <span
        className="flex flex-col gap-[10px] rounded-[16px] p-[20px]"
        style={{ background: TINT, border: `1px solid ${TINT_EDGE}` }}
      >
        <span style={{ fontSize: 18, fontWeight: 600, color: MUTED }}>Action items</span>
        <span className="flex items-center gap-[12px]" style={{ fontSize: 21 }}>
          <Check done={false} /> Maya emails three sponsors
        </span>
        <span className="flex items-center gap-[12px]" style={{ fontSize: 21 }}>
          <Check done={false} /> Jay finalizes the budget
        </span>
      </span>
    </span>
  );
}

function Budget() {
  const categories = [
    { name: "Food", spent: "$1,240", share: 0.62 },
    { name: "Venue", spent: "$380", share: 0.3 },
    { name: "Merch", spent: "$180", share: 0.18 },
  ];
  return (
    <span className="flex flex-col gap-[14px]">
      <PanelTitle aside={<Pill tone="green">On track</Pill>}>Spring budget</PanelTitle>
      <span className="flex items-baseline gap-[12px]">
        <span className="display-title" style={{ fontSize: 54, letterSpacing: "-0.04em" }}>
          $4,200
        </span>
        <span style={{ fontSize: 21, color: MUTED }}>left of $6,000</span>
      </span>
      <span className="block rounded-full" style={{ height: 16, background: "#E8E8E4" }}>
        <span className="block h-full rounded-full" style={{ width: "30%", background: BANANA }} />
      </span>
      {categories.map((category) => (
        <span key={category.name} className="flex items-center gap-[14px]" style={{ fontSize: 21 }}>
          <span style={{ width: 90 }}>{category.name}</span>
          <span className="block flex-1 rounded-full" style={{ height: 10, background: "#ECECE8" }}>
            <span
              className="block h-full rounded-full"
              style={{ width: `${category.share * 100}%`, background: "#C9C2AE" }}
            />
          </span>
          <span style={{ width: 90, textAlign: "right", color: MUTED }}>{category.spent}</span>
        </span>
      ))}
      <Row className="mt-[6px]">
        <Check done />
        <span className="flex-1">Venue receipt filed</span>
        <span style={{ color: MUTED }}>$86</span>
      </Row>
    </span>
  );
}

function AiProposal() {
  return (
    <span className="flex flex-col gap-[14px]">
      <span
        className="self-end rounded-[22px] px-[20px] py-[12px]"
        style={{ background: BANANA, color: BANANA_INK, fontSize: 21, borderBottomRightRadius: 8 }}
      >
        Turn the kickoff plan into tasks
      </span>
      <span
        className="flex flex-col gap-[10px] rounded-[20px] bg-white p-[20px]"
        style={{ border: `1px solid ${HAIRLINE}` }}
      >
        <span className="flex items-center gap-[10px]" style={{ fontSize: 19, color: MUTED }}>
          <Sparkles size={22} /> Nothing changes until you approve
        </span>
        {["Reserve the hall", "Order food for 40", "Email three sponsors"].map((task) => (
          <span key={task} className="flex items-center gap-[12px]" style={{ fontSize: 21 }}>
            <Check done={false} />
            {task}
          </span>
        ))}
        <span className="flex gap-[10px] pt-[6px]">
          <Pill tone="banana" size={19}>
            Approve all
          </Pill>
          <Pill size={19}>Edit</Pill>
        </span>
      </span>
    </span>
  );
}

/** Times to pick for the demo. */
function DemoSlots() {
  return (
    <span className="flex flex-col gap-[14px]">
      <PanelTitle aside={<Pill tone="muted">15 min</Pill>}>Pick a time</PanelTitle>
      <span style={{ fontSize: 20, color: MUTED, marginTop: -8 }}>Tuesday, March 4</span>
      {["10:00 AM", "10:30 AM", "11:00 AM", "1:30 PM"].map((time, index) => (
        <span
          key={time}
          className="flex items-center justify-center rounded-[16px]"
          style={{
            height: 64,
            fontSize: 22,
            fontWeight: 600,
            background: index === 1 ? BANANA : "#FFFFFF",
            color: BANANA_INK,
            border: `1px solid ${index === 1 ? BANANA : HAIRLINE}`,
          }}
        >
          {time}
        </span>
      ))}
    </span>
  );
}

/** A plan's tile on the pricing card. */
function Plan({ name, price, highlight }: { name: string; price: string; highlight?: boolean }) {
  return (
    <span
      className="flex flex-1 flex-col gap-[6px] rounded-[18px] px-[26px] py-[22px]"
      style={{
        background: highlight ? TINT : "#FAFAFA",
        border: `1px solid ${highlight ? TINT_EDGE : HAIRLINE}`,
      }}
    >
      <span style={{ fontSize: 21, fontWeight: 600 }}>{name}</span>
      <span style={{ fontSize: 19, color: MUTED }}>{price}</span>
    </span>
  );
}

/** The eight boxes of a join code, the way the join form draws them. */
function CodeBox({ character }: { character: string }) {
  return (
    <span
      className="grid place-items-center rounded-[14px] font-mono"
      style={{
        width: 72,
        height: 86,
        border: `1px solid ${HAIRLINE}`,
        background: "#FAFAFA",
        fontSize: 38,
      }}
    >
      {character}
    </span>
  );
}

/** A week of a poll, a few cells marked. */
function PollGrid() {
  const marked = new Set(["1-1", "1-2", "2-0", "2-1", "3-2", "3-3", "4-1"]);
  return (
    <span className="flex gap-[12px] pt-[16px]">
      {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, column) => (
        <span key={day} className="flex flex-col items-center gap-[10px]">
          <span style={{ fontSize: 19, color: MUTED }}>{day}</span>
          {[0, 1, 2, 3].map((row) => (
            <span
              key={row}
              className="rounded-[10px]"
              style={{
                width: 86,
                height: 34,
                background: marked.has(`${column}-${row}`) ? BANANA : "#F4F4F3",
              }}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

/* ---------------------------------------------------------------- cards */

const HOME_THREAD = [
  { from: "them", text: "Design review at 2, and the Acme proposal is due Friday." },
  { from: "you", text: "Move standup to 10 and tell the team" },
  { from: "them", text: "Done. 6 people notified." },
  { from: "them", text: "Jay sent an $86 receipt for the venue. Approve?" },
  { from: "you", text: "Yes" },
  { from: "them", text: "Approved. He'll be paid back Friday." },
] as const;

const TEXTING_THREAD = [
  { from: "you", text: "Remind everyone about Thursday at 6" },
  { from: "them", text: "Done. 24 people get it Wednesday at noon." },
  { from: "you", text: "What's due this week?" },
  { from: "them", text: "The sponsor deck (Maya), the pizza order (you) and flyers (Jay)." },
] as const;

/** Every card by the name /dev/og/<card> and scripts/og-cards.json use. */
export const OG_CARDS: Record<string, ReactNode> = {
  /* The site. */
  home: (
    <Split
      headline={
        <>
          The workspace
          <br />
          that runs itself.
        </>
      }
      line="It handles the busywork and texts you only when something needs you."
      bare
    >
      <Thread messages={HOME_THREAD} />
    </Split>
  ),
  pricing: (
    <Stacked
      headline={
        <>
          Fourteen days of
          <br />
          everything, free.
        </>
      }
      line="No card. Free holds up to ten members, and student organizations pay a flat yearly price."
    >
      <span className="flex w-full gap-[18px] pt-[14px]">
        <Plan name="Free" price="Up to 10 members" />
        <Plan name="Team" price="Finance and iMessage" highlight />
        <Plan name="Team Advanced" price="Reports and AI" />
      </span>
    </Stacked>
  ),
  demo: (
    <Split
      headline={
        <>
          Fifteen minutes,
          <br />
          set up for you.
        </>
      }
      line="A walkthrough of Bananasplit with your own club's calendar, budget and people in it."
    >
      <DemoSlots />
    </Split>
  ),
  "product-texting": (
    <Split
      headline={
        <>
          Your workspace,
          <br />
          one text away.
        </>
      }
      line="Text it from iMessage. It files the task, sends the reminder and answers what's due."
      bare
    >
      <Thread messages={TEXTING_THREAD} />
    </Split>
  ),
  "product-ai": (
    <Split
      headline={
        <>
          AI that does
          <br />
          the busywork.
        </>
      }
      line="It drafts the doc, breaks the plan into tasks and writes the weekly update. You say yes."
    >
      <AiProposal />
    </Split>
  ),
  "product-docs": (
    <Split
      headline={
        <>
          Docs that turn
          <br />
          into work.
        </>
      }
      line="Write together in real time and turn any line into a task, right where you wrote it."
    >
      <DocPage />
    </Split>
  ),
  "product-meetings": (
    <Split
      headline={
        <>
          Meetings, without
          <br />
          the busywork.
        </>
      }
      line="The call link, the agenda and the action items, and events that RSVP themselves."
    >
      <MeetingNotes />
    </Split>
  ),
  "product-finance": (
    <Split
      headline={
        <>
          Finance,
          <br />
          handled.
        </>
      }
      line="Budgets by category, receipts that file themselves, and paybacks your team can request."
    >
      <Budget />
    </Split>
  ),

  /* Signing in and up. */
  "sign-in": (
    <Centred
      above={<MarkTile />}
      headline="Welcome back."
      line="Log in to your workspace on Bananasplit."
    />
  ),
  "sign-up": (
    <Centred
      above={<IconTile icon={UserPlus} />}
      headline="Start your workspace."
      line="Fourteen days of everything, free, no card. Bring your team when you're ready."
    />
  ),

  /* A club's own links, when the club has no logo to show instead. */
  invite: (
    <Centred
      headline="You're invited."
      line="Open the link to join your club's workspace on Bananasplit."
    />
  ),
  join: (
    <Centred headline="Join your club." line="Enter the code whoever invited you sent.">
      <span className="flex items-center gap-[10px] pt-[16px]">
        {"RPKA".split("").map((character, index) => (
          <CodeBox key={`a${index}`} character={character} />
        ))}
        <span style={{ width: 22, height: 2, background: HAIRLINE, margin: "0 6px" }} />
        {"YWSF".split("").map((character, index) => (
          <CodeBox key={`b${index}`} character={character} />
        ))}
      </span>
    </Centred>
  ),
  poll: (
    <Centred
      headline="Find a time that works."
      line="Mark the times you're free. No account needed, just your name."
    >
      <PollGrid />
    </Centred>
  ),
};
