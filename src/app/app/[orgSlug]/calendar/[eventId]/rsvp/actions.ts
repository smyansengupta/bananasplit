"use server";

import { z } from "zod";

import { requirePermission } from "@/lib/auth/permissions";
import { isRsvpBackground } from "@/lib/rsvp/backgrounds";
import { shareCents } from "@/lib/rsvp/pay";
import { payToSchema } from "@/lib/rsvp/pay-schema";
import { registrationSchema } from "@/lib/rsvp/schema";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import { setRegistrationCheckIn } from "@/server/rsvp/checkin";
import {
  confirmPayment,
  enableRsvpPage,
  lockEvent,
  promoteFromWaitlist,
  registerGuest,
  registrationCounts,
  RSVP_RULES_SELECT,
  saveRsvpItems,
  setRegistrationStatus,
} from "@/server/rsvp/service";

import { actionError } from "../../action-result";

/**
 * An event's public RSVP page, run from the suite (owners and admins:
 * events.write; RLS also limits sign-ups to them). Each action returns
 * { error } rather than throwing, like the other calendar actions.
 */

export interface RsvpActionResult {
  error?: string;
  slug?: string;
  /** Check-in: the guest's name, and whether they were already in. */
  name?: string;
  already?: boolean;
}

async function loadEvent(ctx: OrgContext, eventId: string) {
  const event = await ctx.db.event.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null },
    select: RSVP_RULES_SELECT,
  });
  if (!event) throw new NotFound();
  return event;
}

class NotFound extends Error {}

function run<Args extends unknown[]>(
  handler: (ctx: OrgContext, ...args: Args) => Promise<RsvpActionResult>,
) {
  const tx = withOrgAction(async (ctx: OrgContext, ...args: Args) => {
    requirePermission(ctx, "events.write");
    try {
      return await handler(ctx, ...args);
    } catch (error) {
      if (error instanceof NotFound) return { error: "That event no longer exists." };
      throw error;
    }
  });
  return async (organizationId: string, ...args: Args): Promise<RsvpActionResult> => {
    try {
      return await tx(organizationId, ...args);
    } catch (error) {
      return actionError(error);
    }
  };
}

/** Turns the page on, giving the event its link the first time. */
export const turnOnRsvpPage = run(async (ctx, eventId: string) => {
  const event = await loadEvent(ctx, eventId);
  const slug = await enableRsvpPage(ctx.db, ctx.organizationId, event.id);
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "event.rsvp_page_on",
    targetType: "Event",
    targetId: event.id,
  });
  return { slug };
});

/** Turns the page off: its link stops working; sign-ups are kept. */
export const turnOffRsvpPage = run(async (ctx, eventId: string) => {
  const event = await loadEvent(ctx, eventId);
  await ctx.db.event.update({ where: { id: event.id }, data: { rsvpEnabled: false } });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "event.rsvp_page_off",
    targetType: "Event",
    targetId: event.id,
  });
  return {};
});

const settingsSchema = z.object({
  locationDetails: z
    .string()
    .trim()
    .max(1000, "Keep the directions under 1,000 characters.")
    .nullable(),
  capacity: z.number().int().min(1, "Allow at least one spot.").max(100_000).nullable(),
  waitlist: z.boolean(),
  closed: z.boolean(),
  hideLocation: z.boolean(),
  hideGuests: z.boolean(),
  hideCount: z.boolean(),
  background: z.string().refine(isRsvpBackground, "Pick one of the backgrounds."),
  // Split the cost. Optional, so a form that doesn't send them keeps them.
  costMode: z.enum(["NONE", "EACH", "SPLIT"]).optional(),
  costCents: z
    .number()
    .int()
    .min(1, "Enter an amount, or turn off splitting the cost.")
    .max(10_000_000, "That's more than $100,000.")
    .nullable()
    .optional(),
  costNote: z.string().trim().max(120, "Keep the note under 120 characters.").nullable().optional(),
  payTo: payToSchema.optional(),
});

export type RsvpSettingsInput = z.input<typeof settingsSchema>;

/** The page's settings. More spots (or none to limit) moves waitlisted guests up. */
export const saveRsvpSettings = run(async (ctx, eventId: string, input: unknown) => {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the settings." };
  const s = parsed.data;
  if (s.costMode && s.costMode !== "NONE" && !s.costCents) {
    return { error: "Enter an amount, or turn off splitting the cost." };
  }
  const event = await loadEvent(ctx, eventId);
  await lockEvent(ctx.db, event.id);
  const updated = await ctx.db.event.update({
    where: { id: event.id },
    data: {
      locationDetails: s.locationDetails || null,
      rsvpCapacity: s.capacity,
      rsvpWaitlist: s.waitlist,
      rsvpClosed: s.closed,
      rsvpHideLocation: s.hideLocation,
      rsvpHideGuests: s.hideGuests,
      rsvpHideCount: s.hideCount,
      rsvpBackground: s.background,
      ...(s.costMode
        ? {
            rsvpCostMode: s.costMode,
            rsvpCostCents: s.costMode === "NONE" ? null : (s.costCents ?? null),
            rsvpCostNote: s.costNote || null,
          }
        : {}),
      ...(s.payTo ? { rsvpPayTo: s.payTo } : {}),
    },
    select: RSVP_RULES_SELECT,
  });
  await promoteFromWaitlist(ctx.db, updated);
  return {};
});

