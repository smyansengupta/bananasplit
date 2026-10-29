import { DashboardReplica } from "@/components/marketing/home/dashboard-replica";
import { GRAPHITE_PRESET } from "@/lib/theme/presets";
import { themeStyleSheet } from "@/lib/theme/css";
import { deriveTheme } from "@/lib/theme/derive";

/**
 * /dev/dashboard (development only, like all of /dev): a workspace's
 * Overview with sample data in the Graphite theme, 1440×860, for the
 * marketing screenshot (public/marketing/dashboard-light.png), captured at 2×
 * with Playwright:
 *   node scripts/capture-dashboard.mjs
 */
export default function DevDashboardPage() {
  const { light, dark } = GRAPHITE_PRESET;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeStyleSheet(deriveTheme(light, dark)) }} />
      <DashboardReplica />
    </>
  );
}
