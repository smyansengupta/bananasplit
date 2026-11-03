"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createApiKeyAction, revokeApiKeyAction } from "@/app/app/[orgSlug]/crm/api-actions";
import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { Copy, KeyRound } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

/**
 * API keys for the CRM's REST API (owners and admins). A new key is shown
 * once, with a copy button; after that only its prefix. Revoking is
 * immediate.
 */

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function ApiKeys({ orgId, keys }: { orgId: string; keys: ApiKeyRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [write, setWrite] = useState(false);
  const [pending, setPending] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [confirmUi, confirm] = useConfirm();

  async function create() {
    setPending(true);
    const r = await createApiKeyAction(orgId, { name: name || "API key", write }).catch(() => null);
    setPending(false);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
      return;
    }
    setMade(r.key);
    setName("");
    router.refresh();
  }

  const live = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);

  return (
    <div className="space-y-5">
      {confirmUi}
      <SettingsCard
        title="New key"
        description="For Zapier, Make, a script or your own app. Give it a name you'll recognize."
        footer={
          <Button onClick={() => void create()} disabled={pending}>
            <KeyRound className="size-4" aria-hidden="true" />
            {pending ? "Making it…" : "Make a key"}
          </Button>
        }
      >
        <div className="grid gap-1.5">
          <Label htmlFor="key-name">Name</Label>
          <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Zapier" maxLength={80} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="What it can do">
          <button type="button" aria-pressed={!write} onClick={() => setWrite(false)} className={cn(chipClass(!write), "h-8 px-3 text-[13px]")}>
            Read only
          </button>
          <button type="button" aria-pressed={write} onClick={() => setWrite(true)} className={cn(chipClass(write), "h-8 px-3 text-[13px]")}>
            Read and change
          </button>
        </div>
        {made && (
          <div className="bg-tint-warning text-tint-warning-foreground rounded-tile space-y-2 p-3 text-sm">
            <p className="font-semibold">Copy it now. It won&apos;t be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="bg-card min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-[12.5px]">{made}</code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void navigator.clipboard?.writeText(made).then(() => toast({ title: "Copied." }))}
              >
                <Copy className="size-4" aria-hidden="true" />
                Copy
              </Button>
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Keys">
        {live.length === 0 ? (
          <p className="text-muted-foreground text-sm">No keys yet.</p>
        ) : (
          <ul className="divide-border divide-y text-sm">
            {live.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <b className="min-w-0 flex-1 truncate">{k.name}</b>
                <code className="text-muted-foreground font-mono text-xs">{k.prefix}</code>
                <Badge variant={k.scopes.includes("write") ? "info" : "secondary"}>
                  {k.scopes.includes("write") ? "Read and change" : "Read only"}
                </Badge>
                <span className="text-muted-foreground text-xs">{k.lastUsedAt ? `Used ${day(k.lastUsedAt)}` : "Never used"}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Revoke ${k.name}?`,
                      description: "Anything using it stops working at once. This can't be undone.",
                      confirmLabel: "Revoke",
                      tone: "destructive",
                    });
                    if (!ok) return;
                    const r = await revokeApiKeyAction(orgId, k.id).catch(() => null);
                    if (!r || !r.ok) toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
                    router.refresh();
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        {revoked.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Revoked: {revoked.map((k) => `${k.name} (${k.prefix})`).join(", ")}.
          </p>
        )}
      </SettingsCard>
    </div>
  );
}
