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

/**
 * The demo request: four fields and an optional note, then on. Team size is
 * five buttons rather than a dropdown; a signed-in visitor's name and email
 * are already filled in.
 */
export function DemoForm({ initial }: { initial?: { name?: string; email?: string } } = {}) {
  const [state, formAction, isPending] = useActionState<DemoState, FormData>(requestDemoAction, {});

  const v: Record<string, string | undefined> = state.values ?? initial ?? {};

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
        <BrandInput id="name" name="name" defaultValue={v.name} required autoComplete="name" />
      </BrandField>
      <BrandField id="email" label="Work email">
        <BrandInput
          id="email"
          name="email"
          defaultValue={v.email}
          type="email"
          required
          autoComplete="email"
        />
      </BrandField>
      <BrandField id="organization" label="Organization">
        <BrandInput
          id="organization"
          name="organization"
          defaultValue={v.organization}
          required
          autoComplete="organization"
        />
      </BrandField>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-[14px] font-semibold">Team size</legend>
        <div className="flex flex-wrap gap-2">
          {TEAM_SIZES.map((size, i) => (
            <label key={size} className="cursor-pointer">
              <input
                type="radio"
                name="size"
                value={size}
                required={i === 0}
                defaultChecked={v.size === size}
                className="peer sr-only"
              />
              <span className="border-input text-foreground peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-foreground hover:bg-muted inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium peer-checked:border-transparent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
                {size}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <BrandField id="message" label="What would you like to see?">
        <textarea
          id="message"
          name="message"
          rows={3}
          maxLength={2000}
          defaultValue={v.message}
          placeholder="Optional"
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
