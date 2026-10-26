"use client";

import { CalendarPlus, Check, Hourglass, Lock, Video } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cancelMyRegistration, registerForEvent } from "@/app/e/[slug]/actions";
import { BrandField, BrandInput, FormMessage } from "@/components/brand/fields";
import { pill } from "@/components/brand/pill";
import type { ClosedReason } from "@/lib/rsvp/format";
import { formatCents } from "@/lib/rsvp/pay";
import { cn } from "@/lib/utils";

/**
 * The card on a public RSVP page: the sign-up form (name, email, phone),
 * or what this browser's guest has: "You're going" with the calendar and
 * Can't go, or their place on the waitlist. A Moonstone surface card in the
 * club's theme, with a display title and 40px fields.
 */

export interface RegistrationCardProps {
  slug: string;
  viewer: {
    status: "GOING" | "WAITLIST";
    firstName: string;
    email: string;
    waitlistPosition: number | null;
  } | null;
  closed: ClosedReason | null;
  waitlistOnly: boolean;
  spotsLeft: number | null;
  joinUrl: string | null;
  googleCalendarUrl: string;
  icsUrl: string;
  /** The invite code of the link this visitor came from (?via=). */
  via?: string | null;
  /** Split the cost: what a new guest would chip in, for the form's note. */
  cost?: { mode: "EACH" | "SPLIT"; shareIfJoining: number; payWith: string[] } | null;
  /** Under "You're going": chip in, the ticket, bring friends. */
  signedExtras?: React.ReactNode;
}

const CLOSED_COPY: Record<ClosedReason, { title: string; body: string }> = {
  ended: { title: "This event has ended", body: "Registration closed when it finished." },
  closed: { title: "Registration is closed", body: "The host isn't taking more sign-ups." },
  full: { title: "This event is full", body: "Every spot is taken and there's no waitlist." },
};

export function RegistrationCard(props: RegistrationCardProps) {
  return (
    <section
      aria-label="Registration"
      className="bg-card text-foreground edge rounded-card p-6 sm:p-7"
    >
      {props.viewer ? (
        <Signed {...props} viewer={props.viewer} />
      ) : props.closed ? (
        <Closed reason={props.closed} />
      ) : (
        <SignUpForm {...props} />
      )}
    </section>
  );
}

function CardHeader({ title, badge }: { title: string; badge?: React.ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h2 className="display-title m-0 text-[26px]">{title}</h2>
      {badge}
    </div>
  );
}

function Closed({ reason }: { reason: ClosedReason }) {
  const copy = CLOSED_COPY[reason];
  return (
    <>
      <div className="flex items-center gap-4">
        <span className="bg-muted text-muted-foreground grid size-12 flex-none place-items-center rounded-full">
          <Lock className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <h2 className="display-title m-0 text-[23px]">{copy.title}</h2>
          <span className="text-muted-foreground text-[14px]">{copy.body}</span>
        </span>
      </div>
    </>
  );
}

function SpotsBadge({
  spotsLeft,
  waitlistOnly,
}: {
  spotsLeft: number | null;
  waitlistOnly: boolean;
}) {
  if (waitlistOnly) {
    return (
      <span className="bg-tint-accent text-tint-accent-foreground inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold">
        <span className="bg-glow size-1.5 rounded-full" aria-hidden="true" />
        Waitlist open
      </span>
    );
  }
  // The people card says how many are left; this only warns when few are.
  if (spotsLeft === null || spotsLeft > 5) return null;
  return (
    <span className="bg-tint-danger text-tint-danger-foreground inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold whitespace-nowrap tabular-nums">
      <span className="bg-destructive size-1.5 rounded-full" aria-hidden="true" />
      Only {spotsLeft} left
    </span>
  );
}

