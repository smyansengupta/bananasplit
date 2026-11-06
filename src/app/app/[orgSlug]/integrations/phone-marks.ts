import type { Brand } from "@/components/marketing/brands";

/** The Telnyx, Twilio and Deepgram tiles' own colours and letters (a maker's colour is not a theme colour). */

const mark = (name: string, slug: string, color: string, ink: string, letters: string): Brand => ({
  name,
  slug,
  group: "inbox",
  color,
  ink,
  mark: letters,
});

export const PHONE_MARKS: Record<"telnyx" | "twilio" | "deepgram", Brand> = {
  telnyx: mark("Telnyx", "telnyx", "#00E3AA", "#0B1F1A", "Tx"),
  twilio: mark("Twilio", "twilio", "#F22F46", "#FFFFFF", "Tw"),
  deepgram: mark("Deepgram", "deepgram", "#13EF93", "#101014", "Dg"),
};
