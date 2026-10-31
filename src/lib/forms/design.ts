import { z } from "zod";

import { TAG_COLORS, type TagColor } from "@/lib/tag-colors";

/**
 * How a form's answer page looks (Form.design), set on its Design tab:
 * an accent from the organization palette (null: the organization's own
 * theme colour), a cover across the top, the wording on the next button,
 * and what the thank-you screen says. Validated here, never trusted.
 */

export const FORM_COVERS = ["none", "wash", "band"] as const;
export type FormCover = (typeof FORM_COVERS)[number];

export const COVER_LABELS: Record<FormCover, string> = {
  none: "None",
  wash: "Soft wash",
  band: "Colour band",
};

export const designSchema = z.object({
  accent: z.enum(TAG_COLORS).nullable().default(null),
  cover: z.enum(FORM_COVERS).default("none"),
  /** The next button's word ("OK", "Next"). */
  button: z.string().trim().max(24).default(""),
  /** The thank-you screen's heading; the person's first name goes in for {name}. */
  thanks: z.string().trim().max(200).default(""),
});

export type FormDesign = z.infer<typeof designSchema>;

export const DEFAULT_DESIGN: FormDesign = { accent: null, cover: "none", button: "", thanks: "" };

/** The stored design, defaulted; anything that doesn't fit is dropped. */
export function readDesign(raw: unknown): FormDesign {
  const parsed = designSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_DESIGN;
}

/** The accent as a CSS value: a palette colour, or the organization's primary. */
export function accentVar(accent: TagColor | null): string {
  return accent ? `var(--tag-${accent})` : "var(--primary)";
}

/** The next button's word. */
export function buttonWord(design: FormDesign, last: boolean): string {
  if (last) return "Submit";
  return design.button || "OK";
}

/**
 * The thank-you heading: the form's own, with {name} filled in, or
 * "Thanks, Jordan." when the person gave a name.
 */
export function thanksLine(design: FormDesign, firstName: string | null): string {
  if (design.thanks) {
    return design.thanks
      .replace(/\{name\}/g, firstName ?? "")
      .replace(/\s+([,.!?])/g, "$1")
      .trim();
  }
  return firstName ? `Thanks, ${firstName}.` : "Thanks.";
}
