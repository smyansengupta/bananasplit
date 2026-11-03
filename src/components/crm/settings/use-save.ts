"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runAction } from "@/lib/run-action";

type Status = { tone: "ok" | "error" | "info"; text: string } | null;

/**
 * One SettingsCard's Save: runs the action, puts "Saved." (or the error)
 * on the card's status line beside the button, and refreshes the page.
 */
export function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<Status>(null);
  const save = (
    call: () => Promise<
      { ok: boolean; error?: string } | { ok: true } | { ok: false; error: string }
    >,
    done = "Saved.",
  ) =>
    start(async () => {
      setStatus(null);
      const r = await runAction(call);
      if (!r) return;
      if (!r.ok) {
        setStatus({ tone: "error", text: ("error" in r && r.error) || "That didn't save." });
        return;
      }
      setStatus({ tone: "ok", text: done });
      router.refresh();
    });
  return { pending, status, setStatus, save };
}
