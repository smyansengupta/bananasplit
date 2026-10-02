"use client";

import { Check, Copy, Link2, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";

import {
  rotateJoinCodeAction,
  updateJoinCodeAction,
  type JoinCodeResult,
} from "@/app/app/[orgSlug]/settings/members/join-code-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type CodeState = Extract<JoinCodeResult, { ok: true }>["code"];

/**
 * The org's invite code for admins: copy the code or the join link, turn it
 * off, limit it to the org's email domain, or replace it. People who join
 * with it still need a verified email, and land as members.
 */
export function JoinCodeCard({
  orgId,
  initial,
  joinUrlBase,
  compact = false,
}: {
  orgId: string;
  initial: CodeState;
  /** The absolute /onboarding/join URL; ?code= is appended. */
  joinUrlBase: string;
  compact?: boolean;
}) {
  const [code, setCode] = useState(initial);
  const [domain, setDomain] = useState(initial.allowedDomain ?? "");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const link = `${joinUrlBase}?code=${code.code}`;

  function apply(run: () => Promise<JoinCodeResult>, message: string) {
    setError(null);
    setSaved(null);
    start(async () => {
      const result = await run();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCode(result.code);
      setDomain(result.code.allowedDomain ?? "");
      setSaved(message);
    });
  }

  async function copy(what: "code" | "link") {
    try {
      await navigator.clipboard.writeText(what === "code" ? code.code : link);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Couldn't copy. Select the text and copy it instead.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "bg-muted/50 rounded-lg border px-3 py-1.5 font-mono text-lg tracking-[0.2em] select-all",
            !code.enabled && "text-muted-foreground line-through",
          )}
          aria-label={`Invite code ${code.code}`}
        >
          {code.code}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => copy("code")}
          disabled={!code.enabled}
        >
          {copied === "code" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied === "code" ? "Copied" : "Copy code"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => copy("link")}
          disabled={!code.enabled}
        >
          {copied === "link" ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
          {copied === "link" ? "Copied" : "Copy invite link"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {code.enabled
          ? `Anyone with this code and a verified email${code.allowedDomain ? ` on @${code.allowedDomain}` : ""} can join as a member.`
          : "Turned off: nobody can join with it until you turn it back on."}{" "}
        Used {code.useCount} {code.useCount === 1 ? "time" : "times"}.
      </p>

      {!compact && (
        <div className="grid gap-3 border-t pt-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Invite code on</span>
            <Switch
              checked={code.enabled}
              disabled={pending}
              onCheckedChange={(enabled) =>
                apply(
                  () => updateJoinCodeAction(orgId, { enabled }),
                  enabled ? "Invite code on." : "Invite code off.",
                )
              }
            />
          </label>
          <form
            className="grid gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              apply(
                () => updateJoinCodeAction(orgId, { allowedDomain: domain.trim() || null }),
                "Saved.",
              );
            }}
          >
            <label htmlFor="join-domain" className="text-sm">
              Limit to a school domain
            </label>
            <div className="flex gap-2">
              <Input
                id="join-domain"
                value={domain}
                placeholder="yourschool.edu (optional)"
                onChange={(e) => setDomain(e.target.value)}
                className="max-w-xs"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={pending || domain.trim() === (code.allowedDomain ?? "")}
              >
                Save
              </Button>
            </div>
          </form>
          <div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                apply(
                  () => rotateJoinCodeAction(orgId),
                  "New code made. The old one no longer works.",
                )
              }
            >
              <RefreshCw className="size-3.5" />
              Make a new code
            </Button>
          </div>
        </div>
      )}
      <p
        aria-live="polite"
        className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}
      >
        {error ?? saved ?? ""}
      </p>
    </div>
  );
}
