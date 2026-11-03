"use client";

import { Link2, Repeat } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { keepInTouchAction, selfUpdateLinkAction, setFollowUpAction, stopEnrollmentAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { CADENCES } from "@/lib/crm/outreach/schedule";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

import { CopyLink } from "./booking";
import { ComposeButton, type ComposeTemplate } from "./compose";
import { EnrollDialog } from "./sequences";

/** The person page's reaching-out controls: cadence, follow-up, sequences, invites, their self-update link, a call. */
export function PersonOutreachControls({
  orgId,
  person,
  cadence,
  enrollments,
  sequences,
  invites,
  templates,
  selfUpdateUrl,
}: {
  orgId: string;
  person: { id: string; name: string; email: string | null; phone: string | null; blocked: string | null };
  cadence: number | null;
  enrollments: { id: string; name: string; status: string; step: number }[];
  sequences: { id: string; name: string }[];
  invites: { label: string; url: string; subject: string }[];
  templates: ComposeTemplate[];
  selfUpdateUrl: string | null;
}) {
  const router = useRouter();
  const [enrolling, setEnrolling] = useState(false);
  const [link, setLink] = useState(selfUpdateUrl);
  const ok = (r: { ok: boolean; error?: string } | undefined, msg: string) => {
    if (!r) return;
    if (!r.ok) return toast({ title: r.error ?? "That didn't work.", tone: "error" });
    toast({ title: msg });
    router.refresh();
  };
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <Repeat className="size-3.5" aria-hidden="true" />
          Keep in touch
        </span>
        <div className="flex flex-wrap gap-1.5">
          {CADENCES.map((c) => (
            <button
              key={c.days}
              type="button"
              className={cn(chipClass(cadence === c.days), "h-8 px-3")}
              onClick={async () => ok(await runAction(() => keepInTouchAction(orgId, [person.id], cadence === c.days ? null : c.days)), cadence === c.days ? "Cadence off" : c.label)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        <span className="text-muted-foreground">Follow up</span>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              [1, "Tomorrow"],
              [7, "Next week"],
              [30, "In a month"],
              [null, "No follow-up"],
            ] as const
          ).map(([d, l]) => (
            <button key={l} type="button" className={cn(chipClass(false), "h-8 px-3")} onClick={async () => ok(await runAction(() => setFollowUpAction(orgId, person.id, d)), d ? `Follow up ${l.toLowerCase()}` : "Follow-up cleared")}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={sequences.length === 0 || Boolean(person.blocked)} title={sequences.length ? undefined : "No sequence is on"} onClick={() => setEnrolling(true)}>
          <Repeat className="size-4" aria-hidden="true" />
          Add to a sequence
        </Button>
        {invites.map((i) => (
          <ComposeButton
            key={i.url}
            orgId={orgId}
            people={[{ id: person.id, name: person.name, email: person.email, blocked: person.blocked }]}
            templates={templates}
            label={`Invite to ${i.label}`}
            size="sm"
            icon={false}
            subject={i.subject}
            body={`Hi {{first_name|there}},\n\nWe'd love to see you at ${i.label}.\n\n${i.url}\n\n{{my_first_name}}`}
          />
        ))}
      </div>
      {enrollments.length > 0 && (
        <ul className="space-y-1">
          {enrollments.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {e.name} <span className="text-muted-foreground">{e.status === "ACTIVE" ? `step ${e.step + 1}` : e.status.toLowerCase()}</span>
              </span>
              {(e.status === "ACTIVE" || e.status === "PAUSED") && (
                <Button variant="ghost" size="xs" onClick={async () => ok(await runAction(() => stopEnrollmentAction(orgId, e.id)), "Stopped")}>
                  Stop
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <Link2 className="size-3.5" aria-hidden="true" />
          Their own update link
        </span>
        {link ? (
          <>
            <CopyLink url={link} label="Copy their update link" />
            <Button
              variant="ghost"
              size="xs"
              className="justify-self-start"
              onClick={async () => {
                const r = await runAction(() => selfUpdateLinkAction(orgId, person.id, false));
                if (r?.ok) setLink(null);
              }}
            >
              Turn it off
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={async () => {
              const r = await runAction(() => selfUpdateLinkAction(orgId, person.id, true));
              if (r?.ok) setLink(r.url);
            }}
          >
            Make a link so they keep their details current
          </Button>
        )}
      </div>
      {enrolling && (
        <EnrollDialog orgId={orgId} sequences={sequences} personIds={[person.id]} onClose={() => setEnrolling(false)} onDone={() => router.refresh()} />
      )}
    </div>
  );
}
