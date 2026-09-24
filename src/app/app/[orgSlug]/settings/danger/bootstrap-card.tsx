"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { bootstrapCbcAction } from "./actions";

export interface BootstrapPerson {
  key: string;
  name: string;
  title: string;
}

export function BootstrapCard({
  orgId,
  people,
  members,
  suggested,
  bootstrappedAt,
}: {
  orgId: string;
  people: BootstrapPerson[];
  members: { userId: string; name: string }[];
  suggested: Record<string, string>;
  bootstrappedAt: string | null;
}) {
  const router = useRouter();
  const [mapping, setMapping] = useState<Record<string, string>>(suggested);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="bootstrap-heading">
      <div>
        <h2 id="bootstrap-heading" className="font-medium">
          Bootstrap CBC workspace
        </h2>
        <p className="text-muted-foreground text-sm">
          Sets up the Claude Builders Club structure: the task defaults (one owner and a due date
          per task), the &ldquo;Needs President&rdquo; and &ldquo;Design&rdquo; labels, the Design
          Requests intake queue, the published org chart (9 positions), member titles and the CBC
          theme. It adds no members. Running it again publishes a fresh chart version.
        </p>
        {bootstrappedAt && (
          <p className="mt-1 text-sm">
            Last run {new Date(bootstrappedAt).toLocaleString("en-US", { dateStyle: "medium" })}.
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {people.map((p) => (
          <label key={p.key} className="grid gap-1 text-sm">
            <span>
              {p.name} <span className="text-muted-foreground">· {p.title}</span>
            </span>
            <select
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={mapping[p.key] ?? ""}
              onChange={(e) => setMapping((m) => ({ ...m, [p.key]: e.target.value }))}
            >
              <option value="">Not a member yet (placeholder)</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await bootstrapCbcAction(orgId, mapping);
            if (result.error) setMessage({ tone: "error", text: result.error });
            else {
              setMessage({ tone: "ok", text: "The CBC workspace is set up." });
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Setting up…" : "Bootstrap CBC workspace"}
      </Button>
      {message && (
        <p
          role="status"
          className={message.tone === "error" ? "text-destructive text-sm" : "text-sm"}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
