"use client";

import { Plus, X } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addAttendanceAction, addSignupAction } from "@/app/app/[orgSlug]/databases/actions";
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
import { FieldSelect } from "@/components/ui/field-select";
import { toast } from "@/components/ui/toaster";

import { ContactSearch, type ContactOption } from "./contact-search";
import { notice } from "./styles";

type Arrival = { key: string; contact?: ContactOption; name?: string; email?: string };

/**
 * Late check-ins (ADMIN+): suite-native rows that can later be edited or
 * deleted. Several people at once: pick them from who's on file, or type
 * a new name, and add them all in one go. From a session's drawer the
 * session is already chosen, so it isn't asked again; every one counts as
 * a manual check-in.
 */
export function AddAttendanceDialog({
  organizationId,
  sessions,
  sessionId,
  trigger,
}: {
  organizationId: string;
  sessions: { id: string; label: string }[];
  /** Set from a session's drawer: that session, with no picker. */
  sessionId?: string;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Arrival[]>([]);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [eventId, setEventId] = useState(sessionId ?? sessions[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function addNew() {
    const name = newName.trim();
    if (!name) return;
    setPeople((list) => [
      ...list,
      { key: `new-${Date.now()}`, name, email: newEmail.trim() || undefined },
    ]);
    setNewName("");
    setNewEmail("");
  }

  function submit() {
    // A name still in the box counts too.
    const all = newName.trim()
      ? [...people, { key: "typed", name: newName.trim(), email: newEmail.trim() || undefined }]
      : people;
    if (all.length === 0 || !eventId) return;
    setError(null);
    start(async () => {
      let done = 0;
      for (const p of all) {
        const r = await addAttendanceAction(organizationId, {
          eventId,
          contactId: p.contact?.id,
          name: p.contact ? undefined : p.name,
          email: p.contact ? undefined : p.email,
          method: "MANUAL",
        });
        if (r.error) {
          setError(r.error);
          break;
        }
        done += 1;
      }
      if (done > 0) {
        toast({ title: done === 1 ? "Checked in" : `${done} checked in`, tone: "success" });
        router.refresh();
      }
      if (done === all.length) {
        setOpen(false);
        setPeople([]);
        setNewName("");
        setNewEmail("");
      } else {
        setPeople(all.slice(done));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="create">
            <Plus aria-hidden="true" />
            Add check-in
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add check-ins</DialogTitle>
          <DialogDescription className="sr-only">
            Add people who came but didn&apos;t check in.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {!sessionId && (
            <div className="grid gap-1.5">
              <Label htmlFor="att-session">Session</Label>
              <FieldSelect
                id="att-session"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="w-full"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </FieldSelect>
            </div>
          )}
          <div className="grid gap-2">
            <Label>People</Label>
            {people.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {people.map((p) => (
                  <li
                    key={p.key}
                    className="bg-muted inline-flex items-center gap-1 rounded-full py-1 ps-3 pe-1 text-sm"
                  >
                    {p.contact?.displayName ?? p.name ?? "Unnamed"}
                    <button
                      type="button"
                      aria-label={`Remove ${p.contact?.displayName ?? p.name ?? "person"}`}
                      onClick={() => setPeople((list) => list.filter((x) => x.key !== p.key))}
                      className="hover:bg-muted-strong grid size-6 place-items-center rounded-full"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <ContactSearch
              organizationId={organizationId}
              onPick={(c) =>
                setPeople((list) =>
                  list.some((x) => x.contact?.id === c.id)
                    ? list
                    : [...list, { key: c.id, contact: c }],
                )
              }
              placeholder="Find someone on file"
            />
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addNew();
                  }
                }}
                placeholder="Or a new name"
                maxLength={120}
                aria-label="New person's name"
              />
              <Input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                type="email"
                placeholder="Email (optional)"
                aria-label="New person's email"
              />
            </div>
          </div>
          {error && (
            <p role="alert" className={notice.error}>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              onClick={submit}
              disabled={pending || !eventId || (people.length === 0 && !newName.trim())}
            >
              {pending
                ? "Adding"
                : people.length + (newName.trim() ? 1 : 0) > 1
                  ? `Check in ${people.length + (newName.trim() ? 1 : 0)}`
                  : "Check in"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Manual signup (ADMIN+). */
export function AddSignupDialog({
  organizationId,
  years,
}: {
  organizationId: string;
  years: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (form: FormData) => {
    const get = (k: string) => String(form.get(k) ?? "").trim();
    setError(null);
    start(async () => {
      const r = await addSignupAction(organizationId, {
        name: get("name"),
        email: get("email") || undefined,
        classYear: get("classYear") || undefined,
      });
      if (r.error) return setError(r.error);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="create">
          <Plus aria-hidden="true" />
          Add signup
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a signup</DialogTitle>
          <DialogDescription>The term comes from today&apos;s date.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="sg-name">Name</Label>
            <Input id="sg-name" name="name" required maxLength={120} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sg-email">Email</Label>
            <Input id="sg-email" name="email" type="email" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sg-year">Year</Label>
            <FieldSelect id="sg-year" name="classYear" className="w-full">
              <option value="">Not given</option>
              {years.map((y) => (
                <option key={y.value} value={y.value}>
                  {y.label}
                </option>
              ))}
            </FieldSelect>
          </div>
          {error && (
            <p role="alert" className={notice.error}>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding" : "Add signup"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
