"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { createFolderAction } from "@/app/app/[orgSlug]/notes/folder-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Names and makes a Notes folder (Notes › New › Folder, and the Move dialog).
 * Folders are shared with the club; anyone can make one.
 */
export function NewFolderForm({
  orgId,
  onCreated,
  submitLabel = "Create folder",
  autoFocus = false,
}: {
  orgId: string;
  onCreated: (folder: { id: string; name: string }) => void;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await createFolderAction(orgId, name, null);
          if (!result.ok || !result.id) {
            setError(result.ok ? "That folder couldn't be made." : result.error);
            return;
          }
          onCreated({ id: result.id, name: name.replace(/\s+/g, " ").trim() });
          setName("");
        });
      }}
    >
      <div className="flex gap-2">
        <Input
          autoFocus={autoFocus}
          value={name}
          maxLength={80}
          placeholder="Folder name"
          aria-label="Folder name"
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {submitLabel}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
