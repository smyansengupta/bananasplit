"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { joinWithInviteCodeAction } from "@/app/onboarding/join/actions";
import { Button } from "@/components/ui/button";

/**
 * Join, right on the link's page, for someone signed in and ready (a
 * verified email, onboarding done): one click, no second preview. The
 * server checks the code, the email and the club's domain again, as the
 * code form does. If it refuses, the reason shows here with the full join
 * page (where a code can be retyped) as the way on.
 */
export function JoinNow({ code, club }: { code: string; club: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await joinWithInviteCodeAction(code);
            if (result?.error) setError(result.error);
          })
        }
      >
        {pending ? "Joining…" : `Join ${club}`}
      </Button>
      {error && (
        <p role="alert" className="text-tint-danger-foreground m-0 text-center text-sm">
          {error}{" "}
          <Link
            href={`/onboarding/join?code=${encodeURIComponent(code)}`}
            className="font-medium underline underline-offset-4"
          >
            Try the code again
          </Link>
        </p>
      )}
    </div>
  );
}
