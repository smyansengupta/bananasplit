"use client";

import { RotateCcw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

/**
 * Finance's own error screen. In production a server error reaches the
 * browser only as a generic message and a digest (Next.js hides the
 * rest), so this shows the digest: quoting it finds the error in the
 * server logs. Try again re-renders the page; My reimbursements works for
 * every member.
 */
export default function FinanceError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  return (
    <EmptyState
      icon={ShieldAlert}
      title="This finance page couldn't load"
      description={
        <>
          Try again in a moment. If it keeps happening, send your e-board this code so they can look it up:{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">{error.digest ?? "no code"}</code>
        </>
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => retry()}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Try again
          </Button>
          {orgSlug && (
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}/finance/my-reimbursements`}>My reimbursements</Link>
            </Button>
          )}
        </div>
      }
    />
  );
}
