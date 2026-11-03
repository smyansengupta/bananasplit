"use client";

import { useState } from "react";

import { NotebookPen, Phone } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/crm/phone";

import { LogCallDialog, LogCallForm, type CallTarget } from "./call-log";
import { CallControls, useSoftphone, type PhoneCaps } from "./softphone";

/**
 * Call someone and log it, in as few clicks as the setup allows: with a
 * provider connected, Call opens the softphone and ends on the outcome;
 * without one, Call is a tel: link (the phone's own dialer) and Log a call
 * is one button away.
 */
export function CallPerson({
  orgId,
  person,
  target,
  caps,
  size = "sm",
}: {
  orgId: string;
  person: { id: string; name: string; phone: string | null; doNotContact: boolean };
  /** The item and company to log it on too. */
  target?: CallTarget;
  caps: PhoneCaps;
  size?: "sm" | "default";
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState(false);
  const phone = useSoftphone(orgId, caps);
  const callTarget: CallTarget = { ...target, personId: person.id };

  if (person.doNotContact) {
    return <p className="text-muted-foreground text-sm">They asked not to be contacted.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {person.phone ? (
        caps.softphone ? (
          <Button type="button" size={size} onClick={() => setOpen(true)}>
            <Phone className="size-4" aria-hidden="true" />
            Call
          </Button>
        ) : (
          <Button asChild size={size}>
            <a href={`tel:${person.phone}`} onClick={() => setTimeout(() => setLogOpen(true), 400)}>
              <Phone className="size-4" aria-hidden="true" />
              Call {formatNumber(person.phone)}
            </a>
          </Button>
        )
      ) : (
        <span className="text-muted-foreground text-sm">No number yet.</span>
      )}
      <Button type="button" size={size} variant="outline" onClick={() => setLogOpen(true)}>
        <NotebookPen className="size-4" aria-hidden="true" />
        Log a call
      </Button>
      <LogCallDialog orgId={orgId} target={callTarget} name={person.name} open={logOpen} onOpenChange={setLogOpen} />
      {caps.softphone && (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!next && (phone.state === "ringing" || phone.state === "live" || phone.state === "starting")) return;
            setOpen(next);
            if (!next) phone.reset();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Call {person.name}</DialogTitle>
              <DialogDescription>From your organization&apos;s number, in this browser.</DialogDescription>
            </DialogHeader>
            {phone.state === "idle" ? (
              <div className="space-y-4">
                {caps.canRecord && caps.provider === "twilio" && (
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      Record this call
                      <span className="text-muted-foreground block text-xs">
                        They hear that it&apos;s recorded as they answer.
                      </span>
                    </span>
                    <Switch checked={record} onCheckedChange={setRecord} />
                  </label>
                )}
                <Button type="button" className="w-full" onClick={() => void phone.start(person.id, { record })}>
                  <Phone className="size-4" aria-hidden="true" />
                  Call {formatNumber(person.phone)}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <CallControls phone={phone} caps={caps} name={person.name} number={person.phone} />
                {(phone.state === "ended" || phone.state === "failed") && phone.callId && (
                  <LogCallForm
                    orgId={orgId}
                    target={callTarget}
                    callId={phone.callId}
                    durationSec={phone.seconds}
                    defaultOutcome={phone.seconds > 0 ? "connected" : "no-answer"}
                    submitLabel="Save"
                    onSaved={() => {
                      setOpen(false);
                      phone.reset();
                    }}
                  />
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
