"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createWebhookAction,
  deleteWebhookAction,
  sendTestWebhookAction,
  updateWebhookAction,
  webhookSecretAction,
} from "@/app/app/[orgSlug]/crm/api-actions";
import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { Copy, Eye, Plus, RefreshCw, Send } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chipClass } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { WEBHOOK_EVENT_LABEL, WEBHOOK_EVENTS, type WebhookEvent } from "@/server/crm/webhooks/events";

/**
 * Outgoing webhooks (owners and admins): an https address, the events it
 * gets, its signing secret, a test send and the delivery log. Zapier's and
 * Make's "catch hook" addresses go here.
 */

export interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  deliveries: {
    id: string;
    event: string;
    status: string;
    attempts: number;
    responseCode: number | null;
    lastError: string | null;
    createdAt: string;
  }[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

function EventPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Events">
      {WEBHOOK_EVENTS.map((e) => {
        const on = value.includes(e);
        return (
          <button
            key={e}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== e) : [...value, e])}
            className={cn(chipClass(on), "h-8 px-3 text-[13px]")}
            title={e}
          >
            {WEBHOOK_EVENT_LABEL[e]}
          </button>
        );
      })}
    </div>
  );
}

export function Webhooks({ orgId, hooks }: { orgId: string; hooks: WebhookRow[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["person.created", "deal.stage_changed"]);
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [confirmUi, confirm] = useConfirm();

  async function act<T extends { ok: boolean }>(fn: () => Promise<T>, ok?: (r: T) => void) {
    setPending(true);
    const r = await fn().catch(() => null);
    setPending(false);
    if (!r || !r.ok) {
      toast({ title: r && "error" in r ? String((r as { error?: string }).error) : "That didn't work.", tone: "error" });
      return;
    }
    ok?.(r);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {confirmUi}
      <SettingsCard
        title="New webhook"
        description="Bananasplit sends each event you pick to this address as JSON, signed so you can tell it's from us."
        footer={
          <Button
            disabled={pending || !url.trim() || events.length === 0}
            onClick={() =>
              void act(
                () => createWebhookAction(orgId, { url, events }),
                (r) => {
                  const made = r as unknown as { id: string; secret: string };
                  setSecret({ id: made.id, value: made.secret });
                  setUrl("");
                },
              )
            }
          >
            <Plus className="size-4" aria-hidden="true" />
            Add webhook
          </Button>
        }
      >
        <div className="grid gap-1.5">
          <Label htmlFor="hook-url">Address</Label>
          <Input id="hook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" inputMode="url" />
        </div>
        <EventPicker value={events} onChange={setEvents} />
      </SettingsCard>

      {secret && (
        <div className="bg-tint-warning text-tint-warning-foreground rounded-tile space-y-2 p-3 text-sm">
          <p className="font-semibold">The signing secret. Keep it with the receiver to check signatures.</p>
          <div className="flex items-center gap-2">
            <code className="bg-card min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-[12.5px]">{secret.value}</code>
            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(secret.value).then(() => toast({ title: "Copied." }))}>
              <Copy className="size-4" aria-hidden="true" />
              Copy
            </Button>
          </div>
        </div>
      )}

      {hooks.map((h) => (
        <SettingsCard
          key={h.id}
          title={<span className="font-mono text-[13px] break-all">{h.url}</span>}
          action={
            <label className="flex items-center gap-2 text-sm">
              {h.active ? "On" : "Off"}
              <Switch
                checked={h.active}
                onCheckedChange={(active) => void act(() => updateWebhookAction(orgId, h.id, { active }))}
              />
            </label>
          }
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                onClick={async () => {
                  const ok = await confirm({ title: "Delete this webhook?", description: "Its delivery log goes with it.", tone: "destructive" });
                  if (ok) await act(() => deleteWebhookAction(orgId, h.id));
                }}
              >
                Delete
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void act(
                    () => webhookSecretAction(orgId, h.id),
                    (r) => setSecret({ id: h.id, value: (r as unknown as { secret: string }).secret }),
                  )
                }
              >
                <Eye className="size-4" aria-hidden="true" />
                Secret
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Make a new signing secret?",
                    description: "The receiver has to use the new one; deliveries signed with the old one stop matching.",
                    confirmLabel: "Make a new one",
                  });
                  if (ok) {
                    await act(
                      () => updateWebhookAction(orgId, h.id, { rotateSecret: true }),
                      (r) => {
                        const s = (r as unknown as { secret?: string }).secret;
                        if (s) setSecret({ id: h.id, value: s });
                      },
                    );
                  }
                }}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                New secret
              </Button>
              <Button
                disabled={pending}
                onClick={() => void act(() => sendTestWebhookAction(orgId, h.id), () => toast({ title: "Test sent. Refresh in a moment to see it." }))}
              >
                <Send className="size-4" aria-hidden="true" />
                Send test
              </Button>
            </div>
          }
        >
          <EventPicker value={h.events} onChange={(next) => next.length && void act(() => updateWebhookAction(orgId, h.id, { events: next as WebhookEvent[] }))} />
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">Recent deliveries</p>
            {h.deliveries.length === 0 ? (
              <p className="text-muted-foreground text-sm">None yet.</p>
            ) : (
              <ul className="divide-border divide-y text-sm">
                {h.deliveries.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                    <Badge variant={d.status === "delivered" ? "success" : d.status === "failed" ? "destructive" : "secondary"}>
                      {d.status === "delivered" ? "Delivered" : d.status === "failed" ? "Failed" : d.status === "retrying" ? "Retrying" : "Waiting"}
                    </Badge>
                    <code className="text-xs">{d.event}</code>
                    {d.responseCode !== null && <span className="text-muted-foreground text-xs tabular-nums">{d.responseCode}</span>}
                    {d.attempts > 1 && <span className="text-muted-foreground text-xs">{d.attempts} tries</span>}
                    <span className="text-muted-foreground ms-auto text-xs tabular-nums">{when(d.createdAt)}</span>
                    {d.lastError && d.status !== "delivered" && <p className="text-muted-foreground w-full text-xs">{d.lastError}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SettingsCard>
      ))}
    </div>
  );
}
