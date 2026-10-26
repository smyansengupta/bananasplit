"use client";

import { RotateCcw, Wallet } from "@/components/icons";
import Link from "next/link";
import { useParams } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Finance's own error screen: a calm card with Finance's wallet and one
 * action. In production a server error reaches the browser only as a
 * generic message and a digest (Next.js hides the rest), so this shows the
 * digest: quoting it finds the error in the server logs. Try again
 * re-renders the page; My reimbursements (a link in the text) works for
 * every member.
 */
export default function FinanceError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  return (
    <Card role="alert" className="py-4">
      <EmptyState
        icon={Wallet}
        title="This finance page couldn't load"
        description={
          <>
            Try again in a moment. If it keeps happening, send your e-board this code so they can
            look it up:{" "}
            <code className="bg-muted rounded-[6px] px-1.5 py-0.5 font-mono text-xs">
              {error.digest ?? "no code"}
            </code>
            {orgSlug && (
              <>
                {" "}
                Your{" "}
                <Link
                  href={`/app/${orgSlug}/finance/my-reimbursements`}
                  className="text-foreground focus-glow rounded-sm font-medium underline underline-offset-3"
                >
                  reimbursements
                </Link>{" "}
                still open.
              </>
            )}
          </>
        }
        action={
          <Button type="button" onClick={() => retry()}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        }
      />
    </Card>
  );
}
