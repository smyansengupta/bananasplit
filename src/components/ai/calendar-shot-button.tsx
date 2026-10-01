"use client";

import { ImageUp } from "lucide-react";
import { useState } from "react";

import { CalendarShotImport } from "@/components/ai/calendar-shot-import";
import { Button } from "@/components/ui/button";

/** "From a screenshot" on the Calendar header (owners and admins, who add events). */
export function CalendarShotButton({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="Add events from a screenshot of an invite, an email or a flyer"
      >
        <ImageUp className="size-4" aria-hidden="true" />
        From a screenshot
      </Button>
      {open && <CalendarShotImport orgId={orgId} orgSlug={orgSlug} open={open} onOpenChange={setOpen} />}
    </>
  );
}
