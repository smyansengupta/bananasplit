import { formatDistanceToNow } from "date-fns";
import {
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  Lock,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { familyOf, formatBytes, type FileFamily } from "@/lib/files/types";
import { cn } from "@/lib/utils";

export const FILE_ICONS: Record<FileFamily, LucideIcon> = {
  pdf: FileType2,
  image: FileImage,
  word: FileText,
  slides: Presentation,
  sheet: FileSpreadsheet,
  text: FileText,
};

export const FILE_LABELS: Record<FileFamily, string> = {
  pdf: "PDF",
  image: "Image",
  word: "Word",
  slides: "Slides",
  sheet: "Spreadsheet",
  text: "Text",
};

export interface FileCardData {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  visibility: "PRIVATE" | "ORGANIZATION";
  createdAt: Date;
  uploadedBy: { name: string | null };
}

/** A file on the Notes page; opens its in-app preview. */
export function FileCard({ file, orgSlug }: { file: FileCardData; orgSlug: string }) {
  const family = familyOf(file.contentType);
  const Icon = FILE_ICONS[family];
  return (
    <Link
      href={`/app/${orgSlug}/notes/files/${file.id}`}
      className="bg-card hover:border-foreground/20 focus-visible:ring-ring flex items-center gap-3 rounded-xl border p-3 text-sm shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-lg",
          family === "pdf" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="truncate">{file.name}</span>
          {file.visibility === "PRIVATE" && (
            <Lock className="text-muted-foreground size-3 shrink-0" aria-label="Only you" />
          )}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {FILE_LABELS[family]} · {formatBytes(file.sizeBytes)} · {file.uploadedBy.name ?? "A member"},{" "}
          {formatDistanceToNow(file.createdAt, { addSuffix: true })}
        </span>
      </span>
    </Link>
  );
}
