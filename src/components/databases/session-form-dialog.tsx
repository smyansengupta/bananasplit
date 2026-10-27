"use client";

import { Pencil, Plus } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createSessionAction,
  updateSessionAction,
  type SessionForm,
} from "@/app/app/[orgSlug]/databases/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/ui/field-select";

import { notice } from "./styles";
import { NO_TAG_LABEL, type EventTagOption } from "@/lib/calendar/tags";

import { useViewParams } from "./view-params";

/** Radix will not take an empty item value; "no type" travels as this. */

export interface SessionFormInitial {
  id: string;
  title: string;
  description: string | null;
  tagId: string | null;
  visibility: string;
  /** yyyy-MM-ddTHH:mm in the org timezone */
  startsAt: string;
  endsAt: string;
  location: string | null;
  hostUserId: string | null;
  hostName: string | null;
  rsvpUrl: string | null;
  term: string | null;
  stampSlot: number | null;
}

/**
 * Create or edit a Session: the same Event the calendar shows, saved
 * through the event service (ADMIN+). Times are wall-clock times in the org
 * timezone.
 */
export function SessionFormDialog({
  organizationId,
  timezone,
  members,
  tags,
  initial,
}: {
  organizationId: string;
  timezone: string;
  members: { id: string; name: string | null }[];
  /** The organization's own event types. */
  tags: EventTagOption[];
  initial?: SessionFormInitial;
}) {
  const router = useRouter();
  const view = useViewParams();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [hostMode, setHostMode] = useState(
    initial?.hostUserId ? "member" : initial?.hostName ? "guest" : "none",
  );

  const submit = (form: FormData) => {
    const get = (k: string) => String(form.get(k) ?? "");
    const input: SessionForm = {
      title: get("title"),
      description: get("description"),
      tagId: (get("tagId") as string) || null,
      visibility: get("visibility") as SessionForm["visibility"],
      startsAt: get("startsAt"),
      endsAt: get("endsAt"),
      location: get("location"),
      hostUserId: hostMode === "member" ? get("hostUserId") : "",
      hostName: hostMode === "guest" ? get("hostName") : "",
      rsvpUrl: get("rsvpUrl"),
      term: get("term"),
      stampSlot: get("stampSlot"),
    };
    setError(null);
    start(async () => {
      const result = initial
        ? await updateSessionAction(organizationId, initial.id, input)
        : await createSessionAction(organizationId, input);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (!initial && result.data)
        view.update((p) => p.set("row", String(result.data)), { push: true });
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {initial ? (
          <Button variant="outline" size="sm">
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        ) : (
          <Button variant="create">
            <Plus aria-hidden="true" />
            New session
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit session" : "New session"}</DialogTitle>
          <DialogDescription>
            Sessions are calendar events: this shows on the calendar too. Times are in {timezone}.
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="s-title">Title</Label>
            <Input
              id="s-title"
              name="title"
              required
              maxLength={200}
              defaultValue={initial?.title ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="s-kind">Type</Label>
              <FieldSelect
                id="s-kind"
                name="tagId"
                defaultValue={initial?.tagId ?? ""}
                className="w-full"
              >
                <option value="">{NO_TAG_LABEL}</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </FieldSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="s-vis">Visibility</Label>
              <FieldSelect
                id="s-vis"
                name="visibility"
                defaultValue={initial?.visibility ?? "INTERNAL"}
                className="w-full"
              >
                <option value="INTERNAL">Internal (board only)</option>
                <option value="PUBLIC">Public (website)</option>
              </FieldSelect>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="s-start">Starts</Label>
              <Input
                id="s-start"
                name="startsAt"
                type="datetime-local"
                required
                defaultValue={initial?.startsAt ?? ""}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="s-end">Ends</Label>
              <Input
                id="s-end"
                name="endsAt"
                type="datetime-local"
                required
                defaultValue={initial?.endsAt ?? ""}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-loc">Location</Label>
            <Input
              id="s-loc"
              name="location"
              maxLength={300}
              defaultValue={initial?.location ?? ""}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-host-mode">Host</Label>
            <div className="flex gap-2">
              <FieldSelect
                id="s-host-mode"
                value={hostMode}
                onChange={(e) => setHostMode(e.target.value)}
                className="w-36 shrink-0"
              >
                <option value="none">None</option>
                <option value="member">A member</option>
                <option value="guest">A guest</option>
              </FieldSelect>
              {hostMode === "member" && (
                <FieldSelect
                  name="hostUserId"
                  defaultValue={initial?.hostUserId ?? members[0]?.id}
                  aria-label="Host member"
                  className="flex-1"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? "Member"}
                    </option>
                  ))}
                </FieldSelect>
              )}
              {hostMode === "guest" && (
                <Input
                  name="hostName"
                  aria-label="Guest host name"
                  maxLength={120}
                  defaultValue={initial?.hostName ?? ""}
                />
              )}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-rsvp">RSVP link</Label>
            <Input
              id="s-rsvp"
              name="rsvpUrl"
              type="url"
              placeholder="https://"
              defaultValue={initial?.rsvpUrl ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="s-term">Term</Label>
              <Input
                id="s-term"
                name="term"
                placeholder="From the date"
                pattern="(fall|spring)-\d{4}"
                defaultValue={initial?.term ?? ""}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="s-slot">Stamp slot</Label>
              <Input
                id="s-slot"
                name="stampSlot"
                type="number"
                min={1}
                max={12}
                defaultValue={initial?.stampSlot ?? ""}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-desc">Description</Label>
            <Textarea
              id="s-desc"
              name="description"
              rows={3}
              defaultValue={initial?.description ?? ""}
            />
          </div>
          {error && (
            <p role="alert" className={notice.error}>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
