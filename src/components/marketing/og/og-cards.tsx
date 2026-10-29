import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * The link-preview cards (iMessage, Slack, X, WhatsApp): one 1200x630
 * drawing per shareable page, rendered at /dev/og/<card> and screenshotted
 * into each route's opengraph-image.png by scripts/capture-og.mjs. The
 * manifest of card -> files lives in scripts/og-cards.json; a card here
 * without a row there (or the other way round) fails og-cards.test.ts.
 *
 * They are committed PNGs, not next/og routes, deliberately: a preview is
 * fetched by a crawler, not a person, so a static file on the CDN costs
 * nothing per unfurl where a generated image costs a function call every
 * time. Anything that has to say a club's own name does it in the page's
 * generateMetadata instead (src/lib/metadata/share.ts), reusing the logo
 * the club already uploaded.
 *
 * Fixed colours throughout, never the theme's tokens: these render once,
 * in light, and the file must not change when a club picks a palette.
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const INK = "#0a0a0a";
const MUTED = "#5c5c58";
const HAIRLINE = "rgba(10,10,10,0.10)";
const BANANA = "#F2C230";
const BANANA_INK = "#1c1810";
const BUBBLE = "#F0F0EF";
const TINT = "#FDF6E0";

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

/** The lockup, at the two sizes the cards use. */
function Mark({ big = false }: { big?: boolean }) {
  return <Logo size={big ? 54 : 38} textSize={big ? 54 : 38} />;
}

/** The display line. `lines` is the drawing's own break, never text-balance. */
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

function Line({ children, width }: { children: ReactNode; width?: number }) {
  return (
    <p style={{ margin: 0, fontSize: 25, lineHeight: 1.45, color: MUTED, maxWidth: width }}>
      {children}
    </p>
  );
}

/* ----------------------------------------------------------------- home */

/**
 * The hero line beside the hero's own thread. The one place this card is
 * seen most is a text message, so the card is a text message: it says what
 * the product does in the medium it is being read in.
 */
