"use client";

import { useState } from "react";

import { Check, Copy, ExternalLink, Unlink } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import type { ConnectedApp, ConnectedAppSpace } from "@/server/connectors/connected-apps";

import { SettingsCard } from "../settings/settings-card";
import { disconnectAiApps } from "./actions";

const ACCESS_LABELS: Record<ConnectedApp["access"], string> = {
  READ: "Read only",
  WRITE: "Read and make changes",
};

function spaceLabel(space: ConnectedAppSpace): string {
  switch (space.scope) {
    case "all":
      return "Personal and all your clubs";
    case "personal":
      return "Personal only";
    case "club":
      return `${space.name} only`;
    case "gone":
      return "A club you've left";
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The field stays selectable for copying by hand.
    }
  }
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        readOnly
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono text-xs"
        aria-label={label}
      />
      <Button type="button" variant="outline" onClick={copy}>
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/**
 * AI apps the user connected (docs/features/ai-connectors.md): each app's
 * name, access and space, when it was connected and last used, with
 * Disconnect and Disconnect all, then how to connect one. Disconnecting
 * refuses the app's next request at once.
 */
export function ConnectedAppsCard({
  apps,
  mcpUrl,
  claudeUrl,
}: {
  apps: ConnectedApp[];
  mcpUrl: string;
  claudeUrl: string;
}) {
  const [confirmEl, confirm] = useConfirm();
  const [message, setMessage] = useState<string | null>(null);

  function disconnect(app: ConnectedApp | null) {
    setMessage(null);
    void confirm({
      title: app ? `Disconnect ${app.name}?` : "Disconnect every AI app?",
      description: app
        ? "It stops working with Bananasplit right away. To use it again, connect it again."
        : "They all stop working with Bananasplit right away. To use one again, connect it again.",
      confirmLabel: app ? "Disconnect" : "Disconnect all",
      run: async () => {
        const result = await disconnectAiApps(app ? app.id : null);
        return result.ok ? null : result.error;
      },
    }).then((done) => {
      if (done) setMessage(app ? `${app.name} is disconnected.` : "Every AI app is disconnected.");
    });
  }

  const claudeCode = `claude mcp add --transport http bananasplit ${mcpUrl}`;

  return (
    <SettingsCard
      title="AI apps"
      description="Use your Personal space and clubs from Claude, ChatGPT and other AI apps. An app only ever sees what you can see here, in the spaces you chose when you connected it."
      status={
        <p aria-live="polite" className="text-muted-foreground">
          {message}
        </p>
      }
      footer={
        apps.length > 1 && (
          <Button type="button" variant="ghost" onClick={() => disconnect(null)}>
            <Unlink className="size-4" aria-hidden="true" />
            Disconnect all
          </Button>
        )
      }
    >
      {confirmEl}
      {apps.length === 0 ? (
        <p className="text-muted-foreground text-sm">No apps connected yet.</p>
      ) : (
        <ul className="divide-border/70 divide-y">
          {apps.map((app) => (
            <li
              key={app.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1 basis-64">
                <p className="truncate text-sm font-semibold">{app.name}</p>
                <p className="text-muted-foreground mt-0.5 text-[13px]">
                  {ACCESS_LABELS[app.access]} · {spaceLabel(app.space)}
                </p>
                <p className="text-muted-foreground text-[13px]" suppressHydrationWarning>
                  Connected {formatDate(app.connectedAt)} · Last used {formatDate(app.lastUsedAt)}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => disconnect(app)}>
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}

      <details className="bg-muted/60 rounded-tile group p-4 text-sm">
        <summary className="cursor-pointer font-semibold">How to connect an app</summary>
        <div className="mt-3 space-y-4">
          <p>
            Give the app this address. It asks you to log in to Bananasplit, then which spaces it
            can use and whether it can make changes.
          </p>
          <CopyField value={mcpUrl} label="Bananasplit's address for AI apps" />
          <dl className="space-y-3">
            <div>
              <dt className="font-semibold">Claude</dt>
              <dd className="mt-1 space-y-2">
                <Button asChild size="sm">
                  <a href={claudeUrl} target="_blank" rel="noopener noreferrer">
                    Add to Claude
                    <ExternalLink data-icon="inline-end" aria-hidden="true" />
                  </a>
                </Button>
                <p className="text-muted-foreground">
                  Or in Claude, open Customize › Connectors › Add custom connector and paste the
                  address.
                </p>
              </dd>
            </div>
            <div>
              <dt className="font-semibold">ChatGPT</dt>
              <dd className="text-muted-foreground mt-1">
                In Settings › Apps and connectors, add a custom connector with the address (ChatGPT
                may ask you to turn on developer mode first, under Advanced).
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Claude Code</dt>
              <dd className="mt-1 space-y-2">
                <CopyField value={claudeCode} label="Claude Code command" />
                <p className="text-muted-foreground">
                  Then run <code className="font-mono text-xs">/mcp</code> in Claude Code to log in.
                </p>
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Cursor</dt>
              <dd className="text-muted-foreground mt-1">
                In Cursor Settings › MCP, add a custom MCP server named{" "}
                <code className="font-mono text-xs">bananasplit</code> with the address as its{" "}
                <code className="font-mono text-xs">url</code>.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">VS Code</dt>
              <dd className="text-muted-foreground mt-1">
                Run <span className="font-medium">MCP: Add Server…</span> from the Command Palette,
                choose HTTP and paste the address.
              </dd>
            </div>
          </dl>
        </div>
      </details>
    </SettingsCard>
  );
}
