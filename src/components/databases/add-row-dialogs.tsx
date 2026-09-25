"use client";

import { Plus } from "lucide-react";
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

import { ContactSearch, type ContactOption } from "./contact-search";

const selectClass = "border-input bg-background h-8 rounded-md border px-2 text-sm";

/** Manual check-in (ADMIN+): a suite-native row that can later be edited or deleted. */
export function AddAttendanceDialog({
  organizationId,
  sessions,
}: {
  organizationId: string;
  sessions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<ContactOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (form: FormData) => {
    const get = (k: string) => String(form.get(k) ?? "").trim();
    setError(null);
    start(async () => {
      const r = await addAttendanceAction(organizationId, {
        eventId: get("eventId"),
        contactId: person?.id,
        name: person ? undefined : get("name") || undefined,
        email: person ? undefined : get("email") || undefined,
        method: get("method") as "MANUAL" | "FORM" | "QR",
      });
      if (r.error) return setError(r.error);
      setOpen(false);
      setPerson(null);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden="true" />
          Add check-in
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a check-in</DialogTitle>
          <DialogDescription>
            For someone who attended but did not check in on the website.
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="att-session">Session</Label>
            <select id="att-session" name="eventId" required className={selectClass}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label>Person</Label>
            {person ? (
              <div className="flex items-center justify-between rounded-md border px-2 py-1 text-sm">
                <span>
                  {person.displayName ?? "Unnamed"}{" "}
                  <span className="text-muted-foreground">{person.emailMasked}</span>
                </span>
                <Button type="button" size="xs" variant="ghost" onClick={() => setPerson(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <ContactSearch
                  organizationId={organizationId}
                  onPick={setPerson}
                  placeholder="Find someone already on file…"
                />
                <p className="text-muted-foreground text-xs">…or add someone new:</p>
                <Input
                  name="name"
                  placeholder="Name"
                  maxLength={120}
                  aria-label="New person's name"
                />
                <Input
                  name="email"
                  type="email"
                  placeholder="Email (optional)"
                  aria-label="New person's email"
                />
              </>
            )}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="att-method">Method</Label>
            <select id="att-method" name="method" defaultValue="MANUAL" className={selectClass}>
              <option value="MANUAL">Manual</option>
              <option value="FORM">Form</option>
              <option value="QR">QR</option>
            </select>
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || sessions.length === 0}>
              {pending ? "Adding…" : "Add check-in"}
            </Button>
          </DialogFooter>
        </form>
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
        <Button size="sm">
          <Plus aria-hidden="true" />
          Add signup
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a signup</DialogTitle>
          <DialogDescription>
            For interest collected in person. The term comes from today&apos;s date.
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="sg-name">Name</Label>
            <Input id="sg-name" name="name" required maxLength={120} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="sg-email">Email</Label>
            <Input id="sg-email" name="email" type="email" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="sg-year">Year</Label>
            <select id="sg-year" name="classYear" className={selectClass}>
              <option value="">Not given</option>
              {years.map((y) => (
                <option key={y.value} value={y.value}>
                  {y.label}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add signup"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
