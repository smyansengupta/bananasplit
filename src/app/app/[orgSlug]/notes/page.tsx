import { FileText, FolderOpen, NotebookText } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { FileCard } from "@/components/notes/file-card";
import { NoteCard } from "@/components/notes/note-card";
import { NotesNewMenu } from "@/components/notes/notes-new-menu";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { cn } from "@/lib/utils";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listNoteFiles } from "@/server/notes/files";

import { NotesListFilters } from "./notes-list-filters";
import { getNotesForList, getOrgMembersForFilter } from "./queries";

/**
 * Notes: the club's notes, and a Files tab for PDFs, slides, images and
 * other uploads (each opens in an in-app preview). "New" makes a blank note,
 * turns a Word document or Google Doc into one, or uploads a file.
 */
export default async function NotesPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/notes">) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const { organization: org, user } = await getOrgContextBySlug(orgSlug);
  const tab = query.tab === "files" ? "files" : "notes";

  const visibility =
    typeof query.visibility === "string" && query.visibility !== "all"
      ? (query.visibility as "PRIVATE" | "ORGANIZATION")
      : undefined;
  const author =
    typeof query.author === "string" && query.author !== "all" ? query.author : undefined;

  // One transaction, so the reads run one after another on its connection.
  const { notes, memberships, files } = await withOrgTx(org.id, async ({ db }) => ({
    notes: await getNotesForList(db, org.id, user.id, { visibility, authorId: author }),
    memberships: await getOrgMembersForFilter(db, org.id),
    files: await listNoteFiles(db, org.id),
  })).catch(handleAuthErrorInPage);

  const members = memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
  }));
  const base = `/app/${orgSlug}/notes`;
  const tabs = [
    { id: "notes", label: "Notes", icon: NotebookText, href: base, count: notes.length },
    { id: "files", label: "Files", icon: FolderOpen, href: `${base}?tab=files`, count: files.length },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <NotesNewMenu orgId={org.id} orgSlug={orgSlug} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-b">
        <nav aria-label="Notes sections">
          <ul className="-mb-px flex gap-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <li key={t.id}>
                  <Link
                    href={t.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-primary text-foreground"
                        : "text-muted-foreground hover:text-foreground border-transparent",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {t.label}
                    <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px] tabular-nums">
                      {t.count}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {tab === "notes" && (
          <div className="pb-2">
            <NotesListFilters members={members} />
          </div>
        )}
      </div>

      {tab === "notes" ? (
        notes.length === 0 ? (
          <EmptyState
            icon={NotebookText}
            title={visibility || author ? "No notes match these filters" : "No notes yet"}
            description="Capture meeting minutes, plans and ideas. Start blank, or bring in a Word document or Google Doc with “New”."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {notes.map((note) => (
              <NoteCard key={note.id} note={note} orgSlug={orgSlug} />
            ))}
          </div>
        )
      ) : files.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No files yet"
          description="Upload PDFs, slides, spreadsheets and images with “New” › Upload a file. They open right here, no download needed."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((file) => (
            <FileCard key={file.id} file={file} orgSlug={orgSlug} />
          ))}
        </div>
      )}
    </div>
  );
}
