"use client";

import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { OrgMemberOption } from "@/components/tasks/assignee-picker";
import { Button } from "@/components/ui/button";

import { updateEvent } from "@/app/app/[orgSlug]/calendar/actions";
import type { EventWithRelations } from "@/app/app/[orgSlug]/calendar/queries";

import { EventFormDialog } from "./event-form-dialog";

export function EventCalendar({
  orgId,
  orgSlug,
  events,
  members,
}: {
  orgId: string;
  orgSlug: string;
  events: EventWithRelations[];
  members: OrgMemberOption[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultStart, setDefaultStart] = useState<Date | null>(null);

  function openNewEvent(start?: Date) {
    setDefaultStart(start ?? null);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button type="button" onClick={() => openNewEvent()}>
          New event
        </Button>
      </div>

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,timeGridDay,listMonth",
        }}
        height="auto"
        editable
        selectable
        events={events.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.startsAt.toISOString(),
          end: e.endsAt.toISOString(),
          allDay: e.allDay,
        }))}
        dateClick={(info) => openNewEvent(info.date)}
        eventClick={(info) => router.push(`/app/${orgSlug}/calendar/${info.event.id}`)}
        eventDrop={(info) => {
          updateEvent(orgId, info.event.id, {
            startsAt: info.event.start?.toISOString(),
            endsAt: (info.event.end ?? info.event.start)?.toISOString(),
          }).then((result) => {
            if (result?.error) {
              info.revert();
            } else {
              router.refresh();
            }
          });
        }}
        eventResize={(info) => {
          updateEvent(orgId, info.event.id, {
            startsAt: info.event.start?.toISOString(),
            endsAt: info.event.end?.toISOString(),
          }).then((result) => {
            if (result?.error) {
              info.revert();
            } else {
              router.refresh();
            }
          });
        }}
      />

      <EventFormDialog
        orgId={orgId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={null}
        defaultStart={defaultStart}
        members={members}
      />
    </div>
  );
}
