"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useSaveOnChange } from "@/components/ui/autosave";
import { runAction } from "@/lib/run-action";

type Status = { tone: "ok" | "error" | "info"; text: string } | null;

type Saved = { ok: boolean; error?: string } | { ok: true } | { ok: false; error: string };

/**
 * A setting that saves the moment it changes (no Save button): pair it with
 * SavedMark in the card's corner. Refreshes the page once it's saved.
 */
export function useAutoSave<T>(call: (value: T) => Promise<Saved>) {
  const router = useRouter();
  return useSaveOnChange<T>(async (value) => {
    const r = await runAction(() => call(value));
    if (!r) return "That didn't save.";
    if (!r.ok) return ("error" in r && r.error) || "That didn't save.";
    router.refresh();
  });
}

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
