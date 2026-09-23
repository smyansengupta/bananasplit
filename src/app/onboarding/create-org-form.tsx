"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/slug";
import { timeZoneOptions } from "@/lib/timezones";

import { checkSlugAvailability, createOrganizationAction } from "./actions";

/**
 * Create an organization (onboarding and /app/new). The server re-checks
 * everything: the creation policy, the code, the URL and the limits.
 */
export function CreateOrgForm({ requiresCode = false }: { requiresCode?: boolean }) {
  const [state, formAction, isPending] = useActionState(createOrganizationAction, {});
  const [name, setName] = useState("");
  const [manualSlug, setManualSlug] = useState("");
  const [slugEditedByUser, setSlugEditedByUser] = useState(false);
  const [slugStatus, setSlugStatus] = useState<"idle" | "available" | "taken">("idle");
  const [isChecking, startTransition] = useTransition();
  const zones = useMemo(() => timeZoneOptions(), []);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser zone is only known on the client
      if (detected && zones.includes(detected)) setTimezone(detected);
    } catch {
      // keep UTC
    }
  }, [zones]);

  const slug = slugEditedByUser ? manualSlug : slugify(name);

  useEffect(() => {
    if (!slug) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        const available = await checkSlugAvailability(slug);
        setSlugStatus(available ? "available" : "taken");
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [slug]);

  const showChecking = Boolean(slug) && isChecking;
  const showAvailable = Boolean(slug) && !isChecking && slugStatus === "available";
  const showTaken = Boolean(slug) && !isChecking && slugStatus === "taken";

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-1.5">
        <Label htmlFor="org-name">Organization name</Label>
        <Input
          id="org-name"
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Robotics Club"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="org-slug">URL</Label>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-sm">/app/</span>
          <Input
            id="org-slug"
            name="slug"
            required
            value={slug}
            onChange={(e) => {
              setManualSlug(slugify(e.target.value));
              setSlugEditedByUser(true);
            }}
          />
        </div>
        {showChecking && <p className="text-muted-foreground text-sm">Checking…</p>}
        {showTaken && <p className="text-destructive text-sm">That URL is already taken.</p>}
        {showAvailable && <p className="text-sm text-green-700 dark:text-green-500">Available</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="org-timezone">Timezone</Label>
        <select
          id="org-timezone"
          name="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          Used for weekly updates, reminders and reports. You can change it later.
        </p>
      </div>
      {requiresCode && (
        <div className="grid gap-1.5">
          <Label htmlFor="org-code">Organization code</Label>
          <Input
            id="org-code"
            name="code"
            required
            autoComplete="off"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="font-mono uppercase"
          />
          <p className="text-muted-foreground text-xs">
            A single-use code from a platform admin. Codes expire after 14 days.
          </p>
        </div>
      )}
      {state.error && (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={isPending || showTaken} className="w-full">
        {isPending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
