"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  linkContactAction,
  mergeContactsAction,
  renameContactAction,
  splitContactEmailAction,
} from "@/app/app/[orgSlug]/databases/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldSelect } from "@/components/ui/field-select";

import { ContactSearch, type ContactOption } from "./contact-search";
import { notice as noticeClass } from "./styles";

/**
 * Admin tools for the person behind a row: rename, link to a member
 * account, merge a duplicate into this person, split an address off
 * (unmerge). Merges run on the service path after the permission check.
 */
export function ContactActions({
  organizationId,
  contact,
  members,
}: {
  organizationId: string;
  contact: {
    id: string;
    displayName: string | null;
    userId: string | null;
    emails: { id: string; emailNormalized: string; isPrimary: boolean }[];
  };
  members: { id: string; name: string | null }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(contact.displayName ?? "");
  const [merge, setMerge] = useState<ContactOption | null>(null);

  const go = (fn: () => Promise<{ error?: string }>, done?: string) => {
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        if (done) setNotice(done);
        router.refresh();
      }
    });
  };

  return (
    <div className="bg-muted/60 rounded-tile space-y-4 p-4 text-sm">
      <h3 className="heading text-[15px]">Manage this person</h3>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Display name" />
        <Button
          variant="outline"
          disabled={pending || !name.trim() || name === contact.displayName}
          onClick={() =>
            go(() => renameContactAction(organizationId, contact.id, name), "Renamed.")
          }
        >
          Rename
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <FieldSelect
          aria-label="Linked member"
          defaultValue={contact.userId ?? ""}
          className="w-full"
          onChange={(e) =>
            go(
              () => linkContactAction(organizationId, contact.id, e.target.value || null),
              "Link saved.",
            )
          }
          disabled={pending}
        >
          <option value="">Not linked to a member</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? "Member"}
            </option>
          ))}
        </FieldSelect>
      </div>
      <div className="space-y-2">
        <p className="text-muted-foreground text-[13px]">
          Merge a duplicate into this person: their check-ins, signups and addresses move here.
        </p>
        {merge ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Merge <strong>{merge.displayName ?? merge.emailMasked}</strong> into this person?
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                go(async () => {
                  const r = await mergeContactsAction(organizationId, contact.id, merge.id);
                  if (!r.error) setMerge(null);
                  return r;
                }, "Merged.")
              }
            >
              Merge person
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMerge(null)}>
              Cancel
            </Button>
          </div>
        ) : (
          <ContactSearch
            organizationId={organizationId}
            excludeId={contact.id}
            onPick={setMerge}
            placeholder="Find a duplicate…"
          />
        )}
      </div>
      {contact.emails.length > 1 && (
        <div className="space-y-1">
          <p className="text-muted-foreground text-[13px]">
            Split an address off into its own person (unmerge):
          </p>
          {contact.emails.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs break-all">
                {e.emailNormalized}
                {e.isPrimary ? " (primary)" : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  go(() => splitContactEmailAction(organizationId, contact.id, e.id), "Split off.")
                }
              >
                Split off
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className={noticeClass.error}>
          {error}
        </p>
      )}
      {notice && <p className={noticeClass.success}>{notice}</p>}
    </div>
  );
}
