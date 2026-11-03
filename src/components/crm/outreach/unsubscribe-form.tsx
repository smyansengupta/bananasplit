"use client";

import { useState } from "react";

import { setSubscriptionAction } from "@/app/u/[token]/actions";
import { Button } from "@/components/ui/button";

/**
 * The footer link's page: one button, so nobody is unsubscribed by a mail
 * scanner following the link, and a way back for whoever clicked by mistake.
 */
export function UnsubscribeForm({ token, orgName, initial }: { token: string; orgName: string; initial: boolean }) {
  const [out, setOut] = useState(initial);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const set = async (subscribed: boolean) => {
    setPending(true);
    const r = await setSubscriptionAction(token, subscribed).catch(() => ({ ok: false }));
    setPending(false);
    setFailed(!r.ok);
    if (r.ok) setOut(!subscribed);
  };
  return (
    <div className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
      {out ? (
        <>
          <p className="text-[15px]">You won't get these emails from {orgName} any more. That covers everyone there.</p>
          <Button variant="outline" disabled={pending} onClick={() => set(true)}>
            Subscribe again
          </Button>
        </>
      ) : (
        <>
          <p className="text-[15px]">Stop emails like this from {orgName}?</p>
          <Button disabled={pending} onClick={() => set(false)}>
            Unsubscribe
          </Button>
        </>
      )}
      {failed && <p className="text-tint-danger-foreground text-sm">That didn't go through. Try again.</p>}
    </div>
  );
}