function SignUpForm({ slug, waitlistOnly, spotsLeft, via, cost }: RegistrationCardProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [exists, setExists] = useState(false);
  // Controlled, so what the guest typed survives an error: React resets a
  // form's uncontrolled fields after every action.
  const [values, setValues] = useState({ name: "", email: "", phone: "", instagram: "" });
  const bind = (field: keyof typeof values) => ({
    value: values[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setValues((v) => ({ ...v, [field]: e.target.value })),
  });

  function submit(form: FormData) {
    setError(null);
    start(async () => {
      const result = await registerForEvent({
        slug,
        ...values,
        website: String(form.get("website") ?? ""),
        via: via ?? "",
      });
      if (!result.ok) {
        setError({ message: result.error, field: result.field });
        return;
      }
      if (result.status === "EXISTS") {
        setExists(true);
        return;
      }
      router.refresh();
    });
  }

  if (exists) {
    return (
      <>
        <CardHeader title="You're already on the list" />
        <FormMessage tone="info">
          That email is already signed up. We&apos;ve sent it a link to see or change your spot.
        </FormMessage>
      </>
    );
  }

  const invalid = (field: string) =>
    error?.field === field
      ? ({ "aria-invalid": true, "aria-describedby": "rsvp-error" } as const)
      : {};

  return (
    <>
      <CardHeader
        title={waitlistOnly ? "Join the waitlist" : "Save your spot"}
        badge={<SpotsBadge spotsLeft={spotsLeft} waitlistOnly={waitlistOnly} />}
      />
      <p className="text-muted-foreground mb-6 text-[15px] leading-[1.5]">
        {waitlistOnly
          ? "This event is full. Join the waitlist and we'll email you the moment a spot opens up."
          : "It takes a few seconds. You'll get a confirmation by email."}
      </p>
      {cost && !waitlistOnly && (
        <p className="bg-muted/60 text-foreground rounded-tile -mt-2 mb-6 px-4 py-3 text-[14px] leading-[1.5]">
          <span className="font-semibold">
            {cost.mode === "SPLIT" ? "About " : ""}
            {formatCents(cost.shareIfJoining)} to chip in
          </span>
          <span className="text-muted-foreground">
            {" "}
            {cost.mode === "SPLIT" ? "(your share, and it shrinks as more people join)" : "each"}
            {cost.payWith.length > 0
              ? `. You'll pay the host with ${cost.payWith.join(" or ")} after you sign up.`
              : ". You'll settle up with the host."}
          </span>
        </p>
      )}
      <form
        action={submit}
        className="[&_input]:bg-background grid gap-4 sm:grid-cols-2"
        noValidate
      >
        <BrandField id="rsvp-name" label="Name">
          <BrandInput
            id="rsvp-name"
            name="name"
            autoComplete="name"
            placeholder="Your full name"
            required
            maxLength={100}
            {...bind("name")}
            {...invalid("name")}
          />
        </BrandField>
        <BrandField id="rsvp-email" label="Email">
          <BrandInput
            id="rsvp-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            required
            maxLength={254}
            {...bind("email")}
            {...invalid("email")}
          />
        </BrandField>
        <BrandField id="rsvp-phone" label="Phone">
          <BrandInput
            id="rsvp-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="(555) 123-4567"
            required
            maxLength={32}
            {...bind("phone")}
            {...invalid("phone")}
          />
        </BrandField>
        <BrandField
          id="rsvp-instagram"
          label={
            <>
              Instagram <span className="text-muted-foreground font-normal">(optional)</span>
            </>
          }
        >
          <BrandInput
            id="rsvp-instagram"
            name="instagram"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="@yourhandle"
            maxLength={200}
            aria-describedby="rsvp-instagram-hint"
            {...bind("instagram")}
            {...invalid("instagram")}
          />
          <span id="rsvp-instagram-hint" className="text-muted-foreground text-[13px]">
            Shown next to your name on the guest list, so people can find you.
          </span>
        </BrandField>
        {/* People never see this; bots fill it in. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="rsvp-website">Website</label>
          <input id="rsvp-website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        {error && (
          <div id="rsvp-error" className="sm:col-span-2">
            <FormMessage>{error.message}</FormMessage>
          </div>
        )}
        <button
          type="submit"
          disabled={pending}
          className={cn(pill({ size: "md" }), "h-12 w-full text-[16px] sm:col-span-2")}
        >
          {pending ? "Saving your spot…" : waitlistOnly ? "Join the waitlist" : "Register"}
        </button>
        <p className="text-muted-foreground m-0 text-[12px] leading-[1.5] sm:col-span-2">
          We&apos;ll email your confirmation and text you a reminder before it starts. Message and
          data rates may apply; reply STOP to opt out of texts. Only the hosts see your email and
          number.
        </p>
      </form>
    </>
  );
}

function Signed({
  slug,
  viewer,
  joinUrl,
  googleCalendarUrl,
  icsUrl,
  signedExtras,
}: RegistrationCardProps & { viewer: NonNullable<RegistrationCardProps["viewer"]> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const going = viewer.status === "GOING";

  function cancel() {
    setError(null);
    start(async () => {
      const result = await cancelMyRegistration({ slug });
      if (!result.ok) {
        setError(result.error ?? "That didn't work. Try again.");
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "grid size-12 flex-none place-items-center rounded-full",
            going
              ? "bg-block-goal text-block-goal-foreground rsvp-pop"
              : "hatch bg-muted text-foreground",
          )}
        >
          {going ? (
            <Check className="size-6" strokeWidth={2.4} aria-hidden="true" />
          ) : (
            <Hourglass className="size-5" strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="display-title m-0 text-[26px]">
            {going ? `You're going, ${viewer.firstName}!` : "You're on the waitlist"}
          </h2>
          <p className="text-muted-foreground m-0 text-[14px] leading-[1.5]">
            {going
              ? `Your confirmation went to ${viewer.email}. We'll send a reminder before it starts.`
              : `You're number ${viewer.waitlistPosition ?? 1} in line. If a spot opens up it's yours, and we'll email ${viewer.email}.`}
          </p>
        </div>
      </div>

      {going && (
        <div className="mt-5 flex flex-wrap gap-2">
          {joinUrl && (
            <a
              href={joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={pill({ size: "md" })}
            >
              <Video className="size-4" aria-hidden="true" />
              Join the meeting
            </a>
          )}
          <a
            href={googleCalendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={pill({ tone: "outline", size: "sm" })}
          >
            <CalendarPlus className="size-4" aria-hidden="true" />
            Google Calendar
          </a>
          <a href={icsUrl} className={pill({ tone: "outline", size: "sm" })}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            Apple / Outlook
          </a>
        </div>
      )}

      {signedExtras && <div className="mt-5 flex flex-col gap-4">{signedExtras}</div>}

      <div className="bg-muted/60 rounded-tile mt-5 flex min-h-14 flex-wrap items-center justify-between gap-3 py-2 pr-2 pl-4">
        {confirming ? (
          <>
            <span className="text-[14px] font-semibold">
              {going ? "Give up your spot?" : "Leave the waitlist?"}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={pill({ tone: "outline", size: "sm" })}
              >
                Keep it
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={cancel}
                className={cn(
                  pill({ size: "sm" }),
                  "bg-block-alert text-block-alert-foreground hover:bg-block-alert/90",
                )}
              >
                {pending ? "Cancelling…" : going ? "Give up my spot" : "Leave the waitlist"}
              </button>
            </span>
          </>
        ) : (
          <>
            <span className="text-muted-foreground text-[14px]">
              {going ? "Can't make it anymore?" : "Changed your mind?"}
            </span>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={pill({ tone: "outline", size: "sm" })}
            >
              {going ? "Can't go" : "Leave the waitlist"}
            </button>
          </>
        )}
      </div>
      {error && (
        <div className="mt-3">
          <FormMessage>{error}</FormMessage>
        </div>
      )}
    </>
  );
}
