"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { issueCodeAction } from "./actions";

export function IssueCodeForm({ disabledReason }: { disabledReason?: string }) {
  const [state, formAction, isPending] = useActionState(issueCodeAction, {});
  return (
    <form action={formAction} className="space-y-3 rounded-lg border p-4">
      <div className="grid gap-1.5">
        <Label htmlFor="code-note">Note (who it is for)</Label>
        <Input id="code-note" name="note" maxLength={200} placeholder="Robotics Club president" />
      </div>
      <Button type="submit" disabled={isPending || Boolean(disabledReason)}>
        {isPending ? "Issuing…" : "Issue a code"}
      </Button>
      {disabledReason && <p className="text-muted-foreground text-sm">{disabledReason}</p>}
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
      {state.code && (
        <div className="bg-muted space-y-1 rounded-md p-3" role="status">
          <p className="text-sm">
            Copy this code now: it is shown once. It works once, until{" "}
            {new Date(state.expiresAt!).toLocaleDateString("en-US", { dateStyle: "medium" })}.
          </p>
          <p className="font-mono text-lg tracking-wider select-all">{state.code}</p>
        </div>
      )}
    </form>
  );
}
