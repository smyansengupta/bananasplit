"use client";

import { ExternalLink, Video } from "@/components/icons";
import { useRouter } from "next/navigation";

import { setMeetingRecording } from "@/app/app/[orgSlug]/meetings/actions";
import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Input } from "@/components/ui/input";

/**
 * The meeting's recording, once it has happened: a link for everyone, and
 * for hosts a field to paste it into (it saves when you click away). Past
 * links it under After as "Recording".
 */
export function MeetingRecording({
  orgId,
  eventId,
  initial,
  canEdit,
}: {
  orgId: string;
  eventId: string;
  initial: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { status, error, save } = useSaveOnChange(
    async (url: string) => {
      const result = await setMeetingRecording(orgId, eventId, url);
      if (result.error) return result.error;
      router.refresh();
    },
    { initial: initial ?? "" },
  );

  if (!canEdit) {
    if (!initial) return null;
    return (
      <a
        href={initial}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
      >
        <Video className="text-muted-foreground size-4" aria-hidden="true" />
        Recording
        <ExternalLink className="text-muted-foreground size-3.5" aria-hidden="true" />
      </a>
    );
  }
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <Video className="text-muted-foreground size-4" aria-hidden="true" />
      <span className="font-medium">Recording</span>
      <Input
        type="url"
        inputMode="url"
        defaultValue={initial ?? ""}
        placeholder="Paste the link"
        aria-label="Recording link"
        onBlur={(e) => void save(e.target.value.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 min-w-0 flex-1 basis-56"
      />
      <SavedMark status={status} error={error} />
    </label>
  );
}
