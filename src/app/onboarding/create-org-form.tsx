"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/slug";

import { checkSlugAvailability, createOrganizationAction } from "./actions";

export function CreateOrgForm() {
  const [state, formAction, isPending] = useActionState(createOrganizationAction, {});
  const [name, setName] = useState("");
  const [manualSlug, setManualSlug] = useState("");
  const [slugEditedByUser, setSlugEditedByUser] = useState(false);
  const [slugStatus, setSlugStatus] = useState<"idle" | "available" | "taken">("idle");
  const [isChecking, startTransition] = useTransition();

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
        {showAvailable && <p className="text-sm text-green-600">Available</p>}
      </div>
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
      <Button type="submit" disabled={isPending || showTaken} className="w-full">
        {isPending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
