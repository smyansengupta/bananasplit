"use client";

import { useMemo, useState } from "react";

import { Chip, FieldError } from "@/components/onboarding/step-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  gradYearChoices,
  joinMajor,
  MAX_TITLE,
  ROLE_CHOICES,
  splitMajor,
} from "@/lib/onboarding/steps";
import { PROFILE_LIMITS } from "@/lib/profile/schema";

import { saveSchoolStep } from "./actions";
import { StepNav, useStepSave } from "./step-nav";

const OTHER = "__other__";

/** A2 · School + role: major (and a second one), grad year, role. */
export function SchoolStep({
  initial,
}: {
  initial: { major: string | null; gradYear: number | null; preferredTitle: string | null };
}) {
  const { pending, errors, saveAndContinue } = useStepSave("school");
  const [first, second] = splitMajor(initial.major);
  const [major, setMajor] = useState(first);
  const [minor, setMinor] = useState(second);
  const [showMinor, setShowMinor] = useState(second !== "");
  const years = useMemo(() => gradYearChoices(), []);
  const [gradYear, setGradYear] = useState<number | null>(initial.gradYear);
  const [otherYear, setOtherYear] = useState(
    initial.gradYear !== null && !years.includes(initial.gradYear) ? String(initial.gradYear) : "",
  );
  const [yearOther, setYearOther] = useState(otherYear !== "");
  const knownRole =
    initial.preferredTitle && (ROLE_CHOICES as readonly string[]).includes(initial.preferredTitle);
  const [role, setRole] = useState<string>(
    initial.preferredTitle ? (knownRole ? initial.preferredTitle : OTHER) : "",
  );
  const [customRole, setCustomRole] = useState(knownRole ? "" : (initial.preferredTitle ?? ""));

  const joined = joinMajor(major, showMinor ? minor : "");
  const tooLong = joined.length > PROFILE_LIMITS.major;

  function submit() {
    const year = yearOther ? (otherYear.trim() ? Number(otherYear) : null) : gradYear;
    saveAndContinue(() =>
      saveSchoolStep({
        major: joined || null,
        gradYear: year,
        preferredTitle: role === OTHER ? customRole : role || null,
      }),
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-1.5">
        <Label htmlFor="ob-major" className="text-xs">
          Major
        </Label>
        <Input
          id="ob-major"
          value={major}
          placeholder="Computer Science"
          onChange={(e) => setMajor(e.target.value)}
          aria-invalid={Boolean(errors.major) || tooLong || undefined}
        />
        {showMinor ? (
          <Input
            aria-label="Second major or minor"
            autoFocus={second === ""}
            value={minor}
            placeholder="Second major or minor"
            onChange={(e) => setMinor(e.target.value)}
          />
        ) : (
          <button
            type="button"
            className="text-primary w-fit text-xs hover:underline"
            onClick={() => setShowMinor(true)}
          >
            + Add a second major or minor
          </button>
        )}
        <FieldError
          message={
            tooLong
              ? `Keep majors under ${PROFILE_LIMITS.major} characters in total.`
              : errors.major
          }
        />
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium" id="ob-year-label">
          Grad year
        </span>
        <div className="grid grid-cols-5 gap-1.5" role="group" aria-labelledby="ob-year-label">
          {years.map((y) => (
            <Chip
              key={y}
              shape="box"
              selected={!yearOther && gradYear === y}
              onClick={() => {
                setYearOther(false);
                setGradYear(gradYear === y ? null : y);
              }}
            >
              {y}
            </Chip>
          ))}
          <Chip shape="box" selected={yearOther} onClick={() => setYearOther(!yearOther)}>
            Other
          </Chip>
        </div>
        {yearOther && (
          <Input
            aria-label="Graduation year"
            inputMode="numeric"
            placeholder="e.g. 2031"
            maxLength={4}
            value={otherYear}
            onChange={(e) => setOtherYear(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
        )}
        <FieldError message={errors.gradYear} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="ob-role" className="text-xs">
          Your role
        </Label>
        <select
          id="ob-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="border-input bg-background focus-visible:ring-ring/50 h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-3"
        >
          <option value="">Pick a role</option>
          {ROLE_CHOICES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          <option value={OTHER}>Something else…</option>
        </select>
        {role === OTHER && (
          <Input
            aria-label="Your role"
            placeholder="e.g. Head of Partnerships"
            maxLength={MAX_TITLE}
            value={customRole}
            onChange={(e) => setCustomRole(e.target.value)}
            autoFocus
          />
        )}
        <p className="text-muted-foreground text-xs">Admins can change this later.</p>
        <FieldError message={errors.preferredTitle} />
      </div>

      <FieldError message={errors.form} />
      <StepNav step="school" pending={pending} onContinue={submit} disabled={tooLong} />
    </div>
  );
}
