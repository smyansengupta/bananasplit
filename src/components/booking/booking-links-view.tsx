"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  cancelBookingByHostAction,
  createOrgLinkAction,
} from "@/app/app/[orgSlug]/meetings/booking/actions";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  FormDialog,
  FormDialogBody,
  FormDialogFoot,
  FormDialogHead,
  FormField,
} from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import { safeTimeZone } from "@/lib/calendar/dates";
import { runAction } from "@/lib/run-action";
import type {
  BookingLinkState,
  BookingMember,
  BookingPerson,
  BookingRow,
} from "@/server/booking/view";

import { ComingUp } from "./coming-up";
import { LinkDialog } from "./link-dialog";
import { LinkStrip, OrgFace } from "./link-strip";
import { OtherLinks } from "./other-links";
import { PeopleGrid } from "./people-grid";
import { WeekBars } from "./week-bars";

/**
 * Meetings > Meeting links. Two different pages (docs/features/booking.md):
 *
 * An organization: its own link as the strip across the top (the shape of
 * Video calls on Meetings), its picture and name, never a person; its other
 * links behind one quiet control at the end of the strip; everyone's own
 * links under it three to a row; then what's booked. A Personal space: your
 * link as the strip, your week as a picture inside it, then what's booked.
 *
 * Each link opens its editor as the app's centered dialog (LinkDialog, the
 * New event dialog's look).
 */
