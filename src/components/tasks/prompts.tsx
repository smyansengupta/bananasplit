"use client";

import { TriangleAlert } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_BLOCKED_REASON } from "@/lib/tasks/status";

/**
 * Promise-based prompts used by every view:
 * - useBlockedReason(): moving a task to Blocked asks what it's blocked on.
 * - useConfirmFlagged(): assigning someone above your level in the org
 *   chart is allowed but flagged; confirm first.
 */

export function useBlockedReason(): [
  React.ReactNode,
  (taskTitle?: string) => Promise<string | null>,
] {
  const [state, setState] = useState<{ title?: string } | null>(null);
  const [reason, setReason] = useState("");
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const ask = useCallback((taskTitle?: string) => {
    setReason("");
    setState({ title: taskTitle });
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  };

  const element = (
    <Dialog open={state !== null} onOpenChange={(open) => !open && close(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What&apos;s it blocked on?</DialogTitle>
          <DialogDescription>
            {state?.title ? `"${state.title}" moves to Blocked. ` : ""}
            Say what it&apos;s waiting on so the exec sync can clear it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="blocked-reason-input">Blocked on</Label>
          <Textarea
            id="blocked-reason-input"
            value={reason}
            maxLength={MAX_BLOCKED_REASON}
            rows={3}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && reason.trim()) {
                e.preventDefault();
                close(reason.trim());
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button disabled={!reason.trim()} onClick={() => close(reason.trim())}>
            Mark blocked
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return [element, ask];
}

export function useConfirmFlagged(): [React.ReactNode, (names: string[]) => Promise<boolean>] {
  const [names, setNames] = useState<string[] | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((people: string[]) => {
    setNames(people);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setNames(null);
  };

  const list = names?.join(", ") ?? "";
  const element = (
    <Dialog open={names !== null} onOpenChange={(open) => !open && close(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="text-warning size-5" aria-hidden="true" />
            Assign above your level?
          </DialogTitle>
          <DialogDescription>
            {list} {names && names.length > 1 ? "are" : "is"} above you in the org chart.
            That&apos;s allowed, but the assignment is flagged on the task and they&apos;re
            notified. They or an admin can acknowledge it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button onClick={() => close(true)}>Assign anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return [element, confirm];
}
