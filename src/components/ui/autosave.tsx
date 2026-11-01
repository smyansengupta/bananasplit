"use client";

import { Check, Loader2 } from "@/components/icons";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Save-on-change for single settings and fields, the app's answer to a
 * Save button under every card. A switch, a segmented choice or a picker
 * saves the moment it changes; a text field saves when it loses focus or
 * on Enter (call `save` from onBlur). Long documents use the notes
 * autosave (components/notes/use-autosave.ts) instead, which debounces and
 * retries.
 *
 *   const { status, error, save } = useSaveOnChange((name: string) => renameOrg(orgId, name));
 *   <Input defaultValue={name} onBlur={(e) => save(e.target.value)} />
 *   <SavedMark status={status} error={error} />
 *
 * The action returns an error message to fail, or nothing on success. A
 * value equal to the last one saved is not sent again.
 */
export type FieldSaveStatus = "idle" | "saving" | "saved" | "error";

export function useSaveOnChange<T>(
  action: (value: T) => Promise<string | null | undefined | void>,
  { initial }: { initial?: T } = {},
) {
  const [status, setStatus] = useState<FieldSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ value: T } | null>(initial === undefined ? null : { value: initial });
  const actionRef = useRef(action);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    actionRef.current = action;
  }, [action]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const save = useCallback(async (value: T) => {
    if (last.current && Object.is(last.current.value, value)) return true;
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    setError(null);
    let result: string | null | undefined | void;
    try {
      result = await actionRef.current(value);
    } catch {
      result = "Couldn't save. Try again.";
    }
    if (typeof result === "string" && result) {
      setStatus("error");
      setError(result);
      return false;
    }
    last.current = { value };
    setStatus("saved");
    // The tick fades after a moment; the value on screen is the record.
    timer.current = setTimeout(() => setStatus("idle"), 2_000);
    return true;
  }, []);

  return { status, error, save };
}

/** The small "Saving" / "Saved" mark beside a field that saves itself. */
export function SavedMark({
  status,
  error,
  className,
}: {
  status: FieldSaveStatus;
  error?: string | null;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex min-h-5 items-center gap-1 text-[12px] font-medium",
        status === "error" ? "text-tint-danger-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {status === "saving" && (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Saving
        </>
      )}
      {status === "saved" && (
        <>
          <Check className="text-success size-3.5" aria-hidden="true" />
          Saved
        </>
      )}
      {status === "error" && error}
    </span>
  );
}
