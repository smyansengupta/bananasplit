"use client";

import { useEffect, useRef } from "react";

import { readyAccountAction } from "./actions";

/**
 * Posts readyAccountAction once, as soon as the page is up, with the
 * device's time zone. Without JavaScript, Continue sends the same form.
 */
export function ReadyAccount({ after }: { after: string | null }) {
  const form = useRef<HTMLFormElement>(null);
  const zone = useRef<HTMLInputElement>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || !form.current || !zone.current) return;
    sent.current = true;
    zone.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    form.current.requestSubmit();
  }, []);

  return (
    <form ref={form} action={readyAccountAction} className="grid min-h-svh place-items-center">
      <input ref={zone} type="hidden" name="timezone" defaultValue="" />
      {after && <input type="hidden" name="after" value={after} />}
      <noscript>
        <button type="submit" className="font-semibold underline">
          Continue
        </button>
      </noscript>
    </form>
  );
}
