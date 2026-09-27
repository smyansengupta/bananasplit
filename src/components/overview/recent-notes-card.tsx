import { formatDistanceToNow } from "date-fns";
import { Lock, NotebookText } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecentNote } from "@/app/app/[orgSlug]/notes/queries";

/** Notes the viewer may read, most recently edited first. */
export function RecentNotesCard({
  orgSlug,
  notes,
  className,
}: {
  orgSlug: string;
  notes: readonly RecentNote[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Recently edited notes</CardTitle>
        <CardAction>
          <Link
            href={`/app/${orgSlug}/notes`}
            className="text-muted-foreground text-sm hover:underline"
          >
            All notes
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {notes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No notes yet.</p>
        ) : (
          <ul className="divide-y">
            {notes.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/app/${orgSlug}/notes/${note.id}`}
                  className="hover:bg-accent/50 -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <NotebookText
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">{note.title || "Untitled note"}</span>
                    {note.visibility === "PRIVATE" && (
                      <Badge variant="outline" className="gap-1">
                        <Lock className="size-3" aria-hidden="true" />
                        Private
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {note.updatedBy.name ? `${note.updatedBy.name} · ` : ""}
                    {formatDistanceToNow(note.updatedAt, { addSuffix: true })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
