"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";

import { SettingsCard, SettingsStatus } from "../settings-card";
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
    <SettingsCard
      title="Bootstrap CBC workspace"
      description={
        <>
          Sets up the Claude Builders Club structure: the task defaults (one owner and a due date
          per task), the &ldquo;Needs President&rdquo; and &ldquo;Design&rdquo; tags, the Design
          Requests project, the published org chart (9 positions), member titles and the CBC theme.
          It adds no members. Running it again publishes a fresh chart version.
          {bootstrappedAt &&
            ` Last run ${new Date(bootstrappedAt).toLocaleString("en-US", { dateStyle: "medium" })}.`}
        </>
      }
      status={message && <SettingsStatus status={message} />}
      footer={
        <Button
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
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {people.map((p) => (
          <label key={p.key} className="grid gap-1.5 text-sm">
            <span className="font-medium">
              {p.name} <span className="text-muted-foreground font-normal">· {p.title}</span>
            </span>
            <FieldSelect
              className="w-full"
              value={mapping[p.key] ?? ""}
              onChange={(e) => setMapping((m) => ({ ...m, [p.key]: e.target.value }))}
            >
              <option value="">Not a member yet (placeholder)</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </FieldSelect>
          </label>
        ))}
      </div>
    </SettingsCard>
  );
}
