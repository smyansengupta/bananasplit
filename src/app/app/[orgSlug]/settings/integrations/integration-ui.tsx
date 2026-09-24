"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IntegrationDto } from "@/server/integrations/catalog";
import { SUCCESS_TEXT } from "@/lib/status-tones";

import { removeIntegrationAction, testIntegrationAction } from "./actions";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
export type Feedback = { tone: "ok" | "error"; text: string } | null;

export function feedbackOf(result: ActionResult): Feedback {
  return result.ok
    ? { tone: "ok", text: result.message ?? "Saved." }
    : { tone: "error", text: result.error };
}

export function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={feedback.tone === "error" ? "text-destructive text-sm" : `text-sm ${SUCCESS_TEXT}`}
    >
      {feedback.text}
    </p>
  );
}

const STATUS_COPY: Record<IntegrationDto["status"], string> = {
  CONNECTED: "Connected",
  ERROR: "Error",
  NEEDS_REAUTH: "Needs reconnecting",
  DISCONNECTED: "Not connected",
  NOT_SET_UP: "Not set up",
};

export function StatusBadge({ status }: { status: IntegrationDto["status"] }) {
  return (
    <Badge
      variant={
        status === "CONNECTED"
          ? "default"
          : status === "ERROR" || status === "NEEDS_REAUTH"
            ? "destructive"
            : "secondary"
      }
    >
      {STATUS_COPY[status]}
    </Badge>
  );
}

const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Status, last four characters and the last check: everything a page ever shows about a secret. */
export function StatusPanel({ dto, secretLabel }: { dto: IntegrationDto; secretLabel: string }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted-foreground">Status</dt>
      <dd>
        <StatusBadge status={dto.status} />
      </dd>
      <dt className="text-muted-foreground">{secretLabel}</dt>
      {/* hasSecret, not last4: last4 is null for a secret under 16 characters. */}
      <dd className="font-mono text-xs">
        {dto.hasSecret ? (dto.last4 ? `•••• ${dto.last4}` : "Saved") : "Not saved"}
      </dd>
      {dto.lastVerifiedAt && (
        <>
          <dt className="text-muted-foreground">Last checked</dt>
          <dd>{fmt.format(new Date(dto.lastVerifiedAt))}</dd>
        </>
      )}
      {dto.connectedByName && (
        <>
          <dt className="text-muted-foreground">Set up by</dt>
          <dd>{dto.connectedByName}</dd>
        </>
      )}
      {dto.lastError && dto.status !== "CONNECTED" && (
        <>
          <dt className="text-muted-foreground">Last error</dt>
          <dd className="text-destructive">{dto.lastError}</dd>
        </>
      )}
    </dl>
  );
}

/**
 * A write-only secret input: never prefilled, never echoed. Leaving it blank
 * keeps the stored value.
 */
export function SecretInput({
  id,
  label,
  hasSecret,
  last4,
  value,
  onChange,
  placeholder,
  help,
}: {
  id: string;
  label: string;
  /** A secret is stored. last4 may still be null (a short one shows none). */
  hasSecret: boolean;
  last4: string | null;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  help?: string;
}) {
  const saved = hasSecret
    ? `Saved${last4 ? ` (•••• ${last4})` : ""}. Paste a new one to replace it.`
    : placeholder;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={saved}
      />
      <p className="text-muted-foreground text-xs">
        {help ? `${help} ` : ""}Stored encrypted; it is never shown again after saving.
      </p>
    </div>
  );
}

/** Test and (OWNER) Remove, for any provider. */
export function TestAndRemove({
  orgId,
  provider,
  canTest,
  canRemove,
  testLabel = "Test connection",
  removeCopy,
}: {
  orgId: string;
  provider: IntegrationDto["provider"];
  canTest: boolean;
  canRemove: boolean;
  testLabel?: string;
  removeCopy: string;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canTest && (
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setFeedback(null);
                setFeedback(feedbackOf(await testIntegrationAction(orgId, provider)));
                router.refresh();
              })
            }
          >
            {isPending ? "Working…" : testLabel}
          </Button>
        )}
        {canRemove && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" className="text-destructive" disabled={isPending}>
                Remove
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove this integration?</DialogTitle>
                <DialogDescription>{removeCopy}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      setFeedback(feedbackOf(await removeIntegrationAction(orgId, provider)));
                      setOpen(false);
                      router.refresh();
                    })
                  }
                >
                  Remove
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <FeedbackLine feedback={feedback} />
    </div>
  );
}
