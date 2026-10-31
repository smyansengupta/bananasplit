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

import { SettingsCard, SettingsStatus } from "../settings/settings-card";
import { removeIntegrationAction, testIntegrationAction } from "./actions";
import { STATUS_COPY, statusVariant } from "./status-copy";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
export type Feedback = { tone: "ok" | "error"; text: string } | null;

export function feedbackOf(result: ActionResult): Feedback {
  return result.ok
    ? { tone: "ok", text: result.message ?? "Saved." }
    : { tone: "error", text: result.error };
}

export function FeedbackLine({ feedback }: { feedback: Feedback }) {
  return <SettingsStatus status={feedback} />;
}

export function StatusBadge({ status }: { status: IntegrationDto["status"] }) {
  return <Badge variant={statusVariant(status)}>{STATUS_COPY[status]}</Badge>;
}

const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Status, last four characters and the last check: everything a page ever shows about a secret. */
export function StatusPanel({ dto, secretLabel }: { dto: IntegrationDto; secretLabel: string }) {
  return (
    <SettingsCard title="Connection" action={<StatusBadge status={dto.status} />}>
      <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">{secretLabel}</dt>
        {/* hasSecret, not last4: last4 is null for a secret under 16 characters. */}
        <dd className={dto.hasSecret && dto.last4 ? "font-mono text-[13px]" : undefined}>
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
      </dl>
      {dto.lastError && dto.status !== "CONNECTED" && (
        <p
          role="alert"
          className="bg-tint-danger text-tint-danger-foreground rounded-tile p-3 text-sm"
        >
          <span className="font-semibold">Last error: </span>
          {dto.lastError}
        </p>
      )}
    </SettingsCard>
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
  value,
  onChange,
  placeholder,
  help,
}: {
  id: string;
  label: string;
  /** A secret is stored. */
  hasSecret: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  help?: string;
}) {
  const saved = hasSecret ? "Saved. Paste a new one to replace it." : placeholder;
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
      <p className="text-muted-foreground text-[13px]">
        {help ? `${help} ` : ""}Stored encrypted; it is never shown again after saving.
      </p>
    </div>
  );
}

/** Test and (OWNER) Remove, for any provider, in their own card. */
export function TestAndRemove({
  orgId,
  provider,
  canTest,
  canRemove,
  testLabel = "Test connection",
  removeCopy,
  name = "integration",
}: {
  orgId: string;
  provider: IntegrationDto["provider"];
  canTest: boolean;
  canRemove: boolean;
  testLabel?: string;
  removeCopy: string;
  /** What the remove button names: "Remove Claude API". */
  name?: string;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  if (!canTest && !canRemove) return null;

  return (
    <SettingsCard
      title={canRemove ? "Test or remove" : "Test"}
      description={
        canRemove
          ? "Run the connection test again, or remove the saved credentials. Only owners can remove."
          : "Run the connection test again."
      }
      status={feedback && <FeedbackLine feedback={feedback} />}
      footer={
        <>
          {canRemove && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" className="text-destructive" disabled={isPending}>
                  Remove
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Remove {name}?</DialogTitle>
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
                    Remove {name}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
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
        </>
      }
    />
  );
}
