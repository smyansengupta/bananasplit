import { readFile } from "node:fs/promises";
import path from "node:path";

import { OG_CARDS, OG_HEIGHT, OG_WIDTH } from "@/components/marketing/og/og-cards";

/**
 * /dev/og (development only, like all of /dev): every link-preview card,
 * drawn the way Messages shows a link you send, the picture, then the
 * page's title and the domain, grouped as scripts/og-cards.json groups
 * them. One card is /dev/og/<card>; scripts/capture-og.mjs files them.
 */

interface Row {
  group: string;
  link: string;
  title: string;
}

const BUBBLE_WIDTH = 360;
const SCALE = BUBBLE_WIDTH / OG_WIDTH;
const DOMAIN = "bananasplit.fyi";

/** A link in a sent message: the picture on top, the title and domain under it. */
function LinkBubble({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted overflow-hidden rounded-[18px]" style={{ width: BUBBLE_WIDTH }}>
      {children}
      <div className="flex flex-col gap-0.5 px-3.5 py-2.5">
        <span className="line-clamp-2 text-[14px] leading-[1.3] font-semibold">{title}</span>
        <span className="text-muted-foreground text-[13px]">{DOMAIN}</span>
      </div>
    </div>
  );
}

/** A card, scaled down to the bubble's width. */
function Card({ name }: { name: string }) {
  return (
    <div style={{ width: BUBBLE_WIDTH, height: OG_HEIGHT * SCALE, overflow: "hidden" }}>
      <div
        style={{
          width: OG_WIDTH,
          height: OG_HEIGHT,
          transform: `scale(${SCALE})`,
          transformOrigin: "0 0",
        }}
      >
        {OG_CARDS[name]}
      </div>
    </div>
  );
}

/** What a club that has uploaded a logo sends instead: its logo, square. */
function ClubLogo() {
  return (
    <div
      className="bg-primary text-primary-foreground grid place-items-center"
      style={{ width: BUBBLE_WIDTH, height: BUBBLE_WIDTH }}
    >
      <span className="font-heading text-[120px] leading-none tracking-[-0.05em]">RC</span>
    </div>
  );
}

function Item({ link, children }: { link: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-2">
      <span className="text-muted-foreground self-start font-mono text-[12px]">{link}</span>
      {children}
    </div>
  );
}

export default async function DevOgGalleryPage() {
  const manifest = JSON.parse(
    await readFile(path.join(process.cwd(), "scripts/og-cards.json"), "utf8"),
  ) as Record<string, Row>;
  const groups = [...new Set(Object.values(manifest).map((row) => row.group))];
  const withLogo = ["invite", "join", "poll"].filter((name) => manifest[name]);

  return (
    <main
      className="light bg-background text-foreground min-h-screen px-10 py-10"
      style={{ colorScheme: "light" }}
    >
      <h1 className="display-title m-0 text-[34px]">Link previews</h1>
      <p className="text-muted-foreground mt-1 mb-8 text-[15px]">
        Every card, as Messages shows a link you send. {Object.keys(manifest).length} cards.
      </p>
      {groups.map((group) => (
        <section key={group} data-group={group} className="mb-12">
          <h2 className="m-0 mb-5 text-[20px] font-semibold">{group}</h2>
          <div
            className="grid grid-cols-3 gap-x-8 gap-y-8"
            style={{ width: BUBBLE_WIDTH * 3 + 64 }}
          >
            {Object.entries(manifest)
              .filter(([, row]) => row.group === group)
              .map(([name, row]) => (
                <Item key={name} link={row.link}>
                  <LinkBubble title={row.title}>
                    <Card name={name} />
                  </LinkBubble>
                </Item>
              ))}
          </div>
        </section>
      ))}
      <section data-group="With a logo" className="mb-12">
        <h2 className="m-0 mb-1 text-[20px] font-semibold">When the club has a logo</h2>
        <p className="text-muted-foreground mt-0 mb-5 text-[15px]">
          Invites, codes and polls send the club&apos;s own logo instead of the card above.
        </p>
        <div className="grid grid-cols-3 gap-x-8" style={{ width: BUBBLE_WIDTH * 3 + 64 }}>
          {withLogo.map((name) => (
            <Item key={name} link={manifest[name].link}>
              <LinkBubble title={manifest[name].title}>
                <ClubLogo />
              </LinkBubble>
            </Item>
          ))}
        </div>
      </section>
    </main>
  );
}
