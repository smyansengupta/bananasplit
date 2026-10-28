"use client";

import {
  FileSpreadsheet,
  Handshake,
  Lightbulb,
  Package,
  Plus,
  Sheet,
  Shirt,
  Table2,
  Upload,
  Users,
  type IconComponent,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { createDatabaseAction } from "@/app/app/[orgSlug]/databases/custom-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { IconChip } from "@/components/ui/stat";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { FieldSelect } from "@/components/ui/field-select";
import { DATABASE_TEMPLATES } from "@/lib/databases/templates";
import { readTableFile, SpreadsheetError, type SheetData } from "@/lib/finance/import/sheet";
import { cn } from "@/lib/utils";
import type { ImportSummary } from "@/server/databases/custom";

import { StepPills } from "../step-pills";
import { notice } from "../styles";
import { TableFrame } from "../table-frame";

const IMPORT_STEPS = ["Choose a file", "Check the preview", "Import"] as const;

const TEMPLATE_ICONS: Record<string, IconComponent> = {
  Table2,
  Sheet,
  Users,
  Package,
  Shirt,
  Handshake,
  Lightbulb,
};

/** What the import accepts: Excel workbooks, and CSV or TSV exports. */
const IMPORT_ACCEPT = [
  ".xlsx",
  ".xlsm",
  ".csv",
  ".tsv",
  ".txt",
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** A sheet of the chosen file, read in the browser for the preview. */
interface SheetPreview {
  name: string;
  hidden: boolean;
  rows: string[][];
  rowCount: number;
  columnCount: number;
}

function previewOf(sheet: SheetData): SheetPreview {
  return {
    name: sheet.name,
    hidden: sheet.hidden,
    rows: sheet.rows.slice(0, 4),
    // The first row names the fields.
    rowCount: Math.max(0, sheet.rows.length - 1),
    columnCount: Math.max(0, ...sheet.rows.slice(0, 200).map((r) => r.length)),
  };
}

/**
 * New database: start from a template (a blank spreadsheet among them), or
 * bring in a spreadsheet (an Excel workbook, CSV or TSV) and get a database
 * with a field per column. The file is read here first, for a preview and,
 * for a workbook with several tabs, the choice of which one. Either way it's
 * stored in Bananasplit: nothing to connect or host. Personal gets only the
 * templates that aren't about running a club.
 */
export function NewDatabaseDialog({
  orgId,
  orgSlug,
  trigger,
  defaultMode = "template",
  defaultTemplateId = "blank",
  personal = false,
}: {
  orgId: string;
  orgSlug: string;
  trigger?: React.ReactNode;
  defaultMode?: "template" | "import";
  defaultTemplateId?: string;
  /** A Personal space: its owner's alone, and no club templates. */
  personal?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"template" | "import">(defaultMode);
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetPreview[] | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const templates = personal ? DATABASE_TEMPLATES.filter((t) => t.personal) : DATABASE_TEMPLATES;
  const template = templates.find((t) => t.id === templateId) ?? templates[0]!;
  const sheet = sheets?.find((s) => s.name === sheetName) ?? sheets?.[0] ?? null;

  /** Reads the chosen file for the preview; the server reads it again to import. */
  async function choose(f: File | null) {
    setError(null);
    setFile(f);
    setSheets(null);
    setSheetName(null);
    if (!f) return;
    if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
    if (f.size > MAX_IMPORT_BYTES) {
      setError("That file is over 4 MB. Split it, or export fewer columns.");
      return;
    }
    setReading(true);
    try {
      const read = readTableFile(f.name, new Uint8Array(await f.arrayBuffer())).map(previewOf);
      setSheets(read);
      setSheetName((read.find((s) => !s.hidden) ?? read[0])?.name ?? null);
    } catch (e) {
      setError(
        e instanceof SpreadsheetError ? e.message : "That file couldn't be read as a spreadsheet.",
      );
    } finally {
      setReading(false);
    }
  }

  function create() {
    setError(null);
    start(async () => {
      if (mode === "template") {
        const result = await createDatabaseAction(orgId, {
          name: name || template.defaultName,
          templateId,
        });
        if (result.error || !result.data) {
          setError(result.error ?? "That didn't work.");
          return;
        }
        setOpen(false);
        router.push(`/app/${orgSlug}/databases/${result.data.key}`);
        return;
      }
      if (!file) {
        setError("Choose a spreadsheet first.");
        return;
      }
      if (file.size > MAX_IMPORT_BYTES) {
        setError("That file is over 4 MB. Split it, or export fewer columns.");
        return;
      }
      // The file goes to a route handler: a Server Action takes at most 1 MB.
      const body = new FormData();
      body.set("file", file);
      body.set("name", name || file.name.replace(/\.[^.]+$/, ""));
      if (sheet) body.set("sheet", sheet.name);
      let result: Partial<ImportSummary> & { error?: string };
      try {
        const res = await fetch(`/app/${orgSlug}/databases/import`, { method: "POST", body });
        result = await res.json().catch(() => ({ error: "The server didn't answer. Try again." }));
      } catch {
        result = { error: "Couldn't reach Bananasplit. Check your connection and try again." };
      }
      if (result.error || !result.key) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      const { rows = 0, fields = 0, skippedCells = 0, key } = result;
      toast({
        title: `Imported ${rows.toLocaleString()} rows`,
        description: `${fields} fields${skippedCells ? `; ${skippedCells} values didn't fit their column and were left empty` : ""}.`,
      });
      setOpen(false);
      router.push(`/app/${orgSlug}/databases/${key}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setMode(defaultMode);
          setTemplateId(defaultTemplateId);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="create">
            <Plus aria-hidden="true" />
            New database
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New database</DialogTitle>
          <DialogDescription>
            {personal
              ? "Stored in Bananasplit and saved as you type. Only you can see it."
              : "Stored in Bananasplit and saved as you type. Only your organization can see it, and you choose which members."}
          </DialogDescription>
        </DialogHeader>

        <Segmented
          label="How to start"
          value={mode}
          onSelect={(v) => setMode(v as "template" | "import")}
          options={[
            { value: "template", label: "Start from a template", icon: Table2 },
            { value: "import", label: "Import a spreadsheet", icon: FileSpreadsheet },
          ]}
        />

        {mode === "template" ? (
          <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Template">
            {templates.map((t) => {
              const Icon = TEMPLATE_ICONS[t.icon] ?? Table2;
              const active = t.id === templateId;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTemplateId(t.id)}
                  className={cn(
                    "rounded-tile focus-visible:outline-foreground flex items-start gap-3 p-3.5 text-left transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2",
                    active ? "bg-card ring-foreground ring-2" : "bg-muted/60 hover:bg-muted",
                  )}
                >
                  <IconChip
                    icon={Icon}
                    className={cn(active && "bg-primary text-primary-foreground ring-0")}
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-sm font-semibold">{t.name}</span>
                    <span className="text-muted-foreground block text-xs leading-relaxed">
                      {t.description}
                    </span>
                    <span className="text-muted-foreground block truncate pt-0.5 text-xs">
                      {t.fields.map((f) => f.name).join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            <StepPills
              steps={IMPORT_STEPS}
              current={pending ? 2 : sheet ? 1 : 0}
              label="Import steps"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void choose(e.dataTransfer.files?.[0] ?? null);
              }}
              className="hover:bg-muted/40 border-border rounded-block focus-visible:outline-foreground flex w-full flex-col items-center gap-2.5 border-[1.5px] border-dashed p-6 text-center transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <IconChip icon={Upload} />
              <span className="text-sm font-semibold">
                {reading
                  ? "Reading it…"
                  : file
                    ? file.name
                    : "Choose a spreadsheet, or drop it here"}
              </span>
              <span className="text-muted-foreground text-xs">
                Excel (.xlsx), CSV or TSV, from Excel, Google Sheets or Numbers. The first row is
                the field names; each field&apos;s type is worked out from its values. Up to 10,000
                rows and 4 MB.
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={IMPORT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                void choose(f);
              }}
            />
            {sheets && sheets.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="new-db-sheet">Sheet</Label>
                <FieldSelect
                  id="new-db-sheet"
                  value={sheet?.name ?? ""}
                  onChange={(e) => setSheetName(e.target.value)}
                  className="w-full"
                >
                  {sheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                      {s.hidden ? " (hidden)" : ""} · {s.rowCount.toLocaleString()} rows
                    </option>
                  ))}
                </FieldSelect>
              </div>
            )}
            {sheet && <SheetPreviewTable sheet={sheet} />}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="new-db-name">Name</Label>
          <Input
            id="new-db-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              mode === "template" ? template.defaultName : "Name it after the spreadsheet"
            }
          />
        </div>

        {error && (
          <p className={notice.error} role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={create}
            disabled={pending || reading || (mode === "import" && (!file || !sheet))}
          >
            {pending
              ? mode === "import"
                ? "Importing…"
                : "Creating…"
              : mode === "import"
                ? "Import"
                : "Create database"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PREVIEW_COLUMNS = 6;

/** The first rows of the sheet about to be imported, as the grid will show them. */
function SheetPreviewTable({ sheet }: { sheet: SheetPreview }) {
  const [header, ...rows] = sheet.rows;
  const columns = Math.min(PREVIEW_COLUMNS, sheet.columnCount);
  const more = sheet.columnCount - columns;
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs">
        {sheet.rowCount.toLocaleString()} {sheet.rowCount === 1 ? "row" : "rows"} ·{" "}
        {sheet.columnCount} {sheet.columnCount === 1 ? "field" : "fields"}
        {sheet.columnCount > 60 && " (the first 60 come in)"}
      </p>
      <TableFrame bare maxHeight="none">
        <Table>
          <TableHeader>
            <TableRow>
              {Array.from({ length: columns }, (_, i) => (
                <TableHead key={i}>{header?.[i]?.trim() || `Column ${i + 1}`}</TableHead>
              ))}
              {more > 0 && <TableHead className="font-normal">+{more} more</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, r) => (
              <TableRow key={r}>
                {Array.from({ length: columns }, (_, i) => (
                  <TableCell key={i} className="h-10 max-w-40 truncate text-[13px]">
                    {row[i] ?? ""}
                  </TableCell>
                ))}
                {more > 0 && <TableCell className="h-10" />}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>
    </div>
  );
}