export function BookingLinksView({
  orgId,
  orgSlug,
  orgName,
  orgLogo,
  personalSpace,
  orgLinksAllowed,
  crmOn,
  mine,
  mainLink,
  orgLinks,
  people,
  upcoming,
  members,
  pipelines,
  timeZones,
  orgTimeZone,
  openOnArrival,
}: {
  orgId: string;
  orgSlug: string;
  orgName: string;
  orgLogo: string | null;
  personalSpace: boolean;
  orgLinksAllowed: boolean;
  crmOn: boolean;
  mine: BookingLinkState;
  /** The organization's own link. */
  mainLink: BookingLinkState | null;
  /** Its other links. */
  orgLinks: BookingLinkState[];
  people: BookingPerson[];
  upcoming: BookingRow[];
  members: BookingMember[];
  pipelines: { id: string; name: string }[];
  timeZones: string[];
  orgTimeZone: string;
  openOnArrival: string | null;
}) {
  const router = useRouter();
  const all = [mine, ...(mainLink ? [mainLink] : []), ...orgLinks];
  const [editing, setEditing] = useState<string | null>(
    openOnArrival && all.some((l) => l.id === openOnArrival) ? openOnArrival : null,
  );
  const [creating, setCreating] = useState(false);
  const [others, setOthers] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [cancelling, setCancelling] = useState<BookingRow | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const open = all.find((l) => l.id === editing) ?? null;
  const memberOf = new Map(members.map((m) => [m.id, m]));
  const hostsOf = (l: BookingLinkState) =>
    l.hostIds.flatMap((id) => {
      const m = memberOf.get(id);
      return m ? [m] : [];
    });

  /** Makes an organization link and opens its editor. */
  const create = async () => {
    setBusy(true);
    const r = await runAction(() => createOrgLinkAction(orgId, newTitle));
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    router.refresh();
    setEditing(r.id);
    setCreating(false);
    setNewTitle("");
  };
  const cancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    const r = await runAction(() => cancelBookingByHostAction(orgId, cancelling.id, note));
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: `Cancelled. ${cancelling.guestName.split(" ")[0]} has been told.` });
    setCancelling(null);
    setNote("");
    router.refresh();
  };

  // One control for the other links; with none yet, New link waits in the strip's menu.
  const more = orgLinks.length > 0 && (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground basis-full justify-start @2xl:basis-auto @2xl:justify-center"
      onClick={() => setOthers(true)}
    >
      {orgLinks.length === 1 ? "1 more link" : `${orgLinks.length} more links`}
    </Button>
  );
  const hosts = mainLink ? hostsOf(mainLink) : [];
  return (
    <div className="space-y-7.5">
      {personalSpace ? (
        <LinkStrip
          orgId={orgId}
          link={mine}
          name="your meeting link"
          picture={<UserAvatar user={hostsOf(mine)[0] ?? { name: mine.title }} size="lg" className="shrink-0" />}
          line={`${mine.lengths}. ${mine.hoursLine}.`}
          onEdit={() => setEditing(mine.id)}
        >
          <WeekBars days={mine.week} label={`Your week: ${mine.hoursLine}`} large />
        </LinkStrip>
      ) : mainLink ? (
        <LinkStrip
          orgId={orgId}
          link={mainLink}
          name={mainLink.title}
          picture={<OrgFace name={orgName} logo={orgLogo} />}
          line={`${mainLink.lengths} with ${hosts.length > 0 ? "whoever's free" : "nobody yet"}`}
          hosts={hosts}
          onEdit={() => setEditing(mainLink.id)}
          menu={
            orgLinksAllowed &&
            orgLinks.length === 0 && (
              <DropdownMenuItem onSelect={() => setCreating(true)}>New link</DropdownMenuItem>
            )
          }
          more={more}
        />
      ) : (
        more && <div className="@container">{more}</div>
      )}

      {!personalSpace && (
        <PeopleGrid
          orgId={orgId}
          people={people}
          mine={mine}
          onEditMine={() => setEditing(mine.id)}
        />
      )}

      <ComingUp
        orgId={orgId}
        orgSlug={orgSlug}
        items={upcoming}
        timeZone={safeTimeZone(orgTimeZone)}
        onCancel={setCancelling}
      />

      <OtherLinks
        orgId={orgId}
        links={orgLinks}
        hostNames={(l) => hostsOf(l).map((h) => h.name)}
        canMake={orgLinksAllowed}
        open={others}
        onOpenChange={setOthers}
        onEdit={(id) => {
          setOthers(false);
          setEditing(id);
        }}
        onNew={() => {
          setOthers(false);
          setCreating(true);
        }}
      />

      {open && (
        <LinkDialog
          key={open.id}
          orgId={orgId}
          link={open}
          members={members}
          pipelines={pipelines}
          timeZones={timeZones}
          orgTimeZone={orgTimeZone}
          crmOn={crmOn}
          onOpenChange={(v) => !v && setEditing(null)}
        />
      )}

      {/* New task's window, sized down to the one field; the whole screen on a phone. */}
      <FormDialog open={creating} onOpenChange={setCreating} className="sm:max-w-lg">
        <FormDialogHead
          title="New meeting link"
          description="You host it to start. Add hosts and hours next."
        />
        <FormDialogBody>
          <FormField label="Name" htmlFor="new-link-title">
            <Input
              id="new-link-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Coffee with the president"
              maxLength={120}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) void create();
              }}
            />
          </FormField>
        </FormDialogBody>
        <FormDialogFoot>
          <Button variant="outline" onClick={() => setCreating(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !newTitle.trim()} onClick={create}>
            Create meeting link
          </Button>
        </FormDialogFoot>
      </FormDialog>

      <FormDialog
        open={Boolean(cancelling)}
        onOpenChange={(v) => !v && setCancelling(null)}
        className="sm:max-w-lg"
      >
        <FormDialogHead
          title={`Cancel with ${cancelling?.guestName ?? ""}?`}
          description="It comes off the calendar and they get an email saying it's cancelled."
        />
        <FormDialogBody>
          <FormField label="A note for them (optional)" htmlFor="cancel-note">
            <Textarea
              id="cancel-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </FormField>
        </FormDialogBody>
        <FormDialogFoot>
          <Button variant="outline" onClick={() => setCancelling(null)}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={busy} onClick={cancel}>
            Cancel the meeting
          </Button>
        </FormDialogFoot>
      </FormDialog>
    </div>
  );
}
