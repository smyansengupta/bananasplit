"use client";

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
import { clearInvalid, highlightInvalid } from "@/lib/forms/highlight-invalid";

/** The demo request: four fields and an optional note, then on to creating the organization. */
export function DemoForm() {
  const [state, formAction, isPending] = useActionState<DemoState, FormData>(requestDemoAction, {});

  const v = state.values ?? {};

  return (
    <form
      noValidate
      onSubmit={highlightInvalid}
      onInput={clearInvalid}
      key={JSON.stringify(v)}
      action={formAction}
      className="flex flex-col gap-[18px]"
    >
      {/* For bots only (DEMO_HONEYPOT): off screen, out of the tab order, never read out. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="demo-website">Website</label>
        <input id="demo-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <BrandField id="name" label="Your name">
        <BrandInput
          id="name"
          name="name"
          defaultValue={v.name}
          required
          autoComplete="name"
          placeholder="Your name"
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
          placeholder="Work email"
        />
      </BrandField>
      <BrandField id="organization" label="Organization">
        <BrandInput
          id="organization"
          name="organization"
          defaultValue={v.organization}
          required
          autoComplete="organization"
          placeholder="Organization"
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
            Team size
          </option>
          {TEAM_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} people
            </option>
          ))}
        </select>
      </BrandField>
      <BrandField id="message" label="What would you like to see?">
        <textarea
          id="message"
          name="message"
          rows={3}
          maxLength={2000}
          defaultValue={v.message}
          placeholder="What would you like to see? (optional)"
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
