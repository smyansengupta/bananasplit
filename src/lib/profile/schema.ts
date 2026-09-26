import { z } from "zod";

import { isLinkKind, MAX_LINKS, normalizeLinkUrl, type ProfileLink } from "./links";
import { isValidTimeZone } from "./timezone";

/**
 * The profile forms (Phase 2): what a user may set on their own User row.
 * Shared by the client forms and the Server Actions, which re-validate
 * everything. Limits: name 1-80, pronouns 40, major 80, bio 1000, gradYear
 * 1950-2100, up to 8 links, an IANA timezone or null (follow the org).
 * Titles are not here: they are per org and set by admins in Settings.
 */

export const PROFILE_LIMITS = {
  name: 80,
  pronouns: 40,
  major: 80,
  bio: 1000,
  gradYearMin: 1950,
  gradYearMax: 2100,
} as const;

/** Trimmed text; empty (or missing) becomes null. */
function optionalText(max: number, label: string) {
  return z
    .string()
    .transform((s) => s.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().max(max, `${label} is limited to ${max} characters.`))
    .transform((s) => (s.length === 0 ? null : s))
    .nullable()
    .optional()
    .transform((v) => v ?? null);
}

export const profileLinkSchema = z
  .object({ kind: z.string(), url: z.string().max(2048, "That link is too long.") })
  .strict()
  .transform((link, ctx): ProfileLink => {
    if (!isLinkKind(link.kind)) {
      ctx.addIssue({ code: "custom", message: "Pick a link type.", path: ["kind"] });
      return z.NEVER;
    }
    const result = normalizeLinkUrl(link.kind, link.url);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.error, path: ["url"] });
      return z.NEVER;
    }
    return { kind: link.kind, url: result.url };
  });

const detailsShape = {
  name: z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, "Enter your name.")
        .max(PROFILE_LIMITS.name, `Name is limited to ${PROFILE_LIMITS.name} characters.`),
    ),
  pronouns: optionalText(PROFILE_LIMITS.pronouns, "Pronouns"),
  major: optionalText(PROFILE_LIMITS.major, "Major"),
  gradYear: z
    .number("Enter a year.")
    .int("Enter a year.")
    .min(PROFILE_LIMITS.gradYearMin, "Enter a four-digit year.")
    .max(PROFILE_LIMITS.gradYearMax, "Enter a four-digit year.")
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  bio: optionalText(PROFILE_LIMITS.bio, "Bio"),
  timezone: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .refine((v) => v === null || isValidTimeZone(v), "Pick a timezone from the list."),
};

const linksShape = {
  links: z
    .array(profileLinkSchema)
    .max(MAX_LINKS, `Add at most ${MAX_LINKS} links.`)
    .optional()
    .transform((v) => v ?? []),
};

/** The Details section: name, pronouns, major and year, bio, timezone. */
export const profileDetailsSchema = z.object(detailsShape).strict();

/** The Links section. */
export const profileLinksSchema = z.object(linksShape).strict();

/** Everything a user can edit on their profile at once. */
export const profileInputSchema = z.object({ ...detailsShape, ...linksShape }).strict();

export type ProfileDetailsInput = z.input<typeof profileDetailsSchema>;
export type ProfileDetailsValues = z.output<typeof profileDetailsSchema>;
export type ProfileLinksInput = z.input<typeof profileLinksSchema>;
export type ProfileLinksValues = z.output<typeof profileLinksSchema>;
export type ProfileInput = z.input<typeof profileInputSchema>;
export type ProfileValues = z.output<typeof profileInputSchema>;

/** Field -> first error message, for the forms. Link errors use "links.{i}.url". */
export function profileFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
