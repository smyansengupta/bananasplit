"use client";

import { Copy, Megaphone } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { postRecapAnnouncement } from "@/server/announcements/actions";

/**
 * The recap's foot buttons: Copy as text (what's on screen, the viewer's
 * own recap), and Post as an announcement, which the server writes again as
 * any member would see it (no money, no counts only admins see), so nothing
 * private to the viewer goes out to everyone.
 */
export function RecapWeekActions({ orgId, text }: { orgId: string; text: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [posted, setPosted] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied the recap" });
    } catch {
      toast({ title: "Couldn't copy. Select the text and copy it instead.", tone: "error" });
    }
  };

  const post = () => {
    if (pending) return;
    start(async () => {
      const result = await runAction(
        () => postRecapAnnouncement(orgId),
        "Couldn't post the recap. Try again.",
      );
      if (!result) return;
      if (!result.ok) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      setPosted(true);
      toast({ title: "Posted as an announcement", tone: "success" });
      router.refresh();
    });
  };

  return (
    <span className="ml-auto flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={copy}>
        <Copy className="size-3.5" aria-hidden="true" />
        Copy as text
      </Button>
      <Button size="sm" onClick={post} disabled={pending || posted}>
        <Megaphone className="size-3.5" aria-hidden="true" />
        {posted ? "Posted" : "Post as an announcement"}
      </Button>
    </span>
  );
}
