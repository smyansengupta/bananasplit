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

import { ContactSearch, type ContactOption } from "./contact-search";

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
    <div className="space-y-4 rounded-md border p-3 text-sm">
      <p className="font-medium">Manage this person</p>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Display name" />
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !name.trim() || name === contact.displayName}
          onClick={() =>
            go(() => renameContactAction(organizationId, contact.id, name), "Renamed.")
          }
        >
          Rename
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <select
          aria-label="Linked member"
          defaultValue={contact.userId ?? ""}
          className="border-input bg-background h-8 flex-1 rounded-md border px-2"
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
        </select>
      </div>
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
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
              Merge
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
          <p className="text-muted-foreground text-xs">
            Split an address off into its own person (unmerge):
          </p>
          {contact.emails.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs">
                {e.emailNormalized}
                {e.isPrimary ? " (primary)" : ""}
              </span>
              <Button
                size="xs"
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
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      {notice && <p className="text-success text-xs">{notice}</p>}
    </div>
  );
}
