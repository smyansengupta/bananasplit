import { formatDistanceToNow } from "date-fns";
import { CalendarDays, Lock, Users } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/components/tasks/utils";

export interface NoteCardData {
  id: string;
  title: string;
  contentText: string;
  visibility: "PRIVATE" | "ORGANIZATION";
  updatedAt: Date;
  author: { id: string; name: string | null; email: string; image: string | null };
  event: { id: string; title: string; startsAt: Date } | null;
}

export function NoteCard({ note, orgSlug }: { note: NoteCardData; orgSlug: string }) {
  const snippet = note.contentText.trim().slice(0, 160);

  return (
    <Link
      href={`/app/${orgSlug}/notes/${note.id}`}
      className="bg-card hover:border-foreground/20 focus-visible:ring-ring flex flex-col gap-2 rounded-md border p-4 text-sm shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-1 font-medium">{note.title || "Untitled note"}</p>
        <Badge variant={note.visibility === "PRIVATE" ? "outline" : "secondary"} className="gap-1">
          {note.visibility === "PRIVATE" ? (
            <Lock className="size-3" aria-hidden="true" />
          ) : (
            <Users className="size-3" aria-hidden="true" />
          )}
          {note.visibility === "PRIVATE" ? "Private" : "Org"}
        </Badge>
      </div>

      {snippet && <p className="text-muted-foreground line-clamp-3">{snippet}</p>}

      {note.event && (
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <CalendarDays className="size-3.5" aria-hidden="true" />
          {note.event.title}
        </span>
      )}

      <div className="text-muted-foreground mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="flex items-center gap-1.5">
          <Avatar className="size-5">
            {note.author.image && <AvatarImage src={note.author.image} alt="" />}
            <AvatarFallback className="text-[9px]">
              {initials(note.author.name ?? note.author.email)}
            </AvatarFallback>
          </Avatar>
          {note.author.name ?? note.author.email}
        </span>
        <span>{formatDistanceToNow(note.updatedAt, { addSuffix: true })}</span>
      </div>
    </Link>
  );
}
