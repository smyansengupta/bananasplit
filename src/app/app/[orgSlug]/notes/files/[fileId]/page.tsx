import { format } from "date-fns";
import { BackLink } from "@/components/back-link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { FILE_ICONS, FILE_LABELS } from "@/components/notes/file-card";
import { DocumentPreview, FileActions, FileDetails } from "@/components/notes/file-preview";
import { can } from "@/lib/auth/permissions";
import { isPersonalSpace } from "@/lib/billing/space";
import { familyOf, formatBytes } from "@/lib/files/types";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listFolders } from "@/server/notes/folders";
import { docxToHtml, FileRejectedError, readNoteFile } from "@/server/notes/files";
import { planGate } from "@/server/billing/plan-gate";

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
 * An uploaded file in Files, shown in the app: PDFs in the browser's viewer
 * (a same-origin frame), images, Word documents as a read-only note, text
 * and CSV as they are. Slides and spreadsheets download.
 *
 * Its name, who can see it and its folder are edited right here (click
 * the name). Back returns to the folder it's in. A Word document offers
 * Make a note, and a spreadsheet or CSV Make a database, as buttons.
 */
export default async function NoteFilePage({
  params,
}: PageProps<"/app/[orgSlug]/notes/files/[fileId]">) {
  const { orgSlug, fileId } = await params;
  const planLock = await planGate(orgSlug, "files");
  if (planLock) return planLock;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const found = await readNoteFile(org.id, fileId);
  if (!found) notFound();
  const { row, body } = found;
  const family = familyOf(row.contentType);
  const Icon = FILE_ICONS[family];
  const src = `/api/orgs/${encodeURIComponent(org.id)}/files/${encodeURIComponent(row.id)}`;
  const canRemove = row.uploadedBy.id === user.id || can({ role }, "members.invite");
  const personal = isPersonalSpace(org);
  const folders = await withOrgTx(org.id, ({ db }) => listFolders(db, org.id, user.id));
  const inFolder = row.folderId ? folders.find((f) => f.id === row.folderId) : undefined;
  const back = inFolder
    ? {
        href: `/app/${orgSlug}/notes?folder=${encodeURIComponent(inFolder.id)}`,
        label: inFolder.name,
      }
    : { href: `/app/${orgSlug}/notes`, label: "Files" };
  // A spreadsheet or CSV can become a database (Databases opens its import on it).
  const tabular =
    row.contentType === "text/csv" ||
    row.contentType === "text/tab-separated-values" ||
    family === "sheet";
  const tableHref = tabular
    ? `/app/${orgSlug}/databases?fromFile=${encodeURIComponent(row.id)}`
    : null;

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
      <BackLink href={back.href} label={back.label} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Icon className="text-muted-foreground mt-2 size-5 shrink-0" aria-hidden="true" />
          <FileDetails
            orgId={org.id}
            fileId={row.id}
            name={row.name}
            meta={[
              `${FILE_LABELS[family]}, ${formatBytes(row.sizeBytes)}`,
              `${row.uploadedBy.name ?? "A member"}, ${format(row.createdAt, "MMM d, yyyy")}`,
            ]}
            visibility={row.visibility}
            folderId={row.folderId}
            folders={folders.map((f) => ({ id: f.id, name: f.name }))}
            canEdit={canRemove}
            personal={personal}
          />
        </div>
        <FileActions
          orgId={org.id}
          orgSlug={orgSlug}
          fileId={row.id}
          name={row.name}
          canRemove={canRemove}
          noteHtml={docHtml}
          tableHref={tableHref}
          backHref={back.href}
        />
      </div>

      <div className="bg-card overflow-hidden rounded-xl border">
        {family === "pdf" ? (
          <iframe src={src} title={row.name} className="h-[80vh] w-full" />
        ) : family === "image" ? (
          <div className="bg-muted/30 grid place-items-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a private, permission-checked file */}
            <img
              src={src}
              alt={row.name}
              className="max-h-[75vh] max-w-full rounded-md object-contain"
            />
          </div>
        ) : family === "word" ? (
          docHtml != null ? (
            <div className="bg-muted/50 max-h-[80vh] overflow-y-auto px-3 py-6 sm:px-8 sm:py-10">
              <article className="bg-background mx-auto min-h-[60vh] max-w-[52rem] rounded-md border px-6 py-10 sm:px-16 sm:py-14">
                <DocumentPreview html={docHtml} />
              </article>
            </div>
          ) : (
            <EmptyState
              size="compact"
              title="This document can't be shown"
              description={docError ?? undefined}
            />
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
          <div className="bg-muted/50 max-h-[80vh] overflow-y-auto px-3 py-6 sm:px-8 sm:py-10">
            <pre className="bg-background mx-auto max-w-[52rem] rounded-md border px-6 py-8 font-sans text-sm leading-relaxed whitespace-pre-wrap sm:px-12">
              {text}
            </pre>
          </div>
        ) : (
          <EmptyState size="compact" title="No preview. Download to open." />
        )}
      </div>
    </div>
  );
}
