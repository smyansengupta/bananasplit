"use client";

import { RotateCcw } from "@/components/icons";
import Link from "next/link";
import { useParams } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

/**
 * A page inside an organization that failed: try it again, or go to the
 * organization's home. A refusal (ForbiddenError) says only that; trying
 * again wouldn't change it.
 */
export default function OrgSegmentError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const isForbidden = error.name === "ForbiddenError";
  const home = orgSlug ? `/app/${orgSlug}` : "/app";

  return (
    <div className="p-6">
      <EmptyState
        title={isForbidden ? "Your role can't do this" : "This page didn't load"}
        action={
          <span className="flex flex-wrap justify-center gap-2">
            {!isForbidden && (
              <Button type="button" onClick={() => retry()}>
                <RotateCcw aria-hidden="true" />
                Try again
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={home}>Home</Link>
            </Button>
          </span>
        }
      />
    </div>
  );
}
