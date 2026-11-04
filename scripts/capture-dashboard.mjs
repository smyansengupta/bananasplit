// Captures /dev/dashboard (the marketing Overview, sample data) at 2x, in
// the light theme, into public/marketing/dashboard-light.png. Needs `next dev` on :3000 and
// Playwright's Chromium (npx playwright install chromium).
//
//   node scripts/capture-dashboard.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch();
try {
  for (const theme of ["light"]) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 860 },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    await page.goto(`${BASE}/dev/dashboard`, { waitUntil: "networkidle" });
    await page.evaluate((t) => {
      const html = document.documentElement;
      html.classList.remove("light", "dark");
      html.classList.add(t);
      html.style.colorScheme = t;
    }, theme);
    // The dev overlay's badge, and the stat strip's count-up settling.
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `public/marketing/dashboard-${theme}.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
