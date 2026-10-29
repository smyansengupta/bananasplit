"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { CodeBoxes, cleanCode } from "@/components/brand/code-boxes";
import { pill } from "@/components/brand/pill";
import { JOIN_CODE_LENGTH, SHORT_JOIN_CODE_LENGTH } from "@/lib/join-code-format";
import { cn } from "@/lib/utils";

import { ClubPreview } from "./club-preview";
import { checkInviteCodeAction, joinWithInviteCodeAction, type CheckCodeResult } from "./actions";

type Found = Extract<CheckCodeResult, { ok: true }>;

function emptyCode(length = JOIN_CODE_LENGTH): string[] {
  return Array.from({ length }, () => "");
}

/** ?code= from an admin's shared link: eight boxes, or six for an older short code. */
function initialBoxes(initialCode: string): string[] {
  const chars = cleanCode(initialCode);
  const length =
    chars.length === SHORT_JOIN_CODE_LENGTH ? SHORT_JOIN_CODE_LENGTH : JOIN_CODE_LENGTH;
  return Array.from({ length }, (_, i) => chars[i] ?? "");
}

/**
 * Enter the club's code in eight boxes, XXXX-XXXX (design: App screens, 03). Once every
 * box is filled the club is looked up on the server (the code, the verified
 * email and the club's allowed domain) and shown before anyone joins.
 */
export function JoinForm({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(() => initialBoxes(initialCode));
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [joining, startJoin] = useTransition();
  // The code the latest lookup was for, so a stale answer is dropped.
  const latest = useRef("");
  const boxes = useRef<HTMLDivElement>(null);

  const value = code.join("");
  const complete = code.every(Boolean);
  const empty = code.every((c) => !c);

  useEffect(() => {
    latest.current = complete ? value : "";
    if (!complete) return;
    startCheck(async () => {
      const result = await checkInviteCodeAction(value);
      if (latest.current !== value) return;
      if (result.ok) {
        setFound(result);
        setError(null);
      } else {
        setFound(null);
        setError(result.error);
      }
    });
  }, [complete, value]);

  function edit(next: string[]) {
    setCode(next);
    setFound(null);
    setError(null);
  }

  function join() {
    setError(null);
    startJoin(async () => {
      const result = await joinWithInviteCodeAction(value);
      if (result?.error) setError(result.error);
    });
  }

  const org = found?.org;
  const ready = Boolean(org) && !checking;

  return (
    <>
      <div ref={boxes}>
        <CodeBoxes value={code} onChange={edit} invalid={Boolean(error)} autoFocus={!complete} />
      </div>

      {org && ready && (
        <ClubPreview
          name={org.name}
          logoUrl={org.logoUrl}
          detail={
            <>
              {org.memberCount} {org.memberCount === 1 ? "member" : "members"} ·{" "}
              {found.alreadyMember ? "you're already a member" : "you'll join as a member"}
            </>
          }
          badge={
            <span className="bg-tint-success text-tint-success-foreground flex-none rounded-full px-2.5 py-[5px] text-[12px] font-bold">
              ✓ Found
            </span>
          }
        />
      )}

      {error && (
        <p role="alert" className="text-destructive m-0 text-[14px]">
          {error}
        </p>
      )}
      {empty && !error && (
        <span className="text-muted-foreground text-[14px]">
          Tip: you can paste the whole code into the first box.
        </span>
      )}

      {org && ready && found.alreadyMember ? (
        <Link href={`/app/${org.slug}`} className={pill()}>
          Open {org.name}
        </Link>
      ) : (
        <button
          type="button"
          onClick={join}
          disabled={!ready || joining}
          aria-live="polite"
          className={cn(
            pill(),
            // The design's resting state: sand until the code is complete.
            !ready &&
              "bg-muted text-muted-foreground hover:bg-muted hover:text-muted-foreground disabled:opacity-100",
          )}
        >
          {joining
            ? "Joining…"
            : ready && org
              ? `Join ${org.name}`
              : complete && checking
                ? "Finding your organization…"
                : `Enter all ${code.length} characters`}
        </button>
      )}

      <div className="text-muted-foreground flex justify-between gap-4 text-[14px]">
        <Link href="/onboarding/organization" className="text-muted-foreground font-semibold">
          Starting a new organization instead?
        </Link>
        <button
          type="button"
          onClick={() => {
            edit(emptyCode());
            setTimeout(() => boxes.current?.querySelector("input")?.focus(), 0);
          }}
          className="text-muted-foreground cursor-pointer border-none bg-transparent p-0 font-semibold"
        >
          Clear
        </button>
      </div>
    </>
  );
}
