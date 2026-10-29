// Captures every link-preview card (/dev/og/<card>, drawn by
// src/components/marketing/og/og-cards.tsx) into the opengraph-image.png
// files listed in scripts/og-cards.json, and writes each image's
// .alt.txt beside it. Needs `next dev` on :3000 and Playwright's Chromium
// (npx playwright install chromium).
//
//   node scripts/capture-og.mjs            all cards
//   node scripts/capture-og.mjs home poll  only these
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
const WIDTH = 1200;
const HEIGHT = 630;

const manifest = JSON.parse(await readFile(new URL("./og-cards.json", import.meta.url), "utf8"));
const wanted = process.argv.slice(2);
const cards = wanted.length > 0 ? wanted : Object.keys(manifest);

const unknown = cards.filter((card) => !manifest[card]);
if (unknown.length > 0) {
  throw new Error(`No such card in scripts/og-cards.json: ${unknown.join(", ")}`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  // The dev overlay's badge would land in the corner of every card.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});

  for (const card of cards) {
    const { targets, alt } = manifest[card];
    const response = await page.goto(`${BASE}/dev/og/${card}`, { waitUntil: "networkidle" });
    if (!response?.ok()) {
      throw new Error(`/dev/og/${card} answered ${response?.status() ?? "nothing"}`);
    }
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    // Bricolage, Young Serif and Hanken are webfonts: without this the shot
    // can land on the fallback faces.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });

    for (const target of targets) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, png);
      await writeFile(target.replace(/\.png$/, ".alt.txt"), `${alt}\n`);
      console.log(`${card} -> ${target}`);
    }
  }
  await page.close();
} finally {
  await browser.close();
}
