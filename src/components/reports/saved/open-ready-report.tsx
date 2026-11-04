"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { openReadyReport } from "@/app/app/[orgSlug]/databases/reports/report-actions";
import { ReportSkeleton } from "@/components/reports/report-skeleton";
import { ReportsFrame } from "@/components/reports/reports-frame";
import { Button } from "@/components/ui/button";
import type { ReadyKind } from "@/lib/reports/crm-ready";

/**
 * The first time a CRM Report button is pressed and its ready-made report
 * isn't made yet: it's made for the organization (Databases > Reports)
 * and opened, the skeleton showing meanwhile.
 */
export function OpenReadyReport({
  orgId,
  orgSlug,
  kind,
  sourceKey,
  query,
}: {
  orgId: string;
  orgSlug: string;
  kind: ReadyKind;
  sourceKey: string;
  query: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void openReadyReport(orgId, kind, sourceKey).then((result) => {
      if (result.ok) router.replace(`/app/${orgSlug}/databases/reports/${result.id}${query}`);
      else setError(result.error);
    });
  }, [orgId, orgSlug, kind, sourceKey, query, router]);

  if (error) {
    return (
      <ReportsFrame>
        <div className="mx-auto max-w-md space-y-4 py-16 text-center">
          <p className="text-sm">{error}</p>
          <Button asChild variant="ghost">
            <Link href={`/app/${orgSlug}/databases/reports`}>Go to Reports</Link>
          </Button>
        </div>
      </ReportsFrame>
    );
  }
  return (
    <ReportsFrame>
      <ReportSkeleton title="Opening the report" />
    </ReportsFrame>
  );
}
