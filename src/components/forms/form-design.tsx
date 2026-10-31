"use client";

import { Check } from "@/components/icons";
import { useEffect, useRef, useState } from "react";

import { saveDesignAction } from "@/app/app/[orgSlug]/forms/actions";
import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import {
  accentVar,
  buttonWord,
  COVER_LABELS,
  FORM_COVERS,
  thanksLine,
  type FormDesign,
} from "@/lib/forms/design";
import { TAG_COLOR_NAMES, TAG_COLORS, type TagColor } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";

const TYPING_MS = 600;

/**
 * Design: how the answer page looks. An accent from the organization's
 * palette (or its own theme colour), a cover across the top, the wording on
 * the next button and the thank-you heading, with a small picture of the
 * page beside it. Everything saves as you change it.
 */
export function FormDesignPanel({
  orgId,
  formId,
  initial,
  title,
}: {
  orgId: string;
  formId: string;
  initial: FormDesign;
  title: string;
}) {
  const [design, setDesign] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { status, error, save } = useSaveOnChange(async (json: string) => {
    const result = await saveDesignAction(orgId, formId, JSON.parse(json));
    if (result.error) return result.error;
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function change(patch: Partial<FormDesign>, typing = false) {
    const next = { ...design, ...patch };
    setDesign(next);
    if (timer.current) clearTimeout(timer.current);
    const send = () => void save(JSON.stringify(next));
    if (typing) timer.current = setTimeout(send, TYPING_MS);
    else send();
  }

  const swatches: { id: TagColor | null; name: string }[] = [
    { id: null, name: "Organization" },
    ...TAG_COLORS.map((c) => ({ id: c, name: TAG_COLOR_NAMES[c] })),
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section className="bg-card edge rounded-card space-y-5 p-5">
        <div className="grid gap-2">
          <Label>Accent</Label>
          <div role="radiogroup" aria-label="Accent" className="flex flex-wrap gap-2">
            {swatches.map((s) => {
              const on = design.accent === s.id;
              return (
                <button
                  key={s.id ?? "org"}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={s.name}
                  title={s.name}
                  onClick={() => change({ accent: s.id })}
                  className={cn(
                    "focus-visible:outline-foreground grid size-8 place-items-center rounded-full ring-offset-2 outline-none focus-visible:outline-2",
                    on && "ring-foreground ring-2",
                  )}
                  style={{ background: accentVar(s.id) }}
                >
                  {on && (
                    <Check
                      className="size-4"
                      style={{
                        color: `oklch(from ${accentVar(s.id)} clamp(0, (0.62 - l) * 1000, 1) 0 0)`,
                      }}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Cover</Label>
          <Segmented
            label="Cover"
            value={design.cover}
            onSelect={(v) => change({ cover: v as FormDesign["cover"] })}
            options={FORM_COVERS.map((c) => ({ value: c, label: COVER_LABELS[c] }))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="d-button">Button</Label>
          <Input
            id="d-button"
            value={design.button}
            maxLength={24}
            placeholder="OK"
            onChange={(e) => change({ button: e.target.value }, true)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="d-thanks">Thank-you</Label>
          <Input
            id="d-thanks"
            value={design.thanks}
            maxLength={200}
            placeholder="Thanks, {name}."
            onChange={(e) => change({ thanks: e.target.value }, true)}
          />
          <p className="text-muted-foreground text-[12px]">
            {"{name}"} is the person&apos;s first name.
          </p>
        </div>
        <SavedMark status={status} error={error} />
      </section>

      <DesignPreview design={design} title={title} />
    </div>
  );
}

/** A small picture of the answer page with this design. */
function DesignPreview({ design, title }: { design: FormDesign; title: string }) {
  const accent = accentVar(design.accent);
  const ink = `oklch(from ${accent} clamp(0, (0.62 - l) * 1000, 1) 0 0)`;
  return (
    <section
      aria-label="Preview"
      className="bg-background edge rounded-card relative min-h-[22rem] overflow-hidden"
    >
      {design.cover === "band" && <div className="h-14" style={{ background: accent }} />}
      {design.cover === "wash" && (
        <div
          className="absolute inset-x-0 top-0 h-40"
          style={{
            background: `linear-gradient(to bottom, color-mix(in oklab, ${accent} 16%, transparent), transparent)`,
          }}
        />
      )}
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: accent, width: "38%" }} />
      <div className="relative space-y-5 p-8">
        <p className="display-title text-[22px] leading-snug">
          <span className="text-muted-foreground me-2 text-[0.7em]">1.</span>
          {title || "Your first question"}
        </p>
        <div className="grid max-w-xs gap-2">
          {["A", "B"].map((l, i) => (
            <span
              key={l}
              className="flex items-center gap-2.5 rounded-[12px] border px-3 py-2 text-[14px]"
              style={{
                borderColor: `color-mix(in oklab, ${accent} 40%, var(--border))`,
                background: `color-mix(in oklab, ${accent} ${i === 0 ? 14 : 5}%, transparent)`,
              }}
            >
              <span
                className="grid size-5 place-items-center rounded-[6px] border text-[11px] font-semibold"
                style={{ borderColor: accent, color: accent }}
              >
                {l}
              </span>
              {i === 0 ? "A choice" : "Another choice"}
            </span>
          ))}
        </div>
        <span
          className="inline-flex h-9 items-center rounded-full px-4 text-[14px] font-semibold"
          style={{ background: accent, color: ink }}
        >
          {buttonWord(design, false)}
        </span>
        <p className="text-muted-foreground border-t pt-4 text-[13px]">
          At the end: {thanksLine(design, "Jordan")}
        </p>
      </div>
    </section>
  );
}
