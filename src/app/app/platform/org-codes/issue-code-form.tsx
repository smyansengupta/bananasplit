"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { issueCodeAction } from "./actions";

export function IssueCodeForm({ disabledReason }: { disabledReason?: string }) {
  const [state, formAction, isPending] = useActionState(issueCodeAction, {});
  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Issue a code</h2>
          </CardTitle>
          <CardDescription>Single use, valid for 14 days.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid max-w-md gap-1.5">
            <Label htmlFor="code-note">Note (who it is for)</Label>
            <Input
              id="code-note"
              name="note"
              maxLength={200}
              placeholder="Riverside Robotics president"
            />
          </div>
          {state.error && (
            <p
              role="alert"
              className="bg-tint-danger text-tint-danger-foreground rounded-tile p-3 text-sm"
            >
              {state.error}
            </p>
          )}
          {state.code && (
            <div
              className="bg-tint-success text-tint-success-foreground rounded-tile space-y-1.5 p-4"
              role="status"
            >
              <p className="text-sm">
                Copy this code now: it is shown once. It works once, until{" "}
                {new Date(state.expiresAt!).toLocaleDateString("en-US", { dateStyle: "medium" })}.
              </p>
              <p className="font-mono text-lg tracking-wider select-all">{state.code}</p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex-wrap justify-end gap-x-4 gap-y-2">
          {disabledReason && (
            <p className="text-muted-foreground mr-auto text-sm">{disabledReason}</p>
          )}
          <Button type="submit" disabled={isPending || Boolean(disabledReason)}>
            {isPending ? "Issuing…" : "Issue a code"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
