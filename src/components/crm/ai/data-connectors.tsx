"use client";

import { ExternalLink, KeyRound, Loader2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { removeDataKeyAction, saveDataKeyAction, testDataKeyAction } from "@/app/app/[orgSlug]/crm/ai-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import type { ReactNode } from "react";

export interface DataConnectionView {
  id: "tavily" | "hunter" | "prospeo";
  label: string;
  body: string;
  keyUrl: string;
  connected: boolean;
  attention: boolean;
  last4: string | null;
  lastError: string | null;
  checkedAt: string | null;
  creditsUsed: number | null;
  creditsLimit: number | null;
}

/** Each connector's tile, drawn on the server (BrandMark reads the logo files): small for the row, smaller for the window. */
export type ConnectorMarks = Record<DataConnectionView["id"], { row: ReactNode; title: ReactNode }>;

const WHAT: Record<DataConnectionView["id"], string> = {
  tavily: "Tavily's free plan includes 1,000 credits a month: a basic search is 1 credit. It powers the research agent, enrichment and AI fields that search the web.",
  hunter: "Finds a person's title, company and socials from their email address, and a company's details from its domain.",
  prospeo: "Finds a person's details from their email address or LinkedIn profile.",
};

function credits(c: DataConnectionView): string | null {
  if (c.creditsUsed === null) return null;
  return c.creditsLimit !== null ? `${c.creditsUsed.toLocaleString()} of ${c.creditsLimit.toLocaleString()} credits used this month` : `${c.creditsUsed.toLocaleString()} credits used this month`;
}

/** The three data connector rows, each opening a small window to connect, test or remove its key. */
export function DataConnectors({
  orgId,
  canManage,
  canRemove,
  connections,
  marks,
}: {
  orgId: string;
  canManage: boolean;
  canRemove: boolean;
  connections: DataConnectionView[];
  marks: ConnectorMarks;
}) {
  const [open, setOpen] = useState<DataConnectionView["id"] | null>(null);
  const current = connections.find((c) => c.id === open) ?? null;
  return (
    <section className="space-y-4" aria-labelledby="int-data">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="int-data" className="heading text-[20px]">
          Research and enrichment
        </h2>
        <span className="text-muted-foreground text-[13.5px]">For the CRM, on your organization&apos;s own keys. Bananasplit never charges per lookup.</span>
      </div>
      <ul className="bg-card text-card-foreground ring-foreground/6 rounded-card edge divide-border divide-y px-[22px] py-1.5 ring-1">
        {connections.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 py-3">
            <span className="shrink-0">
              {marks[c.id].row}
            </span>
            <div className="min-w-0 flex-[1_1_150px]">
              <p className="text-[14.5px] font-semibold">{c.label}</p>
              <p className="text-muted-foreground truncate text-[12.5px]">{c.connected ? (credits(c) ?? c.body) : c.body}</p>
            </div>
            {c.connected && <Badge variant="success">Connected</Badge>}
            {c.attention && <Badge variant="destructive">Needs attention</Badge>}
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setOpen(c.id)}>
                {c.connected || c.attention ? "Manage" : "Connect"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {current && <ConnectorWindow key={current.id} orgId={orgId} c={current} mark={marks[current.id].title} canRemove={canRemove} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ConnectorWindow({ orgId, c, mark, canRemove, onClose }: { orgId: string; c: DataConnectionView; mark: ReactNode; canRemove: boolean; onClose: () => void }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const has = c.connected || c.attention;

  const go = async (what: "save" | "test" | "remove") => {
    setBusy(what);
    const r =
      what === "save"
        ? await saveDataKeyAction(orgId, c.id, key).catch(() => null)
        : what === "test"
          ? await testDataKeyAction(orgId, c.id).catch(() => null)
          : await removeDataKeyAction(orgId, c.id).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
      router.refresh();
      return;
    }
    toast({ title: r.message, tone: "success" });
    setKey("");
    router.refresh();
    if (what === "remove") onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {mark}
            <DialogTitle>{c.label}</DialogTitle>
          </div>
          <DialogDescription>{WHAT[c.id]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {has && (
            <dl className="bg-muted/45 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-2xl px-4 py-3">
              <dt className="text-muted-foreground">Key</dt>
              <dd>{c.last4 ? `ends in ${c.last4}` : "saved"}</dd>
              <dt className="text-muted-foreground">Checked</dt>
              <dd>{c.checkedAt ? new Date(c.checkedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "not yet"}</dd>
              {credits(c) && (
                <>
                  <dt className="text-muted-foreground">Usage</dt>
                  <dd>{credits(c)}</dd>
                </>
              )}
              {c.lastError && (
                <>
                  <dt className="text-muted-foreground">Problem</dt>
                  <dd className="text-destructive">{c.lastError}</dd>
                </>
              )}
            </dl>
          )}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) void go("save");
            }}
          >
            <label className="block space-y-1.5">
              <span className="font-medium">{has ? "Replace the API key" : "API key"}</span>
              <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={c.id === "tavily" ? "tvly-..." : "Paste the key"} />
            </label>
            <a href={c.keyUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground inline-flex items-center gap-1 text-xs hover:underline">
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Get a key from {c.label}
            </a>
            <p className="text-muted-foreground text-xs">Stored encrypted. Nobody can read it back, Bananasplit included.</p>
          </form>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            {has && (
              <Button variant="outline" disabled={busy !== null} onClick={() => go("test")}>
                {busy === "test" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Test
              </Button>
            )}
            {has && canRemove && (
              <Button variant="ghost" disabled={busy !== null} onClick={() => go("remove")}>
                Remove
              </Button>
            )}
          </div>
          <Button disabled={busy !== null || !key.trim()} onClick={() => go("save")}>
            {busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
            {has ? "Save the new key" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