const statusSchema = z.enum(["GOING", "WAITLIST", "CANCELLED"]);

/** Moves a guest (to going even past capacity, to the waitlist, or out). */
export const setGuestStatus = run(
  async (ctx, eventId: string, registrationId: string, status: unknown) => {
    const parsed = statusSchema.safeParse(status);
    if (!parsed.success) return { error: "Pick going, waitlist or cancelled." };
    const event = await loadEvent(ctx, eventId);
    const ok = await setRegistrationStatus(ctx.db, event, registrationId, parsed.data);
    return ok ? {} : { error: "That guest isn't signed up anymore." };
  },
);

/**
 * Checks a guest in at the door, or undoes it. In a club the check-in also
 * lands in its People and Attendance databases (src/server/rsvp/checkin.ts).
 */
export const setGuestCheckedIn = run(
  async (
    ctx,
    eventId: string,
    registrationId: string,
    checkedIn: unknown,
    method: unknown = "MANUAL",
  ) => {
    const event = await loadEvent(ctx, eventId);
    const result = await setRegistrationCheckIn(ctx.db, {
      organizationId: ctx.organizationId,
      eventId: event.id,
      registrationId,
      checkedIn: checkedIn === true,
      actorUserId: ctx.userId,
      method: method === "QR" ? "QR" : "MANUAL",
    });
    return result.ok
      ? { name: result.name, already: result.already }
      : { error: "That guest isn't signed up anymore." };
  },
);

/** Marks a guest paid (what they said, or cash at the door) or not paid. */
export const setGuestPaid = run(
  async (ctx, eventId: string, registrationId: string, paid: unknown) => {
    const event = await loadEvent(ctx, eventId);
    const { going } = await registrationCounts(ctx.db, ctx.organizationId, event.id);
    const ok = await confirmPayment(
      ctx.db,
      event,
      registrationId,
      paid === true,
      shareCents(event.rsvpCostMode, event.rsvpCostCents, going),
    );
    return ok ? {} : { error: "That guest isn't signed up anymore." };
  },
);

const itemsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(64).optional(),
      label: z
        .string()
        .trim()
        .min(1, "Every line needs a name.")
        .max(80, "Keep each line under 80 characters."),
      slots: z.number().int().min(1).max(50, "Up to 50 people per line."),
    }),
  )
  .max(40, "Up to 40 lines.");

/** Saves the bring list: lines left out are removed, with who was bringing them. */
export const saveBringList = run(async (ctx, eventId: string, items: unknown) => {
  const parsed = itemsSchema.safeParse(items);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the list." };
  const event = await loadEvent(ctx, eventId);
  await saveRsvpItems(ctx.db, event, parsed.data);
  return {};
});

/**
 * Adds someone by hand: always going, even past capacity. `checkIn` (door
 * mode's walk-in) checks them in at once too.
 */
export const addGuest = run(
  async (ctx, eventId: string, input: unknown, opts: { checkIn?: boolean } = {}) => {
    const parsed = registrationSchema.safeParse(input);
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Check the guest's details." };
    const event = await loadEvent(ctx, eventId);
    if (!event.rsvpEnabled) return { error: "Turn on the RSVP page first." };
    const outcome = await registerGuest(ctx.db, event, parsed.data, { force: true });
    if (outcome.kind === "exists") return { error: "That email is already on the list." };
    if (outcome.kind === "closed") return { error: "This page isn't taking sign-ups." };
    if (opts.checkIn && outcome.kind === "registered") {
      await setRegistrationCheckIn(ctx.db, {
        organizationId: ctx.organizationId,
        eventId: event.id,
        registrationId: outcome.registrationId,
        checkedIn: true,
        actorUserId: ctx.userId,
        method: "MANUAL",
      });
    }
    return {};
  },
);

/** Removes a sign-up for good (a test, a duplicate); a freed spot moves the waitlist up. */
export const deleteGuest = run(async (ctx, eventId: string, registrationId: string) => {
  const event = await loadEvent(ctx, eventId);
  await lockEvent(ctx.db, event.id);
  const gone = await ctx.db.eventRegistration.deleteMany({
    where: { id: registrationId, organizationId: ctx.organizationId, eventId: event.id },
  });
  if (gone.count) await promoteFromWaitlist(ctx.db, event);
  return {};
});
