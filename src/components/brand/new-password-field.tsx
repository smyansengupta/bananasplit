"use client";

import { Eye, EyeOff } from "@/components/icons";
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
 * A new password (sign-up, password reset), typed once: the field with its
 * strength ring, and an eye button that shows what was typed. Seeing it
 * does the job a second "Confirm password" field used to, in one field
 * instead of two. Posts as `password`.
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
  const [shown, setShown] = useState(false);
  const strength = passwordStrength(password);
  const Toggle = shown ? EyeOff : Eye;
  return (
    <BrandField id="password" label={label}>
      <div className="relative">
        <BrandInput
          id="password"
          name="password"
          type={shown ? "text" : "password"}
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          autoFocus={autoFocus}
          placeholder={label}
          className={cn("pr-20", inputClassName)}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-strength"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-10 grid size-8 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-current"
        >
          <Toggle className="size-4" aria-hidden="true" />
        </button>
        <StrengthRing strength={strength} />
      </div>
    </BrandField>
  );
}
