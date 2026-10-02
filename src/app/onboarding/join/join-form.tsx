"use client";

import { ArrowRight, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { FieldError } from "@/components/onboarding/step-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { checkInviteCodeAction, joinWithInviteCodeAction, type CheckCodeResult } from "./actions";

type Checked = Extract<CheckCodeResult, { ok: true }>;

/** "ab cd-efgh" -> "ABCD-EFGH" as they type. */
function formatCode(raw: string): string {
  const s = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

/**
 * Enter the code, see which organization it belongs to (verified against
 * that org on the server: the code, your verified email and the org's
 * allowed domain), then join it.
 */
export function JoinForm({ initialCode, email }: { initialCode: string; email: string }) {
  const [code, setCode] = useState(formatCode(initialCode));
  const [checked, setChecked] = useState<Checked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [joining, startJoin] = useTransition();

  function check() {
    setError(null);
    startCheck(async () => {
      const result = await checkInviteCodeAction(code);
      if (!result.ok) {
        setChecked(null);
        setError(result.error);
        return;
      }
      setChecked(result);
    });
  }

  function join() {
    setError(null);
    startJoin(async () => {
      const result = await joinWithInviteCodeAction(code);
      if (result?.error) setError(result.error);
    });
  }

  if (checked) {
    const { org } = checked;
    return (
      <div className="space-y-4">
        <div className="bg-muted/40 flex items-center gap-3 rounded-xl border p-3">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a stored 64px WebP variant
            <img src={org.logoUrl} alt="" className="size-10 rounded-lg object-cover" />
          ) : (
            <span className="heading bg-background grid size-10 place-items-center rounded-lg border text-sm">
              {org.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase())
                .join("")}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{org.name}</div>
            <div className="text-muted-foreground text-xs">
              {org.memberCount} {org.memberCount === 1 ? "member" : "members"} · /app/{org.slug}
            </div>
          </div>
        </div>
        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <ShieldCheck className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Code verified with {org.name}
            {org.allowedDomain ? `, and ${email} is on its @${org.allowedDomain} list` : ""}.
            You&apos;ll join as a member; an admin can change your role.
          </span>
        </p>
        <FieldError message={error ?? undefined} />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="text-muted-foreground"
            onClick={() => setChecked(null)}
          >
            Different code
          </Button>
          {checked.alreadyMember ? (
            <Button asChild className="flex-1 font-semibold">
              <Link href={`/app/${org.slug}`}>You&apos;re already a member · Open</Link>
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              className="group flex-1 font-semibold"
              onClick={join}
              disabled={joining}
            >
              {joining ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Joining…
                </>
              ) : (
                <>
                  Join {org.name}
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        check();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="invite-code" className="text-xs">
          Invite code
        </Label>
        <div className="relative">
          <KeyRound
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
        <Input
          id="invite-code"
          value={code}
          onChange={(e) => {
            setCode(formatCode(e.target.value));
            setError(null);
          }}
          placeholder="ABCD-EFGH"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="h-12 text-center font-mono text-xl tracking-[0.25em] uppercase"
          aria-invalid={Boolean(error) || undefined}
          autoFocus
        />
        </div>
        <p className="text-muted-foreground text-xs">
          Ask an admin of your organization for its code.
        </p>
      </div>
      <FieldError message={error ?? undefined} />
      <Button
        type="submit"
        size="lg"
        className="group w-full font-semibold"
        disabled={checking || code.length !== 9}
      >
        {checking ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            Checking with the organization…
          </>
        ) : (
          <>
            Check code
            <ArrowRight className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </>
        )}
      </Button>
    </form>
  );
}
