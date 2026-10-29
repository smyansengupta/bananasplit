"use client";

import { Check } from "@/components/icons";
import { useState } from "react";

import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { passwordStrength, type PasswordStrength } from "@/lib/auth/password-strength";
import { cn } from "@/lib/utils";

import { BrandField, BrandInput } from "./fields";

/** The ring's colour at each score: fixed tag colours, so they read the same in any theme. */
const RING_TONE: Record<PasswordStrength["score"], string> = {
  0: "text-transparent",
  1: "text-(--tag-rust)",
  2: "text-(--tag-ochre)",
  3: "text-(--tag-forest)",
};

/**
 * A ring inside the field's right edge that fills a third per strength
 * step, in red, amber, then green; the word ("Weak", "Strong") is its
 * accessible name and its tooltip.
 */
function StrengthRing({ strength }: { strength: PasswordStrength }) {
  const r = 8;
  const length = 2 * Math.PI * r;
  return (
    <span
      id="password-strength"
      role="img"
      aria-live="polite"
      aria-label={strength.label ? `Password strength: ${strength.label}` : "Password strength"}
      title={strength.label || undefined}
      className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
    >
      <svg viewBox="0 0 20 20" className="size-5 -rotate-90" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          strokeWidth="2.5"
          className="stroke-muted-strong"
        />
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - strength.score / 3)}
          className={cn(
            "transition-[stroke-dashoffset,color] duration-300",
            RING_TONE[strength.score],
          )}
        />
      </svg>
    </span>
  );
}

/**
 * A new password (sign-up, password reset), typed twice: the field with
 * its strength ring on the right, then Confirm password, which says when
 * the two don't match (and ticks when they do). The server checks the
 * match too. Posts as `password` and `confirmPassword`.
 */
export function NewPasswordField({
  label = "Password",
  autoFocus = false,
  inputClassName,
}: {
  label?: string;
  autoFocus?: boolean;
  inputClassName?: string;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const strength = passwordStrength(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const matches = confirm.length > 0 && confirm === password;
  return (
    <>
      <BrandField id="password" label={label}>
        <div className="relative">
          <BrandInput
            id="password"
            name="password"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            autoFocus={autoFocus}
            placeholder={label}
            className={cn("pr-11", inputClassName)}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="password-strength"
          />
          <StrengthRing strength={strength} />
        </div>
      </BrandField>
      <BrandField id="confirmPassword" label="Confirm password">
        <div className="relative">
          <BrandInput
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Confirm password"
            className={cn("pr-11", inputClassName)}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? "password-match" : undefined}
          />
          {matches && (
            <Check
              className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-(--tag-forest)"
              strokeWidth={3}
              aria-label="Passwords match"
            />
          )}
        </div>
        {mismatch && (
          <span id="password-match" className="text-destructive text-[13px]">
            Doesn&apos;t match.
          </span>
        )}
      </BrandField>
    </>
  );
}
