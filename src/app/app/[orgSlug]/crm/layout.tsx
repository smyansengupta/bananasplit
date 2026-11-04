import { Suspense } from "react";

import { CrmPendingCard } from "@/components/crm/card/crm-pending-card";

/**
 * Every CRM page. Being one shared layout is the point: a navigation inside
 * the CRM (opening a card with ?open=, a filter, another tab) re-renders
 * only below it, so the app's loading skeleton (`[orgSlug]/loading.tsx`,
 * above it) never swaps out the page you're on. The page stays put until
 * the next one is ready, and a card's frame shows at once (CrmPendingCard).
 */
export default function CrmLayout({ children }: LayoutProps<"/app/[orgSlug]/crm">) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <CrmPendingCard />
      </Suspense>
    </>
  );
}
