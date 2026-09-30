import { format } from "date-fns";
import { ArrowLeft, Lock, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { FILE_ICONS, FILE_LABELS } from "@/components/notes/file-card";
import { DocumentPreview, FileActions } from "@/components/notes/file-preview";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { familyOf, formatBytes } from "@/lib/files/types";
import { getOrgContextBySlug } from "@/server/db/context";
import { docxToHtml, FileRejectedError, readNoteFile } from "@/server/notes/files";

const MAX_TEXT_CHARS = 200_000;
const MAX_CSV_ROWS = 200;

/** A small CSV reader for the preview: quoted fields, doubled quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < MAX_CSV_ROWS; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

/**
 * A Notes page file, shown in the app: PDFs in the browser's viewer (a
 * same-origin frame), images, Word documents as a read-only note, text and
 * CSV as they are. Slides and spreadsheets download.
 */
export default async function NoteFilePage({
  params,
}: PageProps<"/app/[orgSlug]/notes/files/[fileId]">) {
  const { orgSlug, fileId } = await params;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const found = await readNoteFile(org.id, fileId);
  if (!found) notFound();
  const { row, body } = found;
  const family = familyOf(row.contentType);
  const Icon = FILE_ICONS[family];
  const src = `/api/orgs/${encodeURIComponent(org.id)}/files/${encodeURIComponent(row.id)}`;
  const canRemove = row.uploadedBy.id === user.id || can({ role }, "members.invite");

  let docHtml: string | null = null;
  let docError: string | null = null;
  if (family === "word") {
    try {
      docHtml = await docxToHtml(body);
    } catch (error) {
      if (!(error instanceof FileRejectedError)) throw error;
      docError = error.message;
    }
  }
  const text = family === "text" ? body.toString("utf8").slice(0, MAX_TEXT_CHARS) : null;
  const csv = row.contentType === "text/csv" && text ? parseCsv(text) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        href={`/app/${orgSlug}/notes?tab=files`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Files
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="bg-primary/10 text-primary grid size-11 shrink-0 place-items-center rounded-lg">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{row.name}</h1>
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
              <span>
                {FILE_LABELS[family]} · {formatBytes(row.sizeBytes)}
              </span>
              <span>
                {row.uploadedBy.name ?? "A member"}, {format(row.createdAt, "MMM d, yyyy")}
              </span>
              <Badge variant={row.visibility === "PRIVATE" ? "outline" : "secondary"} className="gap-1">
                {row.visibility === "PRIVATE" ? (
                  <Lock className="size-3" aria-hidden="true" />
                ) : (
                  <Users className="size-3" aria-hidden="true" />
                )}
                {row.visibility === "PRIVATE" ? "Only you" : "Everyone in the club"}
              </Badge>
            </p>
          </div>
        </div>
        <FileActions
          orgId={org.id}
          orgSlug={orgSlug}
          fileId={row.id}
          name={row.name}
          canRemove={canRemove}
          noteHtml={docHtml}
        />
      </div>

      <div className="bg-card overflow-hidden rounded-xl border">
        {family === "pdf" ? (
          <iframe src={src} title={row.name} className="h-[80vh] w-full" />
        ) : family === "image" ? (
          <div className="bg-muted/30 grid place-items-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a private, permission-checked file */}
            <img src={src} alt={row.name} className="max-h-[75vh] max-w-full rounded-md object-contain" />
          </div>
        ) : family === "word" ? (
          docHtml != null ? (
            <div className="mx-auto max-w-3xl p-6 sm:p-10">
              <DocumentPreview html={docHtml} />
            </div>
          ) : (
            <EmptyState size="compact" title="This document can't be shown" description={docError ?? undefined} />
          )
        ) : csv ? (
          <div className="max-h-[75vh] overflow-auto">
            <table className="w-full text-sm">
              <tbody>
                {csv.map((cells, i) => (
                  <tr key={i} className={i === 0 ? "bg-muted/60 font-medium" : "border-t"}>
                    {cells.map((cell, j) => (
                      <td key={j} className="px-3 py-1.5 whitespace-nowrap">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : text != null ? (
          <pre className="max-h-[75vh] overflow-auto p-6 text-sm whitespace-pre-wrap">{text}</pre>
        ) : (
          <EmptyState
            size="compact"
            icon={Icon}
            title={`${FILE_LABELS[family]} files don't have a preview yet`}
            description="Download it to open it in its own app."
          />
        )}
      </div>
    </div>
  );
}