function HomeCard() {
  const thread: readonly { from: "them" | "you"; text: string }[] = [
    { from: "them", text: "Design review at 2, and the Acme proposal is due Friday." },
    { from: "you", text: "Move standup to 10 and tell the team" },
    { from: "them", text: "Done. 6 people notified." },
    { from: "them", text: "Jay sent an $86 receipt for the venue. Approve?" },
    { from: "you", text: "Yes" },
    { from: "them", text: "Approved. He'll be paid back Friday." },
  ];
  return (
    <Frame className="items-center gap-[60px] px-[72px]">
      <div className="flex flex-1 flex-col gap-[26px]">
        <Mark />
        <Headline size={72}>
          The workspace
          <br />
          that runs itself.
        </Headline>
        <Line width={470}>
          It handles the busywork and texts you only when something needs you.
        </Line>
      </div>
      <div className="flex w-[430px] flex-none flex-col gap-[10px]">
        {thread.map((message) => (
          <span
            key={message.text}
            style={{
              alignSelf: message.from === "you" ? "flex-end" : "flex-start",
              background: message.from === "you" ? BANANA : BUBBLE,
              color: message.from === "you" ? BANANA_INK : BANANA_INK,
              borderRadius: 26,
              borderBottomRightRadius: message.from === "you" ? 9 : 26,
              borderBottomLeftRadius: message.from === "you" ? 26 : 9,
              padding: "14px 22px",
              fontSize: 22,
              lineHeight: 1.33,
              maxWidth: "86%",
            }}
          >
            {message.text}
          </span>
        ))}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------- the rest */

/** A card that leads with the lockup and a line, centred or left. */
function Simple({
  headline,
  line,
  children,
  centred = false,
}: {
  headline: ReactNode;
  line: string;
  children?: ReactNode;
  centred?: boolean;
}) {
  return (
    <Frame
      className={cn(
        "flex-col justify-center gap-[28px] px-[80px]",
        centred && "items-center text-center",
      )}
    >
      <Mark />
      <Headline size={centred ? 76 : 70}>{headline}</Headline>
      <Line width={centred ? 780 : 620}>{line}</Line>
      {children}
    </Frame>
  );
}

/** A plan's tile on the pricing card. */
function Plan({ name, price, highlight }: { name: string; price: string; highlight?: boolean }) {
  return (
    <span
      className="flex flex-1 flex-col gap-[6px] rounded-[18px] px-[26px] py-[22px]"
      style={{
        background: highlight ? TINT : "#FAFAFA",
        border: `1px solid ${highlight ? "rgba(242,194,48,0.55)" : HAIRLINE}`,
      }}
    >
      <span style={{ fontSize: 21, fontWeight: 600 }}>{name}</span>
      <span style={{ fontSize: 19, color: MUTED }}>{price}</span>
    </span>
  );
}

function PricingCard() {
  return (
    <Simple
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
    </Simple>
  );
}

function DemoCard() {
  return (
    <Simple
      headline={
        <>
          Fifteen minutes,
          <br />
          set up for your team.
        </>
      }
      line="A walkthrough of Bananasplit with your club's own calendar, budget and people in it."
    />
  );
}

/** One feature's name in the row along the bottom of the product card. */
function Feature({ name }: { name: string }) {
  return (
    <span
      className="rounded-full px-[24px] py-[12px]"
      style={{ border: `1px solid ${HAIRLINE}`, fontSize: 21, color: MUTED }}
    >
      {name}
    </span>
  );
}

function ProductCard() {
  return (
    <Simple
      headline={
        <>
          Everything your team
          <br />
          runs, in one place.
        </>
      }
      line="Tasks, docs, meetings and money, kept current without anyone chasing it."
    >
      <span className="flex flex-wrap gap-[12px] pt-[14px]">
        <Feature name="Texting" />
        <Feature name="AI" />
        <Feature name="Docs and files" />
        <Feature name="Meetings" />
        <Feature name="Finance" />
      </span>
    </Simple>
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

function JoinCard() {
  return (
    <Simple centred headline="Join your club." line="Enter the code whoever invited you sent.">
      <span className="flex items-center gap-[10px] pt-[16px]">
        {"RPKA".split("").map((character, index) => (
          <CodeBox key={`a${index}`} character={character} />
        ))}
        <span style={{ width: 22, height: 2, background: HAIRLINE, margin: "0 6px" }} />
        {"YWSF".split("").map((character, index) => (
          <CodeBox key={`b${index}`} character={character} />
        ))}
      </span>
    </Simple>
  );
}

/**
 * The invite card is the fallback only: an invite to a club that has
 * uploaded a logo previews with that logo instead (clubShare, in
 * src/lib/metadata/share.ts), so this one never names a club.
 */
function InviteCard() {
  return (
    <Simple
      centred
      headline="You're invited."
      line="Open the link to join your club's workspace on Bananasplit."
    />
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

function PollCard() {
  return (
    <Simple
      centred
      headline="Find a time that works."
      line="Mark the times you're free. No account needed, just your name."
    >
      <PollGrid />
    </Simple>
  );
}

function EventCard() {
  return (
    <Simple
      centred
      headline="Save your spot."
      line="Where it is, when it starts, and who else is going."
    >
      <span className="flex items-center gap-[14px] pt-[6px]">
        <span
          className="rounded-full px-[34px] py-[16px]"
          style={{ background: BANANA, color: BANANA_INK, fontSize: 23, fontWeight: 600 }}
        >
          RSVP
        </span>
        <Feature name="Add to your calendar" />
      </span>
    </Simple>
  );
}

/** Every card by the name /dev/og/<card> and scripts/og-cards.json use. */
export const OG_CARDS: Record<string, ReactNode> = {
  home: <HomeCard />,
  pricing: <PricingCard />,
  demo: <DemoCard />,
  product: <ProductCard />,
  join: <JoinCard />,
  invite: <InviteCard />,
  poll: <PollCard />,
  event: <EventCard />,
};
