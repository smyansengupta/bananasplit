"use client";

import { FileSpreadsheet } from "@/components/icons";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { toast } from "@/components/ui/toaster";

import { NewDatabaseDialog } from "./new-database-dialog";

/** What can become a database: a workbook, or a CSV or TSV export. */
const SHEET_FILE = /\.(xlsx|xlsm|csv|tsv|txt)$/i;

/** The name a download says it is (Content-Disposition), or a stand-in by its type. */
function nameFrom(res: Response): string {
  const header = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(header);
  if (plain?.[1]) return plain[1];
  const type = res.headers.get("content-type") ?? "";
  return type.includes("spreadsheetml") ? "spreadsheet.xlsx" : "spreadsheet.csv";
}

/**
 * The Databases page's quiet importer: drop a spreadsheet anywhere on the
 * page and its import preview opens, with no dialog to find first. It also
 * picks up a file sent from Files ("Make a database" on a CSV or workbook,
 * `?fromFile=`), fetched the same way a download is, so the import is the
 * same one as everywhere else.
 */
export function DatabaseFileImport({
  orgId,
  orgSlug,
  personal,
  fromFile,
}: {
  orgId: string;
  orgSlug: string;
  personal: boolean;
  /** An uploaded file's id, from Files. */
  fromFile: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fetched = useRef<string | null>(null);

  // A file from Files: fetch it once, then drop the parameter from the address.
  useEffect(() => {
    if (!fromFile || fetched.current === fromFile) return;
    fetched.current = fromFile;
    void (async () => {
      try {
        const res = await fetch(
          `/api/orgs/${encodeURIComponent(orgId)}/files/${encodeURIComponent(fromFile)}?download=1`,
        );
        if (!res.ok) throw new Error("not ok");
        const blob = await res.blob();
        setFile(new File([blob], nameFrom(res), { type: blob.type }));
        setOpen(true);
      } catch {
        toast({ title: "Couldn't open that file", tone: "error" });
      } finally {
        router.replace(pathname, { scroll: false });
      }
    })();
  }, [fromFile, orgId, pathname, router]);

  // A spreadsheet dropped anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (isFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (e.defaultPrevented || !isFiles(e)) return;
      e.preventDefault();
      const picked = Array.from(e.dataTransfer?.files ?? []).find((f) => SHEET_FILE.test(f.name));
      if (!picked) {
        toast({ title: "Drop an Excel, CSV or TSV file", tone: "error" });
        return;
      }
      setFile(picked);
      setOpen(true);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <>
      {dragging && !open && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40">
          <span className="border-foreground/30 rounded-shell absolute inset-3 border-2 border-dashed" />
          <span className="bg-card edge shadow-e2 absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full py-2 pr-4 pl-2 text-[14px] font-medium">
            <span className="bg-muted grid size-8 place-items-center rounded-full">
              <FileSpreadsheet className="size-4" aria-hidden="true" />
            </span>
            Drop a spreadsheet to make a database
          </span>
        </div>
      )}
      <NewDatabaseDialog
        orgId={orgId}
        orgSlug={orgSlug}
        personal={personal}
        trigger={null}
        defaultMode="import"
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setFile(null);
        }}
        file={file}
      />
    </>
  );
}
