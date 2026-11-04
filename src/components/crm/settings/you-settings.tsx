"use client";

import { useState } from "react";

import { saveMemberSettingsAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { SettingsCard, SettingsStatus } from "@/app/app/[orgSlug]/settings/settings-card";
import { CopyLink } from "@/components/crm/outreach/booking";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";

import { useSave } from "./use-save";

/**
 * CRM settings > You (every member, only theirs): the signature under
 * what they send, and their mail and the CRM (the logging address, what
 * it shares, what's never logged).
 */

type Share = "NONE" | "METADATA" | "FULL";

const SHARE: { value: Share; label: string; help: string }[] = [
  {
    value: "FULL",
    label: "Full messages",
    help: "The CRM keeps the subject and what was written, on the person's timeline.",
  },
  {
    value: "METADATA",
    label: "Who and when",
    help: "The CRM sees that you emailed someone, and when, but not what was said.",
  },
  {
    value: "NONE",
    label: "Nothing",
    help: "Your mail never reaches the CRM. Replies to your plans still stop them.",
  },
];

export function DetailsCard({
  orgId,
  name,
  signature: initial,
}: {
  orgId: string;
  name: string;
  signature: string;
}) {
  const [signature, setSignature] = useState(initial);
  const { pending, status, save } = useSave();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveMemberSettingsAction(orgId, { signature }));
      }}
    >
      <SettingsCard
        title="Your details"
        description="How your name and signature show on what you send. Your name comes from your profile."
        status={<SettingsStatus status={status} />}
        footer={
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <b className="flex-[1_1_10rem] text-[15px] font-semibold">Name</b>
          <span className="flex-[1_1_16rem] text-[15px]">{name}</span>
        </div>
        <div className="border-border flex flex-wrap items-start gap-3 border-t pt-4">
          <span className="flex-[1_1_10rem]">
            <b className="block text-[15px] font-semibold">Signature</b>
            <span className="text-muted-foreground text-sm">Added under emails you send.</span>
          </span>
          <Textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={4}
            placeholder={`${name}\nPartnerships lead`}
            aria-label="Signature"
            className="flex-[1_1_16rem]"
          />
        </div>
      </SettingsCard>
    </form>
  );
}

export function YourMailCard({
  orgId,
  bccAddress,
  inboundReady,
  shareMode,
  neverLog: initialNeverLog,
}: {
  orgId: string;
  bccAddress: string | null;
  inboundReady: boolean;
  shareMode: Share;
  neverLog: string[];
}) {
  const [share, setShare] = useState<Share>(shareMode);
  const [neverLog, setNeverLog] = useState(initialNeverLog.join("\n"));
  const { pending, status, save } = useSave();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveMemberSettingsAction(orgId, { shareMode: share, neverLog }));
      }}
    >
      <SettingsCard
        title="Your mail"
        description="What reaches the CRM from your mail is your choice. Gmail and Outlook connect here once they arrive."
        status={<SettingsStatus status={status} />}
        footer={
          <>
            {bccAddress && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  save(
                    () => saveMemberSettingsAction(orgId, { newBccAddress: true }),
                    "New address made. The old one stops working.",
                  )
                }
              >
                Make a new address
              </Button>
            )}
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-0 flex-[1_1_14rem]">
            <b className="block text-[15px] font-semibold">Your logging address</b>
            <span className="text-muted-foreground text-sm">
              {bccAddress
                ? "BCC it, or forward mail to it. Mail with people already here is logged; anyone new waits for your yes."
                : inboundReady
                  ? "Loading your address."
                  : "Incoming mail isn't set up on this server yet."}
            </span>
          </span>
          {bccAddress && <CopyLink url={bccAddress} label="Copy your address" />}
        </div>
        <div className="border-border flex flex-wrap items-center gap-3 border-t pt-4">
          <span className="min-w-0 flex-[1_1_14rem]">
            <b className="block text-[15px] font-semibold">What your mail shares</b>
            <span className="text-muted-foreground text-sm">
              {SHARE.find((s) => s.value === share)?.help}
            </span>
          </span>
          <Segmented
            label="What your mail shares"
            value={share}
            onSelect={(v) => setShare(v as Share)}
            options={SHARE}
          />
        </div>
        <div className="border-border flex flex-wrap items-start gap-3 border-t pt-4">
          <span className="min-w-0 flex-[1_1_14rem]">
            <b className="block text-[15px] font-semibold">Never log</b>
            <span className="text-muted-foreground text-sm">
              Addresses or domains, one a line: a doctor, a bank, family.
            </span>
          </span>
          <Textarea
            value={neverLog}
            onChange={(e) => setNeverLog(e.target.value)}
            rows={3}
            placeholder={"@mybank.com\nmom@family.net"}
            aria-label="Never log"
            className="flex-[1_1_16rem]"
          />
        </div>
      </SettingsCard>
    </form>
  );
}
