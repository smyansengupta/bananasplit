import { NotebookText } from "lucide-react";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { NoteCard } from "@/components/notes/note-card";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

import { NewNoteButton } from "./new-note-button";
import { NotesListFilters } from "./notes-list-filters";
import { getNotesForList, getOrgMembersForFilter } from "./queries";

export default async function NotesPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/notes">) {
  const { orgSlug } = await params;
  const query = await searchParams;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  let ctx: OrgContext;
  try {
    ctx = await requireOrgMembership(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const visibility =
    typeof query.visibility === "string" && query.visibility !== "all"
      ? (query.visibility as "PRIVATE" | "ORGANIZATION")
      : undefined;
  const author =
    typeof query.author === "string" && query.author !== "all" ? query.author : undefined;

  const [notes, memberships] = await Promise.all([
    getNotesForList(org.id, ctx.user.id, { visibility, authorId: author }),
    getOrgMembersForFilter(org.id),
  ]);

  const members = memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <div className="flex flex-wrap items-center gap-3">
          <NotesListFilters members={members} />
          <NewNoteButton orgId={org.id} orgSlug={orgSlug} />
        </div>
      </div>

      {notes.length === 0 ? (
        <EmptyState
          icon={NotebookText}
          title="No notes yet"
          description="Create a note to start capturing meeting minutes, plans, and ideas."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} orgSlug={orgSlug} />
          ))}
        </div>
      )}
    </div>
  );
}
