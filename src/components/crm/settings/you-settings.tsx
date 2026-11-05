"use client";

import { useState } from "react";

import { saveMemberSettingsAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { turnOnBookingAction } from "@/app/app/[orgSlug]/crm/settings-actions";
import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { AmbientActions } from "@/components/ambient/ambient-button";
import { CopyLink } from "@/components/crm/outreach/booking";
import { Button } from "@/components/ui/button";
import { SavedMark } from "@/components/ui/autosave";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";

import { useAutoSave } from "./use-save";

/**
 * CRM settings > You (every member, only theirs): your signature, your
 * logging address, what your mail shares, and your meeting link, each saved
 * as you change it. What's never logged and a new address go under More.
 */

type Share = "NONE" | "METADATA" | "FULL";

const SHARE: { value: Share; label: string; help: string }[] = [
  {
    value: "FULL",
    label: "Full messages",
    help: "The CRM keeps the subject and what was written.",
  },
  {
    value: "METADATA",
    label: "Who and when",
    help: "The CRM sees that you emailed someone, not what was said.",
  },
  {
    value: "NONE",
    label: "Nothing",
    help: "Your mail never reaches the CRM. Replies to your plans still stop them.",
  },
];

function Row({
  title,
  hint,
  top = false,
  children,
}: {
  title: string;
  hint?: string;
  top?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`border-border flex flex-wrap gap-3 border-t pt-4 first:border-t-0 first:pt-0 ${top ? "items-start" : "items-center"}`}
    >
      <span className="min-w-0 flex-[1_1_14rem]">
        <b className="block text-[15px] font-semibold">{title}</b>
        {hint && <span className="text-muted-foreground text-sm">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

export function YourMailCard({
  orgId,
  name,
  signature: initialSignature,
  bccAddress,
  shareMode,
}: {
  orgId: string;
  name: string;
  signature: string;
  bccAddress: string | null;
  shareMode: Share;
}) {
  const [share, setShare] = useState<Share>(shareMode);
  const auto = useAutoSave((patch: Parameters<typeof saveMemberSettingsAction>[1]) =>
    saveMemberSettingsAction(orgId, patch),
  );
  return (
    <SettingsCard
      title="Your mail"
      action={<SavedMark status={auto.status} error={auto.error} />}
    >
      <Row title="Signature" hint="Added under emails you send." top>
        <Textarea
          defaultValue={initialSignature}
          onBlur={(e) => {
            if (e.target.value !== initialSignature) void auto.save({ signature: e.target.value });
          }}
          rows={3}
          placeholder={`${name}\nPartnerships lead`}
          aria-label="Signature"
          className="flex-[1_1_16rem]"
        />
      </Row>
      {bccAddress && (
        <Row title="Your logging address" hint="BCC it, or forward mail to it.">
          <CopyLink url={bccAddress} label="Copy your address" />
        </Row>
      )}
      <Row title="What your mail shares" hint={SHARE.find((s) => s.value === share)?.help}>
        <Segmented
          label="What your mail shares"
          value={share}
          onSelect={(v) => {
            setShare(v as Share);
            void auto.save({ shareMode: v as Share });
          }}
          options={SHARE}
        />
      </Row>
    </SettingsCard>
  );
}

/** What's rarely changed: what's never logged, and a fresh logging address. */
export function MailExtrasCard({
  orgId,
  bccAddress,
  neverLog: initial,
}: {
  orgId: string;
  bccAddress: string | null;
  neverLog: string[];
}) {
  const auto = useAutoSave((patch: Parameters<typeof saveMemberSettingsAction>[1]) =>
    saveMemberSettingsAction(orgId, patch),
  );
  const neverLog = initial.join("\n");
  return (
    <SettingsCard
      title="Logging"
      action={<SavedMark status={auto.status} error={auto.error} />}
    >
      <Row title="Never log" hint="Addresses or domains, one a line." top>
        <Textarea
          defaultValue={neverLog}
          onBlur={(e) => {
            if (e.target.value !== neverLog) void auto.save({ neverLog: e.target.value });
          }}
          rows={3}
          placeholder={"@mybank.com\nmom@family.net"}
          aria-label="Never log"
          className="flex-[1_1_16rem]"
        />
      </Row>
      {bccAddress && (
        <Row title="A new logging address" hint="The old one stops working.">
          <Button
            type="button"
            variant="outline"
            onClick={() => void auto.save({ newBccAddress: true })}
          >
            Make a new address
          </Button>
        </Row>
      )}
    </SettingsCard>
  );
}

/** Your meeting link: copy it when it's on, turn it on right here when it's off. */
export function YourBookingCard({
  orgId,
  url,
  href,
}: {
  orgId: string;
  /** The live link; null while it's off. */
  url: string | null;
  /** Its hours and details, in Meetings. */
  href: string;
}) {
  return (
    <SettingsCard
      title="Your meeting link"
      action={
        <Button variant="outline" size="sm" asChild>
          <a href={href}>Change it in Meetings</a>
        </Button>
      }
    >
      {url ? (
        <CopyLink url={url} label="Copy your meeting link" />
      ) : (
        <AmbientActions
          why
          className="items-start"
          actions={[
            {
              key: "on",
              label: "Turn it on",
              tone: "solid",
              reason: "It's off, so nobody can book you",
              run: () => turnOnBookingAction(orgId),
              done: "Your meeting link is on.",
            },
          ]}
        />
      )}
    </SettingsCard>
  );
}
