"use client";

import { BookOpen, GraduationCap, Plus } from "@/components/icons";
import { useMemo, useState } from "react";

import { MajorInput } from "@/components/onboarding/major-input";
import { Chip, FieldError, FieldLabel } from "@/components/onboarding/step-fields";
import { gradYearChoices, joinMajor, splitMajor } from "@/lib/onboarding/steps";
import { PROFILE_LIMITS } from "@/lib/profile/schema";

import { saveSchoolStep } from "./actions";
import { StepNav, useStepSave } from "./step-nav";

/**
 * Step 2 · School: major (and a second one) and grad year. About you, not
 * a club: your role is per club, picked when you join one.
 */
export function SchoolStep({
  initial,
}: {
  initial: { major: string | null; gradYear: number | null };
}) {
  const { pending, errors, saveAndContinue } = useStepSave("school");
  const [first, second] = splitMajor(initial.major);
  const [major, setMajor] = useState(first);
  const [minor, setMinor] = useState(second);
  const [showMinor, setShowMinor] = useState(second !== "");
  const allYears = useMemo(() => gradYearChoices(new Date(), 8), []);
  const years = allYears.slice(0, 4);
  const laterYears = allYears.slice(4);
  const [gradYear, setGradYear] = useState<number | null>(
    initial.gradYear !== null && allYears.includes(initial.gradYear) ? initial.gradYear : null,
  );
  const [yearOther, setYearOther] = useState(gradYear !== null && laterYears.includes(gradYear));

  const joined = joinMajor(major, showMinor ? minor : "");
  const tooLong = joined.length > PROFILE_LIMITS.major;

  function submit() {
    saveAndContinue(() => saveSchoolStep({ major: joined || null, gradYear }));
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="grid gap-1.5">
        <FieldLabel htmlFor="ob-major" icon={BookOpen}>
          Major
        </FieldLabel>
        <MajorInput
          id="ob-major"
          value={major}
          onChange={setMajor}
          aria-invalid={Boolean(errors.major) || tooLong || undefined}
        />
        {showMinor ? (
          <MajorInput
            aria-label="Second major or minor"
            autoFocus={second === ""}
            value={minor}
            placeholder="Second major or minor"
            onChange={setMinor}
          />
        ) : (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs"
            onClick={() => setShowMinor(true)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add a second major or minor
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
        <FieldLabel id="ob-year-label" icon={GraduationCap}>
          Grad year
        </FieldLabel>
        <div className="grid grid-cols-5 gap-1.5" role="group" aria-labelledby="ob-year-label">
          {years.map((y) => (
            <Chip
              key={y}
              shape="box"
              selected={gradYear === y}
              onClick={() => {
                setYearOther(false);
                setGradYear(gradYear === y ? null : y);
              }}
            >
              {y}
            </Chip>
          ))}
          <Chip
            shape="box"
            selected={yearOther}
            onClick={() => {
              if (yearOther && gradYear !== null && laterYears.includes(gradYear))
                setGradYear(null);
              setYearOther(!yearOther);
            }}
          >
            Later
          </Chip>
        </div>
        {yearOther && (
          <div
            className="grid grid-cols-4 gap-1.5"
            role="group"
            aria-label="Later graduation years"
          >
            {laterYears.map((y) => (
              <Chip
                key={y}
                shape="box"
                selected={gradYear === y}
                onClick={() => setGradYear(gradYear === y ? null : y)}
              >
                {y}
              </Chip>
            ))}
          </div>
        )}
        <FieldError message={errors.gradYear} />
      </div>

      <FieldError message={errors.form} />
      <StepNav step="school" pending={pending} onContinue={submit} disabled={tooLong} />
    </div>
  );
}
