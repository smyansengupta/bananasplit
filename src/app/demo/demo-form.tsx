"use client";

import { Check } from "@/components/icons";
import { useActionState } from "react";

import {
  BrandField,
  BrandInput,
  brandInputClass,
  FormMessage,
  PrimaryButton,
} from "@/components/brand/fields";
import { cn } from "@/lib/utils";

import { requestDemoAction, type DemoState } from "./actions";
import { TEAM_SIZES } from "./sizes";

/** The demo request: four fields and an optional note, then a thank-you in place. */
export function DemoForm() {
  const [state, formAction, isPending] = useActionState<DemoState, FormData>(requestDemoAction, {});

  const v = state.values ?? {};

  if (state.sent) {
    return (
      <div role="status" className="flex flex-col items-start gap-3">
        <span className="bg-tint-success text-tint-success-foreground grid size-10 place-items-center rounded-full">
          <Check className="size-5" strokeWidth={2.5} aria-hidden="true" />
        </span>
        <h2 className="display-title text-[28px]">Thanks. We&apos;ll be in touch within a day.</h2>
        <p className="text-muted-foreground text-[15px] leading-[1.55]">
          We&apos;ll email you to pick a time and show you Bananasplit set up for your team.
        </p>
      </div>
    );
  }

  return (
    <form key={JSON.stringify(v)} action={formAction} className="flex flex-col gap-[18px]">
      <BrandField id="name" label="Your name">
        <BrandInput
          id="name"
          name="name"
          defaultValue={v.name}
          required
          autoComplete="name"
          placeholder="Alex Rivera"
        />
      </BrandField>
      <BrandField id="email" label="Work email">
        <BrandInput
          id="email"
          name="email"
          defaultValue={v.email}
          type="email"
          required
          autoComplete="email"
          placeholder="alex@company.com"
        />
      </BrandField>
      <BrandField id="organization" label="Organization">
        <BrandInput
          id="organization"
          name="organization"
          defaultValue={v.organization}
          required
          autoComplete="organization"
          placeholder="Orbit Labs"
        />
      </BrandField>
      <BrandField id="size" label="Team size">
        <select
          id="size"
          name="size"
          required
          defaultValue={v.size ?? ""}
          className={cn(brandInputClass, "cursor-pointer appearance-none")}
        >
          <option value="" disabled>
            Pick one
          </option>
          {TEAM_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} people
            </option>
          ))}
        </select>
      </BrandField>
      <BrandField id="message" label="What would you like to see? (optional)">
        <textarea
          id="message"
          name="message"
          rows={3}
          maxLength={2000}
          defaultValue={v.message}
          placeholder="We run three programs and want one place for tasks, events and the budget."
          className={cn(brandInputClass, "h-auto min-h-24 py-2.5")}
        />
      </BrandField>
      {state.error && <FormMessage>{state.error}</FormMessage>}
      <PrimaryButton type="submit" disabled={isPending}>
        {isPending ? "Sending…" : "Request a demo"}
      </PrimaryButton>
    </form>
  );
}
